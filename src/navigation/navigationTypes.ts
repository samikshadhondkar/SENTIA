/**
 * navigationTypes.ts
 * Sentia — AI-Powered Accessibility Application
 * Navigation Team: GPS Tracking Engine Type Definitions
 *
 * Central type registry for all navigation-related data structures.
 * Designed to be extended by: Real-Time Navigation, Route Recalculation,
 * Off-Route Detection, WalkWithMe, and SOS Live Tracking.
 */

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSION TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents the result of a location permission request.
 */
export type LocationPermissionStatus =
  | "granted"
  | "denied"
  | "undetermined"
  | "restricted"; // iOS only — parental controls / MDM

// ─────────────────────────────────────────────────────────────────────────────
// COORDINATE & LOCATION TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A raw GPS coordinate pair.
 */
export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Extended coordinate with optional altitude.
 * Used internally by the tracking engine.
 */
export interface ExtendedCoordinates extends Coordinates {
  readonly altitude: number | null;
  readonly altitudeAccuracy: number | null;
}

/**
 * A fully enriched location snapshot produced by the tracker.
 * This is the canonical location object used throughout the app.
 *
 * Future teams: extend this via intersection types, not mutation.
 * e.g. type NavigationLocation = TrackedLocation & { bearing: number }
 */
export interface TrackedLocation {
  /** WGS-84 latitude in decimal degrees */
  readonly latitude: number;
  /** WGS-84 longitude in decimal degrees */
  readonly longitude: number;
  /** Altitude in metres above sea level (null if unavailable) */
  readonly altitude: number | null;
  /** Horizontal accuracy radius in metres (lower = better) */
  readonly accuracy: number | null;
  /** Altitude accuracy in metres (null if unavailable) */
  readonly altitudeAccuracy: number | null;
  /** Direction of travel in degrees (0–360, null if stationary) */
  readonly heading: number | null;
  /** Speed in metres per second (null if unavailable) */
  readonly speed: number | null;
  /** Unix timestamp (ms) when this fix was acquired */
  readonly timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACKING STATE TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents the lifecycle phase of the location tracker.
 */
export type TrackingStatus =
  | "idle" // Not started
  | "requesting" // Awaiting permission or first fix
  | "active" // Receiving updates normally
  | "paused" // Temporarily halted (e.g. app in background)
  | "stopped" // Cleanly shut down
  | "error"; // Failed — see TrackingState.error

/**
 * Categorised error codes for the tracking engine.
 * Allows consumers to react differently to different failure modes.
 */
export type TrackingErrorCode =
  | "PERMISSION_DENIED"
  | "GPS_DISABLED"
  | "GPS_UNAVAILABLE"
  | "LOCATION_TIMEOUT"
  | "ALREADY_TRACKING"
  | "NOT_TRACKING"
  | "UNKNOWN_ERROR";

/**
 * Structured error object produced by the tracking engine.
 * Never throws raw JS errors to consumers.
 */
export interface TrackingError {
  readonly code: TrackingErrorCode;
  readonly message: string;
  /** Original underlying error if available (for debugging/logging) */
  readonly cause?: unknown;
}

/**
 * Full snapshot of the tracker's current internal state.
 * Read-only — never mutate this object.
 */
export interface TrackingState {
  readonly status: TrackingStatus;
  readonly latestLocation: TrackedLocation | null;
  readonly lastUpdatedAt: number | null; // Unix ms
  readonly error: TrackingError | null;
  readonly permissionStatus: LocationPermissionStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTION TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callback signature for location update subscribers.
 * The location object is always a complete, valid TrackedLocation.
 */
export type LocationUpdateCallback = (location: TrackedLocation) => void;

/**
 * Callback signature for error subscribers.
 * Allows consumers to react to tracker failures without crashing.
 */
export type TrackingErrorCallback = (error: TrackingError) => void;

/**
 * Handle returned by subscribeToLocationUpdates().
 * Call unsubscribe() to cleanly remove the listener.
 */
export interface LocationSubscription {
  /** Unique ID for this subscription (UUID v4) */
  readonly id: string;
  /** Call this to stop receiving updates. Idempotent — safe to call multiple times. */
  readonly unsubscribe: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tuning parameters for the GPS watcher.
 * Defaults are set in locationTracker.ts — override per-deployment only.
 *
 * Future: pass custom config to startLocationTracking() for different
 * accuracy profiles (e.g. power-saving mode for WalkWithMe background mode).
 */
export interface LocationTrackerConfig {
  /**
   * Minimum distance (metres) the device must move before a new update
   * is dispatched to subscribers. Prevents micro-jitter updates.
   * Default: 5
   */
  readonly minimumDisplacementMeters: number;

  /**
   * How long (ms) to wait for a GPS fix before emitting a timeout error.
   * Default: 15000 (15 seconds)
   */
  readonly timeoutMs: number;

  /**
   * Maximum age (ms) of a cached location that is still considered valid
   * as an initial result before a fresh fix arrives.
   * Default: 10000 (10 seconds)
   */
  readonly maximumAgeMs: number;
}
