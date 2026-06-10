import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import * as Battery from "expo-battery";
import * as Location from "expo-location";
import { Accelerometer } from "expo-sensors";
import * as Speech from "expo-speech";
import { AppState, Linking, Vibration } from "react-native";
import { LangKey } from "../types";

let _groqKey = "";
try {
  _groqKey = require("expo-constants").default.expoConfig?.extra?.groqKey ?? "";
} catch {}
const GROQ_KEY = _groqKey;

let _useDirect = true;
let _proxyBase = "";
try {
  const c = require("../constants");
  _useDirect = c.USE_DIRECT ?? true;
  _proxyBase = c.PROXY_BASE_URL ?? "";
} catch {}

export interface EmergencyContact {
  name: string;
  phone: string;
}

export async function saveEmergencyContacts(contacts: EmergencyContact[]) {
  await AsyncStorage.setItem(
    "sentia_emergency_contacts",
    JSON.stringify(contacts),
  );
}

export async function getEmergencyContacts(): Promise<EmergencyContact[]> {
  const data = await AsyncStorage.getItem("sentia_emergency_contacts");
  if (!data) return [];
  return JSON.parse(data);
}

// ─── BATTERY MONITOR ───
export function startBatteryMonitor() {
  Battery.addBatteryLevelListener(async ({ batteryLevel }) => {
    if (batteryLevel <= 0.15) {
      Speech.speak(
        `Warning. Battery is at ${Math.round(batteryLevel * 100)} percent. Very low. Please charge.`,
      );
      const contacts = await getEmergencyContacts();
      if (contacts.length === 0) return;
      const msg = encodeURIComponent(
        `⚠️ SENTIA: Battery low (${Math.round(batteryLevel * 100)}%). Please check on the user.`,
      );
      setTimeout(() => {
        Linking.openURL(`sms:${contacts[0].phone}?body=${msg}`);
      }, 3000);
    }
  });
}

// ─── FALL DETECTION ───
let fallDetectionSub: { remove: () => void } | null = null;
let fallCooldown = false;

export function startFallDetection(onFall: () => void) {
  stopFallDetection();
  Accelerometer.setUpdateInterval(200);
  fallDetectionSub = Accelerometer.addListener(({ x, y, z }) => {
    const total = Math.sqrt(x * x + y * y + z * z);
    if (total < 0.15 && !fallCooldown) {
      fallCooldown = true;
      onFall();
      setTimeout(() => {
        fallCooldown = false;
      }, 10000);
    }
  });
}

export function stopFallDetection() {
  if (fallDetectionSub) {
    fallDetectionSub.remove();
    fallDetectionSub = null;
  }
}

// ─── NEAREST HOSPITAL ───
async function getNearestHospital(
  lat: number,
  lon: number,
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=hospital&lat=${lat}&lon=${lon}&format=json&limit=1`,
    );
    const data = await response.json();
    if (data.length > 0) return data[0].display_name.split(",")[0];
    return null;
  } catch {
    return null;
  }
}

// ─── NEAREST POLICE STATION ───
async function getNearestPoliceStation(
  lat: number,
  lon: number,
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=police+station&lat=${lat}&lon=${lon}&format=json&limit=1`,
    );
    const data = await response.json();
    if (data.length > 0) return data[0].display_name.split(",")[0];
    return null;
  } catch {
    return null;
  }
}

// ─── VOICE TRIGGER ───
export function checkVoiceTrigger(transcript: string, onTrigger: () => void) {
  const triggerWords = [
    "help",
    "help me",
    "save me",
    "please help",
    "emergency",
    "danger",
    "sos",
    "bachao",
    "madad",
    "bachao mujhe",
    "mujhe bachao",
    "मदद",
    "मदद करो",
    "बचाओ",
    "मुझे बचाओ",
    "मदत",
    "वाचवा",
    "मला वाचवा",
  ];
  const lower = transcript.toLowerCase();
  if (triggerWords.some((word) => lower.includes(word))) onTrigger();
}

// ─── SPEAK HELPER (waits for TTS to finish before resolving) ───
function speakLang(text: string, lang: LangKey): Promise<void> {
  return new Promise((resolve) => {
    Speech.stop();
    // Small gap so previous speech fully stops
    setTimeout(() => {
      Speech.speak(text, {
        language: lang === "hi" ? "hi-IN" : lang === "mr" ? "mr-IN" : "en-US",
        rate: 0.92,
        onDone: () => resolve(),
        onError: () => resolve(),
      });
    }, 150);
  });
}

// ─── TRANSCRIBE AUDIO ───
async function transcribeAudio(
  uri: string,
  lang: LangKey = "en",
): Promise<string> {
  try {
    const formData = new FormData();
    formData.append("file", {
      uri,
      type: "audio/m4a",
      name: "audio.m4a",
    } as any);
    formData.append("model", "whisper-large-v3");
    if (lang !== "mr") formData.append("language", lang === "hi" ? "hi" : "en");

    let resp: Response;
    if (_useDirect) {
      resp = await fetch(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${GROQ_KEY}` },
          body: formData,
        },
      );
    } else {
      resp = await fetch(`${_proxyBase}/groq/transcribe`, {
        method: "POST",
        body: formData,
      });
    }
    const data = await resp.json();
    return (data?.text ?? "").trim().toLowerCase();
  } catch {
    return "";
  }
}

// ─── RECORD AUDIO HELPER ───
async function recordAudio(durationMs: number): Promise<string | null> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });
    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY,
    );
    await new Promise((r) => setTimeout(r, durationMs));
    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });
    return recording.getURI();
  } catch {
    return null;
  }
}

function normalizeVoiceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSpelledName(text: string): string | null {
  const norm = normalizeVoiceText(text);
  const letters = norm
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z]/g, ""))
    .filter(Boolean)
    .join("");

  if (letters.length >= 2) return letters;
  return null;
}

function isYes(text: string): boolean {
  const norm = normalizeVoiceText(text);
  return [
    "yes",
    "haan",
    "haan ji",
    "ho",
    "han",
    "correct",
    "right",
    "ok",
    "okay",
    "hmm",
    "हाँ",
    "हो",
    "हां",
    "हा",
  ].some((w) => norm.includes(w));
}

function isNo(text: string): boolean {
  const norm = normalizeVoiceText(text);
  return [
    "no",
    "nahi",
    "nako",
    "wrong",
    "incorrect",
    "not correct",
    "not right",
    "wrong number",
    "नहीं",
    "नाही",
    "नको",
    "गलत",
    "चुका",
    "चुकीचे",
  ].some((w) => norm.includes(w));
}

async function askYesNoQuestion(
  question: string,
  lang: LangKey,
): Promise<boolean> {
  await speakLang(question, lang);
  const uri = await recordAudio(5000);
  if (!uri) return false;
  const answer = normalizeVoiceText(await transcribeAudio(uri, lang));
  return isYes(answer) && !isNo(answer);
}

async function speakNearbyServices(
  lang: LangKey,
  locationInfo?: { lat: number; lon: number },
): Promise<void> {
  if (!locationInfo || locationInfo.lat === 0) {
    await speakLang(
      lang === "hi"
        ? "मदद के लिए आप 100 पर कॉल कर सकते हैं।"
        : lang === "mr"
          ? "मदतीसाठी तुम्ही 100 वर कॉल करू शकता."
          : "For help, you can call the police helpline 100.",
      lang,
    );
    return;
  }

  const [hospital, police] = await Promise.all([
    getNearestHospital(locationInfo.lat, locationInfo.lon),
    getNearestPoliceStation(locationInfo.lat, locationInfo.lon),
  ]);

  if (hospital) {
    await speakLang(
      lang === "hi"
        ? `नजदीकी अस्पताल है ${hospital}.`
        : lang === "mr"
          ? `जवळचे रुग्णालय आहे ${hospital}.`
          : `Nearest hospital is ${hospital}.`,
      lang,
    );
  }

  if (police) {
    await speakLang(
      lang === "hi"
        ? `नजदीकी पुलिस स्टेशन है ${police}.`
        : lang === "mr"
          ? `जवळचे पोलीस स्टेशन आहे ${police}.`
          : `Nearest police station is ${police}.`,
      lang,
    );
  }

  const wantPoliceCall = await askYesNoQuestion(
    lang === "hi"
      ? "क्या आप पुलिस हेल्पलाइन पर कॉल करना चाहते हैं? हाँ या नहीं बोलें।"
      : lang === "mr"
        ? "तुम्हाला पोलीस हेल्पलाइनवर कॉल करायचा आहे का? हो किंवा नाही म्हणा."
        : "Do you want to call the police helpline? Say yes or no.",
    lang,
  );
  if (wantPoliceCall) {
    await Linking.openURL("tel:100");
  }
}

function isUnclear(text: string): boolean {
  const norm = normalizeVoiceText(text);
  if (norm.length === 0) return true;
  return [
    "unclear",
    "not clear",
    "couldn't hear",
    "could not hear",
    "cant hear",
    "can't hear",
    "didn't hear",
    "did not hear",
    "repeat",
    "again",
    "not understood",
    "don't know",
    "dont know",
    "unknown",
    "अस्पष्ट",
    "सुनाई नहीं दिया",
    "ऐकू आले नाही",
    "पुन्हा",
    "समझा नहीं",
    "समजले नाही",
  ].some((w) => norm.includes(w));
}

// ─── WAIT FOR APP TO RETURN TO FOREGROUND ───
function waitForAppReturn(timeoutMs = 30000): Promise<void> {
  return new Promise((resolve) => {
    let wentBackground = false;
    const sub = AppState.addEventListener("change", (state: string) => {
      if (state === "background" || state === "inactive") {
        wentBackground = true;
      }
      if (state === "active" && wentBackground) {
        sub.remove();
        resolve();
      }
    });
    // Safety timeout
    setTimeout(() => {
      sub.remove();
      resolve();
    }, timeoutMs);
  });
}

// ─── SAVE ONE CONTACT ───
// FIX: proper retry on "no", no hospital interruption, clean async flow
async function saveOneContact(
  lang: LangKey,
  contactNum: number,
): Promise<EmergencyContact | null> {
  // ── Step 1: Get name (retry loop) ──
  let confirmedName: string | null = null;

  while (!confirmedName) {
    await speakLang(
      lang === "hi"
        ? `Guardian ${contactNum} का नाम बोलें`
        : lang === "mr"
          ? `Guardian ${contactNum} चे नाव सांगा`
          : `Say the name for Guardian ${contactNum}`,
      lang,
    );

    const nameUri = await recordAudio(5000);
    if (!nameUri) return null;

    const nameText = await transcribeAudio(nameUri, lang);
    if (!nameText) {
      await speakLang(
        lang === "hi"
          ? "नाम नहीं सुना। फिर कोशिश करें।"
          : lang === "mr"
            ? "नाव ऐकू आले नाही. पुन्हा प्रयत्न करा."
            : "Could not hear the name. Please try again.",
        lang,
      );
      continue; // retry name
    }

    // Confirm name
    await speakLang(
      lang === "hi"
        ? `नाम है ${nameText}। सही है तो हाँ बोलें, गलत है तो नहीं बोलें।`
        : lang === "mr"
          ? `नाव आहे ${nameText}. बरोबर असेल तर हो म्हणा, चुकीचे असेल तर नाही म्हणा.`
          : `Name is ${nameText}. Say yes to confirm, or no to try again.`,
      lang,
    );

    const nameConfirmUri = await recordAudio(4000);
    if (!nameConfirmUri) {
      // Can't record confirmation — treat as confirmed to avoid infinite loop
      confirmedName = nameText;
      break;
    }

    const nameConfirmRaw = await transcribeAudio(nameConfirmUri, lang);
    const nameConfirm = normalizeVoiceText(nameConfirmRaw);
    console.log(`[SOS] Name confirm heard: "${nameConfirmRaw}"`);

    if (!nameConfirm || isUnclear(nameConfirm)) {
      await speakLang(
        lang === "hi"
          ? "नाम स्पष्ट नहीं सुना। हाँ या नहीं बोलें।"
          : lang === "mr"
            ? "नाव स्पष्ट ऐकू आले नाही. हो किंवा नाही म्हणा."
            : "I could not hear that clearly. Please say yes or no.",
        lang,
      );
      continue;
    }

    if (isNo(nameConfirm)) {
      await speakLang(
        lang === "hi"
          ? "ठीक है। नाम सही नहीं है। अब अक्षर बोलें, जैसे के-यू-एस-एच-आई।"
          : lang === "mr"
            ? "ठीक आहे. नाव बरोबर नाही. आता अक्षरे सांगा, जसे के-यु-एस-एच-आय."
            : "Okay. The name is not correct. Please spell it slowly, letter by letter.",
        lang,
      );
      const correctionUri = await recordAudio(6000);
      if (correctionUri) {
        const correctedName = extractSpelledName(
          await transcribeAudio(correctionUri, lang),
        );
        if (correctedName) {
          confirmedName = correctedName;
          await speakLang(
            lang === "hi"
              ? `ठीक है। मैं ${correctedName} रख रहा हूँ।`
              : lang === "mr"
                ? `ठीक आहे. मी ${correctedName} ठेवतो.`
                : `Okay. I will use ${correctedName}.`,
            lang,
          );
          continue;
        }
      }
      await speakLang(
        lang === "hi"
          ? "नाम समझ नहीं आया। कृपया फिर से बोलें।"
          : lang === "mr"
            ? "नाव ऐकू आले नाही. कृपया पुन्हा सांगा."
            : "I could not read the spelling. Please try again.",
        lang,
      );
      continue;
    }

    if (!isYes(nameConfirm)) {
      await speakLang(
        lang === "hi"
          ? "कृपया हाँ या नहीं बोलें।"
          : lang === "mr"
            ? "कृपया हो किंवा नाही म्हणा."
            : "Please say yes or no clearly.",
        lang,
      );
      continue;
    }

    confirmedName = nameText;
  }

  if (!confirmedName) return null;
  const finalName = confirmedName;

  // ── Step 2: Get phone number (max 3 attempts) ──
  for (let attempt = 0; attempt < 3; attempt++) {
    await speakLang(
      lang === "hi"
        ? `${finalName} का दस अंकों का फ़ोन नंबर बोलें`
        : lang === "mr"
          ? `${finalName} चा दहा अंकांचा फोन नंबर सांगा`
          : `Say the 10-digit phone number for ${finalName}`,
      lang,
    );

    const numUri = await recordAudio(8000);
    if (!numUri) continue;

    const numText = await transcribeAudio(numUri, lang);
    const digits = numText.replace(/\D/g, "");

    if (digits.length !== 10) {
      await speakLang(
        lang === "hi"
          ? `${digits.length} अंक मिले। दस अंकों का नंबर चाहिए। फिर बोलें।`
          : lang === "mr"
            ? `${digits.length} अंक मिळाले. दहा अंकांचा नंबर हवा. पुन्हा सांगा.`
            : `Got ${digits.length} digits. Need exactly 10. Please try again.`,
        lang,
      );
      continue;
    }

    // Spell out the number for confirmation
    const spokenDigits = digits.split("").join(", ");
    await speakLang(
      lang === "hi"
        ? `नंबर है ${spokenDigits}। सही है तो हाँ बोलें, गलत है तो नहीं बोलें।`
        : lang === "mr"
          ? `नंबर आहे ${spokenDigits}. बरोबर असेल तर हो म्हणा, चुकीचे असेल तर नाही म्हणा.`
          : `Number is ${spokenDigits}. Say yes to confirm, or no to try again.`,
      lang,
    );

    const numConfirmUri = await recordAudio(4000);
    if (!numConfirmUri) {
      // Can't record — treat as confirmed
      await speakLang(
        lang === "hi"
          ? `${finalName} सेव हो गया!`
          : lang === "mr"
            ? `${finalName} जतन केले!`
            : `${finalName} saved!`,
        lang,
      );
      return { name: finalName, phone: digits };
    }

    const numConfirmRaw = await transcribeAudio(numConfirmUri, lang);
    const numConfirm = normalizeVoiceText(numConfirmRaw);
    console.log(`[SOS] Number confirm heard: "${numConfirmRaw}"`);

    if (!numConfirm || isUnclear(numConfirm)) {
      await speakLang(
        lang === "hi"
          ? "नंबर स्पष्ट नहीं सुना। हाँ या नहीं बोलें।"
          : lang === "mr"
            ? "नंबर स्पष्ट ऐकू आला नाही. हो किंवा नाही म्हणा."
            : "I could not hear the number clearly. Please say yes or no.",
        lang,
      );
      continue;
    }

    if (isNo(numConfirm)) {
      await speakLang(
        lang === "hi"
          ? "ठीक है, नंबर फिर बोलें।"
          : lang === "mr"
            ? "ठीक आहे, नंबर पुन्हा सांगा."
            : "Okay, please say the number again.",
        lang,
      );
      continue;
    }

    if (!isYes(numConfirm)) {
      await speakLang(
        lang === "hi"
          ? "कृपया हाँ या नहीं बोलें।"
          : lang === "mr"
            ? "कृपया हो किंवा नाही म्हणा."
            : "Please say yes or no clearly.",
        lang,
      );
      continue;
    }

    await speakLang(
      lang === "hi"
        ? `${finalName} सेव हो गया!`
        : lang === "mr"
          ? `${finalName} जतन केले!`
          : `${finalName} saved successfully!`,
      lang,
    );
    return { name: finalName, phone: digits };
  }

  // All 3 attempts failed
  await speakLang(
    lang === "hi"
      ? "तीन बार गलत नंबर। इस contact को छोड़ रहे हैं।"
      : lang === "mr"
        ? "तीनदा चुकीचा नंबर. हा संपर्क वगळत आहे."
        : "Three failed attempts. Skipping this contact.",
    lang,
  );
  return null;
}

// ─── SAVE ALL 3 CONTACTS ───
export async function saveAllEmergencyContacts(
  lang: LangKey,
): Promise<EmergencyContact[]> {
  const contacts: EmergencyContact[] = [];

  for (let i = 1; i <= 3; i++) {
    const contact = await saveOneContact(lang, i);
    if (contact) {
      contacts.push(contact);
    } else {
      await speakLang(
        lang === "hi"
          ? `Guardian ${i} सेव नहीं हुआ। अगले पर जा रहे हैं।`
          : lang === "mr"
            ? `Guardian ${i} जतन झाला नाही. पुढे जात आहे.`
            : `Guardian ${i} could not be saved. Moving to next.`,
        lang,
      );
    }
  }

  if (contacts.length > 0) {
    await saveEmergencyContacts(contacts);
    await speakLang(
      lang === "hi"
        ? `${contacts.length} emergency contacts सेव हो गए!`
        : lang === "mr"
          ? `${contacts.length} आणीबाणी संपर्क जतन केले!`
          : `${contacts.length} emergency contact${contacts.length > 1 ? "s" : ""} saved successfully!`,
      lang,
    );
  } else {
    await speakLang(
      lang === "hi"
        ? "कोई contact सेव नहीं हुआ।"
        : lang === "mr"
          ? "कोणताही संपर्क जतन झाला नाही."
          : "No contacts were saved.",
      lang,
    );
  }

  return contacts;
}

// ─── CALL CONTACTS SEQUENTIALLY ───
// FIX: proper AppState-based flow, "press back to return" prompt,
//      after all tried → speak hospital + police station + calm message
export async function callContactsSequentially(
  contacts: EmergencyContact[],
  lang: LangKey,
  index = 0,
  locationInfo?: { lat: number; lon: number },
): Promise<void> {
  if (index >= contacts.length) {
    // All contacts tried — speak reassurance + nearby services
    await speakLang(
      lang === "hi"
        ? "सभी contacts को call किया जा चुका है।"
        : lang === "mr"
          ? "सर्व संपर्कांना call केले आहे."
          : "All emergency contacts have been tried.",
      lang,
    );

    await speakNearbyServices(lang, locationInfo);

    // Final calm reassurance
    await speakLang(
      lang === "hi"
        ? "शांत रहें। मदद रास्ते में है। आप सुरक्षित हैं।"
        : lang === "mr"
          ? "शांत राहा. मदत येत आहे. तुम्ही सुरक्षित आहात."
          : "Stay calm. Help is on the way. You are going to be okay.",
      lang,
    );
    return;
  }

  const contact = contacts[index];

  await speakLang(
    lang === "hi"
      ? `${contact.name} को call किया जा रहा है।`
      : lang === "mr"
        ? `${contact.name} ला call करत आहे.`
        : `Calling ${contact.name} now.`,
    lang,
  );

  // Small pause then open dialer
  await new Promise((r) => setTimeout(r, 1200));
  Linking.openURL(`tel:${contact.phone}`);

  // Wait for user to go to phone app and come back
  // Speak instruction first (before they leave the app)
  // Note: speakLang won't be heard once they switch to dialer,
  // so we speak BEFORE opening the URL — already done above.
  // Now wait for them to return:
  await waitForAppReturn(60000); // up to 60s

  // They're back — small pause for dialer to fully close
  await new Promise((r) => setTimeout(r, 2000));

  // FIX: tell user to press back, then ask if connected
  await speakLang(
    lang === "hi"
      ? `क्या ${contact.name} से बात हुई? हाँ या नहीं बोलें।`
      : lang === "mr"
        ? `${contact.name} शी बोलणे झाले का? हो किंवा नाही म्हणा.`
        : `Were you connected with ${contact.name}? Say yes or no.`,
    lang,
  );

  const ansUri = await recordAudio(5000);
  if (ansUri) {
    const answer = await transcribeAudio(ansUri, lang);
    console.log(`[SOS] Connection confirm for ${contact.name}: "${answer}"`);

    if (isYes(answer)) {
      await speakLang(
        lang === "hi"
          ? "ठीक है। मदद आ रही है। शांत रहें।"
          : lang === "mr"
            ? "ठीक आहे. मदत येत आहे. शांत राहा."
            : "Good. Help is on the way. Stay calm.",
        lang,
      );

      await speakNearbyServices(lang, locationInfo);
      return;
    }
  }

  // Not connected — try next contact
  if (index + 1 < contacts.length) {
    await speakLang(
      lang === "hi"
        ? `${contact.name} से संपर्क नहीं हुआ। अगले contact पर जा रहे हैं।`
        : lang === "mr"
          ? `${contact.name} शी संपर्क झाला नाही. पुढील संपर्कावर जात आहे.`
          : `Could not reach ${contact.name}. Trying the next contact.`,
      lang,
    );
  }

  await callContactsSequentially(contacts, lang, index + 1, locationInfo);
}

// ─── MAIN SOS TRIGGER ───
// FIX: no hospital speech during SMS flow, passes locationInfo to callContactsSequentially
export async function triggerSOSFull(
  lang: LangKey,
): Promise<{ lat: number; lon: number } | null> {
  try {
    Vibration.vibrate([
      0, 500, 200, 500, 200, 500, 200, 500, 200, 500, 200, 500, 200, 500, 200,
      500,
    ]);

    const contacts = await getEmergencyContacts();

    // Get location
    const { status } = await Location.requestForegroundPermissionsAsync();
    let mapsLink = "Location unavailable";
    let latitude = 0;
    let longitude = 0;

    if (status === "granted") {
      await speakLang(
        lang === "hi"
          ? "लोकेशन मिल रही है।"
          : lang === "mr"
            ? "स्थान मिळवत आहे."
            : "Getting your location.",
        lang,
      );
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        latitude = location.coords.latitude;
        longitude = location.coords.longitude;
        mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`;
      } catch {
        // Location failed — continue without it
      }
    }

    const locationInfo =
      latitude !== 0 ? { lat: latitude, lon: longitude } : undefined;

    if (contacts.length > 0) {
      const recipients = contacts
        .map((contact) => contact.phone)
        .filter(Boolean)
        .join(",");
      const guardianNames = contacts.map((contact) => contact.name).join(", ");
      const smsBody = encodeURIComponent(
        `🆘 SENTIA EMERGENCY!\n${guardianNames} needs help!\nLocation: ${mapsLink}\nPlease respond immediately!`,
      );

      await speakLang(
        lang === "hi"
          ? "संदेश तैयार है। Send बटन दबाएं, फिर Back बटन दबाकर Sentia पर वापस आएं।"
          : lang === "mr"
            ? "संदेश तयार आहे. Send बटन दाबा, नंतर Back बटन दाबून Sentia वर परत या."
            : "Message ready. Press Send to send it, then press Back to return to Sentia.",
        lang,
      );

      await new Promise((r) => setTimeout(r, 800));
      await Linking.openURL(`sms:${recipients}?body=${smsBody}`);

      // FIX: Return locationInfo so caller (app.tsx) can pass it to callContactsSequentially
      return locationInfo ?? null;
    }

    return locationInfo ?? null;
  } catch (error) {
    console.log("SOS Error:", error);
    return null;
  }
}
