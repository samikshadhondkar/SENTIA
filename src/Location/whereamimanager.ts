/**
 * WhereAmIManager.ts
 *
 * Orchestrates the "Where Am I?" feature:
 *   1. Checks / requests location permission
 *   2. Fetches current coordinates via LocationService
 *   3. Builds a natural-language spoken response
 *   4. Delegates speaking to the caller (App.tsx owns TTS — we never call Speech directly)
 *
 * The manager is intentionally stateless. App.tsx passes its own speak() callback
 * so the feature stays integrated with Sentia's existing TTS pipeline, voice gender,
 * language selection, and isSpeakingRef guard.
 */

import type { LangKey } from "../../types"; // adjust path if your types live elsewhere
import {
  getCurrentLocation,
  hasLocationPermission,
  isLocationError,
  requestLocationPermission,
  type LocationResult,
} from "./LocationService";

// ─── Localised strings ────────────────────────────────────────────────────────
// Extend these objects whenever a new LangKey is added.

const STRINGS = {
  requesting: {
    en: "Getting your location, please wait.",
    hi: "आपका स्थान ढूंढ रहे हैं, कृपया प्रतीक्षा करें।",
    mr: "तुमचे स्थान शोधत आहे, कृपया थांबा.",
  },
  permissionDenied: {
    en: "Location permission was not granted. Please enable it in your device settings.",
    hi: "स्थान की अनुमति नहीं मिली। कृपया डिवाइस सेटिंग में जाकर इसे चालू करें।",
    mr: "स्थान परवानगी मिळाली नाही. कृपया डिव्हाइस सेटिंगमध्ये ते सुरू करा.",
  },
  timeout: {
    en: "Could not get your location. The GPS signal is weak. Please try again in a moment.",
    hi: "स्थान नहीं मिला। GPS सिग्नल कमज़ोर है। थोड़ी देर बाद फिर कोशिश करें।",
    mr: "स्थान मिळाले नाही. GPS सिग्नल कमकुवत आहे. थोड्या वेळाने पुन्हा प्रयत्न करा.",
  },
  unavailable: {
    en: "Location services are turned off on this device. Please enable them and try again.",
    hi: "इस डिवाइस पर लोकेशन सर्विस बंद है। कृपया उसे चालू करके फिर प्रयास करें।",
    mr: "या डिव्हाइसवर लोकेशन सेवा बंद आहे. ती सुरू करा आणि पुन्हा प्रयत्न करा.",
  },
  genericError: {
    en: "Sorry, I could not determine your location right now. Please try again.",
    hi: "माफ़ करें, अभी आपका स्थान नहीं मिल पाया। कृपया फिर से कोशिश करें।",
    mr: "माफ करा, आत्ता तुमचे स्थान मिळाले नाही. कृपया पुन्हा प्रयत्न करा.",
  },
  nearPrefix: {
    // "You are currently near …"
    en: "You are currently near",
    hi: "आप अभी इसके पास हैं:",
    mr: "तुम्ही सध्या येथे आहात:",
  },
  onRoad: {
    // "You are on … near …"
    en: "You are on",
    hi: "आप इस सड़क पर हैं:",
    mr: "तुम्ही या रस्त्यावर आहात:",
  },
  inCity: {
    en: "in",
    hi: "में",
    mr: "मध्ये",
  },
  noAddressFound: {
    en: "Your current location could not be identified by name. You may be in an area with limited map coverage.",
    hi: "आपके वर्तमान स्थान का नाम नहीं मिला। आप कम नक्शा कवरेज वाले क्षेत्र में हो सकते हैं।",
    mr: "तुमच्या सध्याच्या स्थानाचे नाव मिळाले नाही. तुम्ही कमी नकाशा कव्हरेज असलेल्या भागात असाल.",
  },
} as const;

/** Safely pick a localised string, falling back to English */
function t(
  key: keyof typeof STRINGS,
  lang: LangKey,
): string {
  const map = STRINGS[key] as Record<string, string>;
  return map[lang] ?? map["en"];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface WhereAmIOptions {
  /** The active language — must match a LangKey from your languages.ts */
  lang: LangKey;
  /**
   * Sentia's speak callback. Pass App.tsx's `speak(text, lang)` directly.
   * The manager never imports expo-speech; App.tsx owns TTS.
   */
  speak: (text: string, lang: LangKey) => void;
  /**
   * Optional callback fired BEFORE the location fetch begins.
   * Use it to set loading UI state (e.g. setIsLoading(true)).
   */
  onStart?: () => void;
  /**
   * Optional callback fired AFTER the response is spoken (success or error).
   * Use it to clear loading UI state.
   */
  onComplete?: () => void;
}

/**
 * Entry point called by App.tsx when a "Where Am I" intent is detected.
 *
 * Usage in App.tsx:
 *
 *   import { handleWhereAmI } from './src/location/WhereAmIManager';
 *
 *   // inside stopListening(), before answerConversationally:
 *   if (isWhereAmIRequest(question)) {
 *     handleWhereAmI({ lang, speak });
 *     return;
 *   }
 */
export async function handleWhereAmI(options: WhereAmIOptions): Promise<void> {
  const { lang, speak, onStart, onComplete } = options;

  onStart?.();

  // ── 1. Permission ───────────────────────────────────────────────────────────
  let permitted = await hasLocationPermission();
  if (!permitted) {
    speak(t("requesting", lang), lang);
    permitted = await requestLocationPermission();
  }

  if (!permitted) {
    speak(t("permissionDenied", lang), lang);
    onComplete?.();
    return;
  }

  // ── 2. Fetch location ───────────────────────────────────────────────────────
  speak(t("requesting", lang), lang);

  const result = await getCurrentLocation(10_000);

  // ── 3. Handle errors ────────────────────────────────────────────────────────
  if (isLocationError(result)) {
    switch (result.code) {
      case "PERMISSION_DENIED":
        speak(t("permissionDenied", lang), lang);
        break;
      case "TIMEOUT":
        speak(t("timeout", lang), lang);
        break;
      case "UNAVAILABLE":
        speak(t("unavailable", lang), lang);
        break;
      default:
        speak(t("genericError", lang), lang);
    }
    onComplete?.();
    return;
  }

  // ── 4. Build natural response ───────────────────────────────────────────────
  const response = buildSpokenResponse(result, lang);
  speak(response, lang);
  onComplete?.();
}

/**
 * Constructs a natural-language location description from geocoder output.
 *
 * Priority order:
 *   landmark + city  →  "You are currently near Phoenix Marketcity in Kurla, Mumbai."
 *   address + city   →  "You are on MG Road in Andheri, Mumbai."
 *   address only     →  "You are on MG Road."
 *   city only        →  "You are currently in Mumbai."
 *   nothing          →  fallback message
 *
 * Exported so it can be unit-tested independently of the async fetch flow.
 */
export function buildSpokenResponse(
  location: LocationResult,
  lang: LangKey,
): string {
  const { address, city, landmark } = location;

  // Case 1: we have a landmark (POI name)
  if (landmark) {
    const base = `${t("nearPrefix", lang)} ${landmark}`;
    return city ? `${base} ${t("inCity", lang)} ${city}.` : `${base}.`;
  }

  // Case 2: we have a street address
  if (address) {
    // Strip city from address to avoid repetition
    const cleanAddress = city
      ? address.replace(new RegExp(`,?\\s*${escapeRegex(city)}.*$`, "i"), "").trim()
      : address;

    if (cleanAddress) {
      const base = `${t("onRoad", lang)} ${cleanAddress}`;
      return city ? `${base} ${t("inCity", lang)} ${city}.` : `${base}.`;
    }

    // Fallback if stripping leaves nothing
    return city
      ? `${t("nearPrefix", lang)} ${address} ${t("inCity", lang)} ${city}.`
      : `${t("nearPrefix", lang)} ${address}.`;
  }

  // Case 3: city only
  if (city) {
    return lang === "hi"
      ? `आप अभी ${city} में हैं।`
      : lang === "mr"
        ? `तुम्ही सध्या ${city} मध्ये आहात.`
        : `You are currently in ${city}.`;
  }

  // Case 4: nothing useful from geocoder
  return t("noAddressFound", lang);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}