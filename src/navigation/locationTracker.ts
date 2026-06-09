/**
 * locationTracker.ts
 * Sentia — AI-Powered Accessibility Application
 * Navigation Team: GPS Tracking Engine
 *
 * Provides continuous, battery-efficient GPS tracking via a singleton module.
 * Designed as the foundational layer for:
 *   - Real-Time Navigation
 *   - Route Recalculation & Off-Route Detection
 *   - WalkWithMe
 *   - SOS Live Location Sharing
 *
 * Public API:
 *   startLocationTracking()          — Begin GPS tracking
 *   stopLocationTracking()           — Stop tracking and release all resources
 *   getCurrentTrackedLocation()      — Read the latest known location
 *   subscribeToLocationUpdates(cb)   — Register for live updates
 *   getTrackingState()               — Read full tracker state snapshot
 *
 * Thread safety note:
 *   This module runs on the JS thread. All state mutations are synchronous
 *   within a single event-loop tick, so there are no race conditions.
 */

import * as Location from 'expo-location';

import type {
  LocationSubscription,
  LocationTrackerConfig,
  LocationUpdateCallback,
  TrackingError,
  TrackingErrorCode,
  TrackingState,
  TrackingStatus,
  TrackedLocation,
  LocationPermissionStatus,
} from './navigationTypes';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & DEFAULT CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Readonly<LocationTrackerConfig> = {
  minimumDisplacementMeters: 5,   // Suppress micro-jitter under 5 m
  timeoutMs: 15_000,              // 15 s GPS acquisition timeout
  maximumAgeMs: 10_000,           // Accept a cached fix up to 10 s old
};

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL STATE  (module-level singleton — NOT exported)
// ─────────────────────────────────────────────────────────────────────────────

/** Active expo-location watcher subscription (null when idle/stopped) */
let _expoWatcher: Location.LocationSubscription | null = null;

/** Latest location received from the watcher */
let _latestLocation: TrackedLocation | null = null;

/** Current lifecycle status of the tracker */
let _status: TrackingStatus = 'idle';

/** Last error produced by the tracker (null if none) */
let _lastError: TrackingError | null = null;

/** Unix timestamp (ms) of the last location update */
let _lastUpdatedAt: number | null = null;

/** Current permission status (cached after each permission check) */
let _permissionStatus: LocationPermissionStatus = 'undetermined';

/**
 * Active subscriber registry.
 * Map<subscriptionId, LocationUpdateCallback>
 */
const _subscribers: Map<string, LocationUpdateCallback> = new Map();

/**
 * Active config — set when tracking starts.
 */
let _activeConfig: Readonly<LocationTrackerConfig> = DEFAULT_CONFIG;

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a lightweight RFC4122-compliant UUID v4.
 * Avoids pulling in uuid package; safe for subscription IDs.
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * Builds a structured TrackingError object.
 */
function buildError(
  code: TrackingErrorCode,
  message: string,
  cause?: unknown,
): TrackingError {
  return { code, message, cause };
}

/**
 * Sets tracker status and optionally records an error.
 */
function setStatus(status: TrackingStatus, error?: TrackingError): void {
  _status = status;
  _lastError = error ?? null;
}

/**
 * Converts an expo-location LocationObject to our canonical TrackedLocation.
 * Ensures we never leak expo-location types beyond this file.
 */
function toTrackedLocation(
  raw: Location.LocationObject,
): TrackedLocation {
  return {
    latitude: raw.coords.latitude,
    longitude: raw.coords.longitude,
    altitude: raw.coords.altitude,
    accuracy: raw.coords.accuracy,
    altitudeAccuracy: raw.coords.altitudeAccuracy,
    heading: raw.coords.heading,
    speed: raw.coords.speed,
    timestamp: raw.timestamp,
  };
}

/**
 * Notifies all registered subscribers with the latest location.
 * Errors inside individual callbacks are caught and logged so one
 * misbehaving consumer cannot crash the tracker.
 */
function notifySubscribers(location: TrackedLocation): void {
  _subscribers.forEach((callback, id) => {
    try {
      callback(location);
    } catch (callbackError) {
      // Log the offending subscriber but do NOT remove it — consumer decides.
      console.error(
        `[Sentia/LocationTracker] Subscriber "${id}" threw an error:`,
        callbackError,
      );
    }
  });
}

/**
 * Requests foreground location permission.
 * Returns the normalised status string.
 */
async function requestPermission(): Promise<LocationPermissionStatus> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();

    // expo-location returns 'granted' | 'denied' | 'undetermined'.
    // We cast safely — if a new value appears we fall back to 'undetermined'.
    const mapped: LocationPermissionStatus =
      status === 'granted'
        ? 'granted'
        : status === 'denied'
        ? 'denied'
        : 'undetermined';

    _permissionStatus = mapped;
    return mapped;
  } catch (_err) {
    _permissionStatus = 'undetermined';
    return 'undetermined';
  }
}

/**
 * Core location update handler — called by the expo-location watcher.
 * Applies displacement filtering via Expo's distanceInterval option at the
 * native layer. This handler acts as the final JS-side guard.
 */
function handleLocationUpdate(raw: Location.LocationObject): void {
  // Discard late callbacks arriving after stop() was called.
  if (_status !== 'active') {
    return;
  }

  const location = toTrackedLocation(raw);
  _latestLocation = location;
  _lastUpdatedAt = Date.now();

  notifySubscribers(location);
}

/**
 * Tears down the expo-location watcher safely.
 * Idempotent — safe to call multiple times.
 */
async function teardownWatcher(): Promise<void> {
  if (_expoWatcher !== null) {
    try {
      await _expoWatcher.remove();
    } catch (err) {
      // Silently absorb — watcher may already be removed by the OS.
      console.warn(
        '[Sentia/LocationTracker] Warning during watcher cleanup:',
        err,
      );
    } finally {
      _expoWatcher = null;
    }
  }
}

/**
 * Returns true if the tracker is in a state where starting is not allowed.
 */
function isAlreadyRunning(): boolean {
  return _status === 'active' || _status === 'requesting';
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts continuous GPS location tracking.
 *
 * Behaviour:
 *  1. Returns early with an error if already tracking.
 *  2. If a previous session ended in error, cleans up before restarting.
 *  3. Requests foreground location permission.
 *  4. Verifies GPS hardware is enabled.
 *  5. Starts expo-location watcher with high-accuracy settings.
 *  6. Stores location updates and notifies all subscribers.
 *
 * @param config — Optional overrides for tracker tuning parameters.
 * @returns Promise<void> — resolves when tracking is active.
 * @throws TrackingError — structured error if startup fails.
 */
export async function startLocationTracking(
  config?: Partial<LocationTrackerConfig>,
): Promise<void> {
  // ── Guard: prevent duplicate active tracking ──────────────────────────────
  if (isAlreadyRunning()) {
    const error = buildError(
      'ALREADY_TRACKING',
      'Location tracking is already active. Call stopLocationTracking() first.',
    );
    // Do NOT overwrite status — it is already correct.
    throw error;
  }

  // ── If a previous error state exists, clean up first ─────────────────────
  // This allows clean restart after an error without calling stop() manually.
  if (_status === 'error') {
    await teardownWatcher();
  }

  _activeConfig = { ...DEFAULT_CONFIG, ...config };
  setStatus('requesting');

  // ── Step 1: Permission ────────────────────────────────────────────────────
  const permission = await requestPermission();

  if (permission !== 'granted') {
    const error = buildError(
      'PERMISSION_DENIED',
      'Location permission was not granted. Please enable it in device Settings → Privacy → Location.',
    );
    setStatus('error', error);
    throw error;
  }

  // ── Step 2: Verify GPS provider is enabled ────────────────────────────────
  let isGpsEnabled = false;
  try {
    isGpsEnabled = await Location.hasServicesEnabledAsync();
  } catch (err) {
    const error = buildError(
      'GPS_UNAVAILABLE',
      'Unable to determine GPS service availability.',
      err,
    );
    setStatus('error', error);
    throw error;
  }

  if (!isGpsEnabled) {
    const error = buildError(
      'GPS_DISABLED',
      'GPS / Location Services are disabled on this device. Please enable them in Settings.',
    );
    setStatus('error', error);
    throw error;
  }

  // ── Step 3: Start Watcher ─────────────────────────────────────────────────
  try {
    _expoWatcher = await Location.watchPositionAsync(
      {
        /**
         * BestForNavigation uses GPS + network + barometer + motion sensors.
         * This is the highest accuracy mode — appropriate for accessibility
         * navigation where a 5 m error could mean missing a crossing.
         */
        accuracy: Location.Accuracy.BestForNavigation,

        /**
         * Native-layer displacement filter. The OS will NOT invoke our
         * callback unless the device has moved at least this many metres.
         * This is the most battery-efficient way to suppress jitter.
         */
        distanceInterval: _activeConfig.minimumDisplacementMeters,

        /**
         * 2-second floor allows heading/speed/accuracy updates even when
         * the user is stationary (e.g. waiting at a crossing).
         * distanceInterval is still the primary gate.
         */
        timeInterval: 2000,
      },
      handleLocationUpdate,
    );

    setStatus('active');
    console.info('[Sentia/LocationTracker] Tracking started successfully.');
  } catch (err) {
    // CRITICAL: always tear down before throwing so no orphan watcher leaks.
    await teardownWatcher();

    const rawMessage =
      err instanceof Error ? err.message : 'Unknown error starting GPS watcher.';

    const code: TrackingErrorCode = rawMessage.toLowerCase().includes('timeout')
      ? 'LOCATION_TIMEOUT'
      : 'UNKNOWN_ERROR';

    const error = buildError(code, rawMessage, err);
    setStatus('error', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stops GPS tracking and releases all resources.
 *
 * - Safe to call when already stopped (idempotent).
 * - Does NOT clear subscribers — they resume receiving updates if tracking
 *   is restarted later, with zero re-registration required.
 *
 * @returns Promise<void> — resolves when cleanup is complete.
 */
export async function stopLocationTracking(): Promise<void> {
  if (_status === 'idle' || _status === 'stopped') {
    console.info(
      '[Sentia/LocationTracker] stopLocationTracking() called but tracker is already stopped.',
    );
    return;
  }

  // Mark as stopped BEFORE teardown so handleLocationUpdate discards
  // any in-flight watcher callbacks received during async teardown.
  setStatus('stopped');

  await teardownWatcher();

  console.info('[Sentia/LocationTracker] Tracking stopped. Resources released.');
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the most recently acquired GPS location.
 *
 * Returns null if:
 *  - Tracking has never been started.
 *  - Tracking just started and no fix has been received yet.
 *
 * Voice Team integration note:
 *  Call this after confirming getTrackingState().status === 'active'
 *  to avoid presenting a stale or null location to the user.
 *
 * @returns The latest TrackedLocation snapshot, or null.
 */
export function getCurrentTrackedLocation(): TrackedLocation | null {
  return _latestLocation;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers a callback to receive every location update in real time.
 *
 * - Multiple independent consumers can subscribe simultaneously.
 * - If tracking is already active and a location exists, the callback
 *   is immediately invoked with the latest known fix (no wait for next tick).
 * - Safe to subscribe before tracking starts.
 * - Returns a subscription handle; call handle.unsubscribe() to clean up.
 * - unsubscribe() is idempotent — safe to call multiple times.
 *
 * SOS Team integration note:
 *  Subscribe here for live coordinates to share. Unsubscribe when the
 *  emergency session ends to avoid unnecessary battery drain.
 *
 * @param callback — Receives a TrackedLocation on every update.
 * @returns LocationSubscription — holds id and unsubscribe().
 *
 * @example
 * const sub = subscribeToLocationUpdates((loc) => {
 *   console.log(`${loc.latitude}, ${loc.longitude}`);
 * });
 * // When done:
 * sub.unsubscribe();
 */
export function subscribeToLocationUpdates(
  callback: LocationUpdateCallback,
): LocationSubscription {
  const id = generateUUID();

  _subscribers.set(id, callback);

  // Immediately deliver the latest known location to the new subscriber
  // so they don't have to wait for the next GPS tick.
  if (_latestLocation !== null) {
    try {
      callback(_latestLocation);
    } catch (err) {
      console.error(
        `[Sentia/LocationTracker] Initial delivery to subscriber "${id}" failed:`,
        err,
      );
    }
  }

  const unsubscribe = (): void => {
    // Guard makes this idempotent — safe to call multiple times.
    if (_subscribers.has(id)) {
      _subscribers.delete(id);
      console.info(
        `[Sentia/LocationTracker] Subscriber "${id}" unsubscribed.`,
      );
    }
  };

  console.info(`[Sentia/LocationTracker] Subscriber "${id}" registered. Total: ${_subscribers.size}`);

  return { id, unsubscribe };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a read-only snapshot of the tracker's current internal state.
 *
 * Use cases:
 *  - Diagnostic / debug screens
 *  - Conditional UI ("GPS unavailable" banner)
 *  - SOS team checking live tracking is active before sharing
 *  - Voice team checking permission status before announcing location
 *
 * @returns Readonly<TrackingState> — immutable snapshot of current state.
 */
export function getTrackingState(): Readonly<TrackingState> {
  return {
    status: _status,
    latestLocation: _latestLocation,
    lastUpdatedAt: _lastUpdatedAt,
    error: _lastError,
    permissionStatus: _permissionStatus,
  };
}