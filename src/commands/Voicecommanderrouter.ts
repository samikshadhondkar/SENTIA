/**
 * VoiceCommandRouter.ts
 *
 * Central intent-detection layer for Sentia voice commands.
 *
 * This file is the ONLY place intent-matching strings should live.
 * App.tsx calls the exported helpers; it never hard-codes keyword lists.
 *
 * Current intents:
 *   WHERE_AM_I
 *
 * Roadmap slots (not yet wired — add handlers in App.tsx when ready):
 *   VOICE_SOS        — "save me", "I am in danger", "help me"
 *   START_WALK       — already handled via isWalkWithMeRequest() in utils.ts
 *   STOP_WALK        — already handled inline in stopListening()
 *
 * ─── HOW TO ADD A NEW INTENT ─────────────────────────────────────────────────
 *
 *   1. Add a new VoiceIntent enum value.
 *   2. Add keyword arrays to INTENT_PATTERNS below.
 *   3. Export a typed predicate function  isXxxRequest().
 *   4. In App.tsx stopListening(), add:
 *        if (isXxxRequest(question)) { handleXxx(...); return; }
 *      before the answerConversationally() call.
 *   5. Create src/feature/XxxManager.ts for the logic.
 */

// ─── Intent enum ──────────────────────────────────────────────────────────────

export type VoiceIntent =
  | "WHERE_AM_I"
  | "VOICE_SOS"       // future
  | "START_WALK"      // future (already handled by utils.isWalkWithMeRequest)
  | "STOP_WALK"       // future
  | "UNKNOWN";

// ─── Keyword patterns ─────────────────────────────────────────────────────────

const INTENT_PATTERNS: Record<Exclude<VoiceIntent, "UNKNOWN">, string[]> = {
  WHERE_AM_I: [
    // English
    "where am i",
    "where am i now",
    "what's my location",
    "what is my location",
    "tell me my location",
    "current location",
    "my location",
    "where are we",
    "where are we now",
    // Hindi
    "मैं कहाँ हूँ",
    "मैं कहां हूं",
    "मेरा स्थान",
    "मेरी लोकेशन",
    "मेरी जगह",
    "अभी कहाँ हूँ",
    // Marathi
    "मी कुठे आहे",
    "माझे स्थान",
    "माझी लोकेशन",
    "कुठे आहे मी",
  ],

  VOICE_SOS: [
    // English — future intent, reserved
    "save me",
    "i am in danger",
    "i'm in danger",
    "help me",
    "emergency",
    // Hindi
    "मुझे बचाओ",
    "मदद करो",
    "खतरे में हूँ",
    // Marathi
    "मला वाचवा",
    "मदत करा",
    "धोक्यात आहे",
  ],

  START_WALK: [
    // Kept here for documentation parity; actual matching is in utils.isWalkWithMeRequest
    "walk with me",
    "start walking",
    "guide me",
  ],

  STOP_WALK: [
    // Kept here for documentation parity; actual matching is inline in App.tsx
    "stop walking",
    "stop walk",
    "done walking",
    "exit walk",
  ],
};

// ─── Low-level matcher ────────────────────────────────────────────────────────

function matchesIntent(
  text: string,
  intent: Exclude<VoiceIntent, "UNKNOWN">,
): boolean {
  const lower = text.toLowerCase().trim();
  return INTENT_PATTERNS[intent].some((kw) => lower.includes(kw));
}

// ─── Public predicates ────────────────────────────────────────────────────────

/** Returns true if the spoken text is asking "where am I?" */
export function isWhereAmIRequest(text: string): boolean {
  return matchesIntent(text, "WHERE_AM_I");
}

/**
 * Returns true if the spoken text matches a voice SOS phrase.
 * NOTE: This intent is currently UNHANDLED in App.tsx.
 * Wire it up when VoiceSOSManager is built.
 */
export function isVoiceSosRequest(text: string): boolean {
  return matchesIntent(text, "VOICE_SOS");
}

/**
 * General-purpose classifier — returns the best-matching intent or UNKNOWN.
 * Useful if you want a single routing switch instead of chained if-statements.
 *
 * Example usage in App.tsx:
 *
 *   import { classifyIntent } from './src/commands/VoiceCommandRouter';
 *
 *   const intent = classifyIntent(question);
 *   switch (intent) {
 *     case 'WHERE_AM_I': handleWhereAmI(...); return;
 *     case 'VOICE_SOS':  handleVoiceSOS(...); return;
 *     // … add more cases as features land
 *   }
 *
 * For now App.tsx uses the individual predicate functions, which is equally valid.
 */
export function classifyIntent(text: string): VoiceIntent {
  const intents: Exclude<VoiceIntent, "UNKNOWN">[] = [
    "WHERE_AM_I",
    "VOICE_SOS",
    "START_WALK",
    "STOP_WALK",
  ];
  for (const intent of intents) {
    if (matchesIntent(text, intent)) return intent;
  }
  return "UNKNOWN";
}