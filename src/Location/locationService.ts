/**
 * LocationService.ts
 *
 * Thin, stateless wrapper around expo-location.
 * Handles permission requests, coordinate fetching, and reverse geocoding.
 * Designed to be imported by WhereAmIManager and any future location-aware feature.
 */

import * as ExpoLocation from "expo-location";

export interface LocationResult {
  /** Decimal-degree coordinates */
  latitude: number;
  longitude: number;
  /** Street-level human-readable address, or null if geocoding failed */
  address: string | null;
  /** City / suburb token, or null */
  city: string | null;
  /** Landmark / point-of-interest name returned by the geocoder, or null */
  landmark: string | null;
}

export interface LocationError {
  code: "PERMISSION_DENIED" | "UNAVAILABLE" | "TIMEOUT" | "UNKNOWN";
  message: string;
}

/**
 * Request foreground location permission.
 * Returns true if granted, false otherwise.
 */
export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
  return status === "granted";
}

/**
 * Check whether permission is already granted without prompting.
 */
export async function hasLocationPermission(): Promise<boolean> {
  const { status } = await ExpoLocation.getForegroundPermissionsAsync();
  return status === "granted";
}

/**
 * Fetch the device's current position and reverse-geocode it.
 *
 * @param timeoutMs  Maximum milliseconds to wait for GPS fix (default 10 000)
 * @returns LocationResult on success, LocationError on failure
 */
export async function getCurrentLocation(
  timeoutMs = 10_000,
): Promise<LocationResult | LocationError> {
  try {
    // Try to get an accurate fix; fall back to BALANCED if HIGH_ACCURACY times out
    const position = await Promise.race([
      ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs),
      ),
    ]);

    const { latitude, longitude } = position.coords;

    // Reverse geocode — expo-location returns an array; we only need the best hit
    let address: string | null = null;
    let city: string | null = null;
    let landmark: string | null = null;

    try {
      const results = await ExpoLocation.reverseGeocodeAsync(
        { latitude, longitude },
        { useGoogleMaps: false },
      );

      if (results.length > 0) {
        const r = results[0];

        // Build a human-readable address string from available parts
        const parts: string[] = [];
        if (r.name && r.name !== r.street) parts.push(r.name);
        if (r.street) parts.push(r.street);
        if (r.district) parts.push(r.district);
        if (r.city) parts.push(r.city);
        if (r.region) parts.push(r.region);

        address = parts.length > 0 ? parts.join(", ") : null;
        city = r.city ?? r.district ?? r.subregion ?? null;

        // expo-location sometimes puts the POI in `name` when it differs from
        // the street name — treat that as a landmark.
        landmark =
          r.name && r.name !== r.street && r.name !== r.streetNumber
            ? r.name
            : null;
      }
    } catch {
      // Geocoding is best-effort; coordinates are always returned
    }

    return { latitude, longitude, address, city, landmark };
  } catch (err: any) {
    if (err?.message === "TIMEOUT") {
      return { code: "TIMEOUT", message: "Location request timed out." };
    }
    const msg: string = err?.message ?? "";
    if (
      msg.toLowerCase().includes("permission") ||
      msg.toLowerCase().includes("denied")
    ) {
      return { code: "PERMISSION_DENIED", message: msg };
    }
    if (
      msg.toLowerCase().includes("unavailable") ||
      msg.toLowerCase().includes("disabled")
    ) {
      return { code: "UNAVAILABLE", message: msg };
    }
    return { code: "UNKNOWN", message: msg || "Unknown location error." };
  }
}

/**
 * Type-guard: returns true when result is an error.
 */
export function isLocationError(
  result: LocationResult | LocationError,
): result is LocationError {
  return "code" in result;
}