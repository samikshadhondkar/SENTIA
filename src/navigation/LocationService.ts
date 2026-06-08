// ─────────────────────────────────────────────────────────────────────────────
// Sentia — Navigation Module: Location Service
// Owner: Navigation Team
//
// Exports:
//   getCurrentLocation()         → Result<Coordinates>
//   getReadableAddress()         → Result<ReadableAddress>
//   getLocationDescription()     → Result<LocationDescription>
//   getUserFacingErrorMessage()  → string  (for the Voice team)
// ─────────────────────────────────────────────────────────────────────────────

import * as ExpoLocation from "expo-location";

import {
  Coordinates,
  ExpoGeocodeRecord,
  LocationDescription,
  LocationError,
  LocationErrorCode,
  ReadableAddress,
  Result,
  SentiaLanguage,
} from "./navigationTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Internal Result helpers
// ─────────────────────────────────────────────────────────────────────────────

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail<T>(code: LocationErrorCode, detail: string): Result<T> {
  const error: LocationError = { code, detail };
  return { ok: false, error };
}

// ─────────────────────────────────────────────────────────────────────────────
// Language templates — full address (all three components present)
//
// To add a new language (e.g. Gujarati 'gu'):
//   1. Add 'gu' to SentiaLanguage in navigationTypes.ts
//   2. Add an entry here
//   3. Add an entry in PARTIAL_TEMPLATES below
//   4. Add entries in USER_ERROR_MESSAGES below
// ─────────────────────────────────────────────────────────────────────────────

type AddressBuilder = (road: string, locality: string, city: string) => string;

const LOCATION_TEMPLATES: Record<SentiaLanguage, AddressBuilder> = {
  en: (road, locality, city) =>
    `You are currently on ${road}, ${locality}, ${city}.`,

  hi: (road, locality, city) =>
    `आप वर्तमान में ${road}, ${locality}, ${city} में हैं।`,

  mr: (road, locality, city) =>
    `तुम्ही सध्या ${road}, ${locality}, ${city} येथे आहात.`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Language templates — partial address (one or more components missing)
// ─────────────────────────────────────────────────────────────────────────────

type PartialBuilder = (location: string) => string;

const PARTIAL_TEMPLATES: Record<SentiaLanguage, PartialBuilder> = {
  en: (loc) => `You are currently near ${loc}.`,
  hi: (loc) => `आप वर्तमान में ${loc} के पास हैं।`,
  mr: (loc) => `तुम्ही सध्या ${loc} जवळ आहात.`,
};

// ─────────────────────────────────────────────────────────────────────────────
// User-facing error messages
// (Spoken aloud by the Voice team when location cannot be determined.)
// ─────────────────────────────────────────────────────────────────────────────

const USER_ERROR_MESSAGES: Record<
  LocationErrorCode,
  Record<SentiaLanguage, string>
> = {
  [LocationErrorCode.PERMISSION_DENIED]: {
    en: "Location permission is required. Please allow location access in your settings.",
    hi: "स्थान की अनुमति आवश्यक है। कृपया सेटिंग में स्थान की अनुमति दें।",
    mr: "स्थान परवानगी आवश्यक आहे. कृपया सेटिंग्जमध्ये परवानगी द्या.",
  },
  [LocationErrorCode.GPS_UNAVAILABLE]: {
    en: "Unable to determine your location. Please check that GPS is enabled.",
    hi: "आपका स्थान निर्धारित करने में असमर्थ। कृपया GPS सक्षम है यह जाँचें।",
    mr: "तुमचे स्थान निर्धारित करणे शक्य नाही. कृपया GPS सुरू आहे का ते तपासा.",
  },
  [LocationErrorCode.GEOCODE_FAILED]: {
    en: "Your GPS location was found, but the address could not be determined.",
    hi: "GPS स्थान मिला, लेकिन पता निर्धारित नहीं हो सका।",
    mr: "GPS स्थान मिळाले, परंतु पत्ता निर्धारित करणे शक्य झाले नाही.",
  },
  [LocationErrorCode.NETWORK_FAILURE]: {
    en: "Unable to determine your address. Please check your internet connection.",
    hi: "पता निर्धारित करने में असमर्थ। कृपया इंटरनेट कनेक्शन जाँचें।",
    mr: "पत्ता निर्धारित करणे शक्य नाही. कृपया इंटरनेट कनेक्शन तपासा.",
  },
  [LocationErrorCode.UNKNOWN]: {
    en: "An unexpected error occurred. Please try again.",
    hi: "एक अप्रत्याशित त्रुटि हुई। कृपया पुनः प्रयास करें।",
    mr: "एक अनपेक्षित त्रुटी आली. कृपया पुन्हा प्रयत्न करा.",
  },
};

/**
 * Returns a user-facing, speakable error string for the given error code
 * in the requested language.
 *
 * This is what the Voice team calls when `getLocationDescription` returns
 * `ok: false`.
 *
 * @example
 * if (!result.ok) {
 *   speakAloud(getUserFacingErrorMessage(result.error.code, userLang));
 * }
 */
export function getUserFacingErrorMessage(
  code: LocationErrorCode,
  lang: SentiaLanguage = "en",
): string {
  // Record<LocationErrorCode, …> is exhaustive — both lookups are always defined.
  // The fallback to 'en' handles any future language codes not yet wired up.
  return USER_ERROR_MESSAGES[code][lang] ?? USER_ERROR_MESSAGES[code].en;
}

// ─────────────────────────────────────────────────────────────────────────────
// Address field extraction
//
// expo-location's reverseGeocodeAsync returns fields inconsistently across
// Android / iOS / emulators. We apply a priority fallback chain for each
// component to maximise real-world coverage.
//
// FIX (BUG 3): extractRoad no longer falls back to `district`.
// Using `district` as a road-name fallback caused the district to appear in
// BOTH the road and locality slots, producing duplicated output like:
//   "You are currently on Bandra West, Bandra West, Mumbai."
//
// Priority chains:
//   road     → street → name → (empty — triggers partial sentence)
//   locality → district → subregion → region
//   city     → city    → subregion → region
// ─────────────────────────────────────────────────────────────────────────────

function extractRoad(record: ExpoGeocodeRecord): string {
  // `street` is the authoritative road name on both platforms.
  // `name` is a point-of-interest name — acceptable as a last resort for road,
  // but we do NOT fall back to `district` (see note above).
  return record.street?.trim() || record.name?.trim() || "";
}

function extractLocality(record: ExpoGeocodeRecord): string {
  return (
    record.district?.trim() ||
    record.subregion?.trim() ||
    record.region?.trim() ||
    ""
  );
}

function extractCity(record: ExpoGeocodeRecord): string {
  return (
    record.city?.trim() ||
    record.subregion?.trim() ||
    record.region?.trim() ||
    ""
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Partial sentence builder
//
// FIX (BUG 7): Deduplicates components before joining so we never produce
// "You are currently near Bandra West, Bandra West."
// ─────────────────────────────────────────────────────────────────────────────

function buildPartialSentence(parts: string[], lang: SentiaLanguage): string {
  // Remove duplicates while preserving order
  const seen = new Set<string>();
  const unique = parts.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  const joined = unique.join(", ");
  const builder = PARTIAL_TEMPLATES[lang] ?? PARTIAL_TEMPLATES.en;
  return builder(joined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Network error detection
//
// FIX (BUG 8): Broadened to cover platform-specific error strings beyond just
// 'network' / 'fetch' / 'timeout', including iOS CoreLocation domain errors
// and Android Play Services errors.
// ─────────────────────────────────────────────────────────────────────────────

const NETWORK_ERROR_PATTERNS: readonly RegExp[] = [
  /network/i,
  /fetch/i,
  /timeout/i,
  /no internet/i,
  /connection/i,
  /SERVICE_MISSING/i, // Android — Google Play Services missing
  /kCLErrorDomain/i, // iOS CoreLocation domain
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
];

function isNetworkError(message: string): boolean {
  return NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Requests foreground location permission and returns the current GPS fix.
 *
 * Failures:
 *   PERMISSION_DENIED  — user rejected the permission prompt
 *   GPS_UNAVAILABLE    — device could not obtain a fix within the timeout
 *   UNKNOWN            — any other unexpected error
 */
export async function getCurrentLocation(): Promise<Result<Coordinates>> {
  try {
    // ── 1. Request foreground permission ──────────────────────────────────
    const { status } = await ExpoLocation.requestForegroundPermissionsAsync();

    if (status !== ExpoLocation.PermissionStatus.GRANTED) {
      return fail<Coordinates>(
        LocationErrorCode.PERMISSION_DENIED,
        `Permission status returned: ${status}`,
      );
    }

    // ── 2. Obtain GPS fix ─────────────────────────────────────────────────
    //
    // FIX (BUG 6): Removed `timeInterval: 0` — that option belongs to
    // watchPositionAsync, not getCurrentPositionAsync, and causes platform
    // warnings on some Android builds.
    //
    // Accuracy.Balanced: good trade-off between fix speed (~2 s) and precision
    // (~10–30 m). Suitable for street-level "Where am I?" queries.
    let locationResult: ExpoLocation.LocationObject;
    try {
      locationResult = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
    } catch (gpsError: unknown) {
      const detail =
        gpsError instanceof Error ? gpsError.message : String(gpsError);
      return fail<Coordinates>(LocationErrorCode.GPS_UNAVAILABLE, detail);
    }

    // ── 3. Build Coordinates ──────────────────────────────────────────────
    //
    // FIX (BUG 1): expo-location returns `accuracy` as `number | null`.
    // Our Coordinates interface declares `accuracyMetres: number | undefined`
    // (not an optional property) to stay compatible with exactOptionalPropertyTypes.
    // We convert null → undefined explicitly here.
    const coords: Coordinates = {
      latitude: locationResult.coords.latitude,
      longitude: locationResult.coords.longitude,
      accuracyMetres:
        locationResult.coords.accuracy !== null
          ? locationResult.coords.accuracy
          : undefined,
    };

    return ok(coords);
  } catch (unexpectedError: unknown) {
    const detail =
      unexpectedError instanceof Error
        ? unexpectedError.message
        : String(unexpectedError);
    return fail<Coordinates>(LocationErrorCode.UNKNOWN, detail);
  }
}

/**
 * Reverse-geocodes a set of coordinates into human-readable address components.
 *
 * Failures:
 *   GEOCODE_FAILED   — API returned no results or all components are empty
 *   NETWORK_FAILURE  — network / API error during geocoding
 */
export async function getReadableAddress(
  coordinates: Coordinates,
): Promise<Result<ReadableAddress>> {
  try {
    const results = await ExpoLocation.reverseGeocodeAsync({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    });

    // ── Validate results ──────────────────────────────────────────────────
    //
    // FIX (BUG 2): With `noUncheckedIndexedAccess`, `results[0]` is typed as
    // `T | undefined` even after a `results.length === 0` guard, because TS
    // doesn't narrow array access by length checks. We destructure instead,
    // which gives us an explicit undefined guard that satisfies the compiler.
    if (!results || results.length === 0) {
      return fail<ReadableAddress>(
        LocationErrorCode.GEOCODE_FAILED,
        "reverseGeocodeAsync returned an empty array.",
      );
    }

    const [first] = results;

    // `first` is `LocationGeocodedAddress | undefined` under noUncheckedIndexedAccess
    if (first === undefined) {
      return fail<ReadableAddress>(
        LocationErrorCode.GEOCODE_FAILED,
        "reverseGeocodeAsync result was unexpectedly undefined.",
      );
    }

    // Map to our internal type — decouples the rest of the codebase from
    // expo-location's type definitions and survives SDK upgrades.
    const record: ExpoGeocodeRecord = {
      street: first.street ?? null,
      district: first.district ?? null,
      subregion: first.subregion ?? null,
      city: first.city ?? null,
      region: first.region ?? null,
      country: first.country ?? null,
      postalCode: first.postalCode ?? null,
      name: first.name ?? null,
      isoCountryCode: first.isoCountryCode ?? null,
    };

    const road = extractRoad(record);
    const locality = extractLocality(record);
    const city = extractCity(record);

    // If all three critical components are empty the geocoder gave us nothing useful.
    if (!road && !locality && !city) {
      return fail<ReadableAddress>(
        LocationErrorCode.GEOCODE_FAILED,
        "All address components are empty after extraction.",
      );
    }

    return ok({ road, locality, city, raw: record });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);

    return fail<ReadableAddress>(
      isNetworkError(detail)
        ? LocationErrorCode.NETWORK_FAILURE
        : LocationErrorCode.GEOCODE_FAILED,
      detail,
    );
  }
}

/**
 * The single high-level function the Voice team calls to handle "Where am I?"
 *
 * Orchestrates: permission → GPS fix → reverse geocode → sentence assembly.
 *
 * On success  → `result.ok === true`,  `result.value.sentence` is ready to speak.
 * On failure  → `result.ok === false`, pass `result.error.code` to
 *               `getUserFacingErrorMessage()` to get a speakable error string.
 *
 * @param lang - BCP-47 language code supported by Sentia. Defaults to 'en'.
 *
 * @example
 * // Voice team usage:
 * const result = await getLocationDescription(userLang);
 * if (result.ok) {
 *   speakAloud(result.value.sentence);
 * } else {
 *   speakAloud(getUserFacingErrorMessage(result.error.code, userLang));
 * }
 */
export async function getLocationDescription(
  lang: SentiaLanguage = "en",
): Promise<Result<LocationDescription>> {
  // ── Step 1: GPS fix ───────────────────────────────────────────────────────
  const coordResult = await getCurrentLocation();
  if (!coordResult.ok) {
    return fail<LocationDescription>(
      coordResult.error.code,
      coordResult.error.detail,
    );
  }
  const coordinates = coordResult.value;

  // ── Step 2: Reverse geocode ───────────────────────────────────────────────
  const addressResult = await getReadableAddress(coordinates);
  if (!addressResult.ok) {
    return fail<LocationDescription>(
      addressResult.error.code,
      addressResult.error.detail,
    );
  }
  const address = addressResult.value;

  // ── Step 3: Sentence assembly ─────────────────────────────────────────────
  //
  // FIX (BUG 4): Removed the redundant city fallback chain here.
  // extractCity() already applies `city → subregion → region`, so
  // `address.city` is already the best available city value.
  // Re-checking raw fields here was misleading and produced inconsistent
  // behaviour when `address.city` was an empty string vs. undefined.
  const road = address.road || null;
  const locality = address.locality || null;
  const city = address.city || null;

  let sentence: string;

  if (road && locality && city) {
    // Full address — use the per-language template
    const builder = LOCATION_TEMPLATES[lang] ?? LOCATION_TEMPLATES.en;
    sentence = builder(road, locality, city);
  } else {
    // Partial address — collect whatever components we have, deduplicate,
    // and build a graceful fallback sentence (FIX BUG 7 applied inside helper)
    const parts = [road, locality, city].filter((p): p is string => p !== null);
    sentence = buildPartialSentence(parts, lang);
  }

  return ok({
    sentence,
    language: lang,
    address,
    coordinates,
  });
}
