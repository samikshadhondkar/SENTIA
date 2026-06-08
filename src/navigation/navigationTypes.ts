// ─────────────────────────────────────────────────────────────────────────────
// Sentia — Navigation Module: Types
// Owner: Navigation Team
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Supported languages
//
// To add a new language (e.g. Gujarati):
//   1. Append its BCP-47 code here:   "en" | "hi" | "mr" | "gu"
//   2. Add a template entry in locationService.ts → LOCATION_TEMPLATES
//   3. Add a template entry in locationService.ts → PARTIAL_TEMPLATES
//   4. Add error messages in locationService.ts   → USER_ERROR_MESSAGES
// ─────────────────────────────────────────────────────────────────────────────

export type SentiaLanguage = "en" | "hi" | "mr";

// ─────────────────────────────────────────────────────────────────────────────
// Result wrapper  (avoids thrown errors crossing module boundaries)
// ─────────────────────────────────────────────────────────────────────────────

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: LocationError };

// ─────────────────────────────────────────────────────────────────────────────
// Error taxonomy
// ─────────────────────────────────────────────────────────────────────────────

export enum LocationErrorCode {
  PERMISSION_DENIED = "PERMISSION_DENIED",
  GPS_UNAVAILABLE = "GPS_UNAVAILABLE",
  GEOCODE_FAILED = "GEOCODE_FAILED",
  NETWORK_FAILURE = "NETWORK_FAILURE",
  UNKNOWN = "UNKNOWN",
}

export interface LocationError {
  code: LocationErrorCode;
  /** Human-readable detail for logging / debugging. NOT shown to the user. */
  detail: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GPS coordinates
//
// NOTE: `accuracyMetres` is intentionally typed as `number | undefined` rather
// than an optional property (`accuracyMetres?: number`).
//
// Reason: TypeScript's `exactOptionalPropertyTypes` flag differentiates between
// a key being ABSENT and a key being present but `undefined`. expo-location
// returns `coords.accuracy` as `number | null`, and we normalise null → undefined
// at the call site. Using `number | undefined` here keeps the type honest and
// prevents TS2322 errors when assigning the normalised value.
// ─────────────────────────────────────────────────────────────────────────────

export interface Coordinates {
  latitude: number;
  longitude: number;
  /** Accuracy in metres as reported by the device. `undefined` if unavailable. */
  accuracyMetres: number | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsed address components
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadableAddress {
  /** Street / road name  e.g. "Senapati Bapat Marg" — empty string if unknown */
  road: string;
  /** Locality / area      e.g. "Dadar West"          — empty string if unknown */
  locality: string;
  /** City                 e.g. "Mumbai"               — empty string if unknown */
  city: string;
  /**
   * Raw Expo geocode record preserved for callers that need extra fields
   * (postal code, country, etc.) without re-fetching.
   */
  raw: ExpoGeocodeRecord;
}

/**
 * Subset of Expo's LocationGeocodedAddress we actually use.
 *
 * Typed explicitly so the rest of the codebase is decoupled from
 * expo-location's internal types and survives Expo SDK upgrades.
 */
export interface ExpoGeocodeRecord {
  street: string | null;
  district: string | null;
  subregion: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  name: string | null;
  isoCountryCode: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Location description  (the final spoken / displayed string)
// ─────────────────────────────────────────────────────────────────────────────

export interface LocationDescription {
  /** The sentence ready to be read aloud or displayed. */
  sentence: string;
  /** The language the sentence is in. */
  language: SentiaLanguage;
  /** The underlying address data used to build the sentence. */
  address: ReadableAddress;
  /** The GPS fix used. */
  coordinates: Coordinates;
}
