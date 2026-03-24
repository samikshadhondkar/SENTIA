import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { Accelerometer } from "expo-sensors";
import * as Speech from "expo-speech";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";

// ─── YOUR API KEYS ────────────────────────────────────────────────────────────
const GROQ_API_KEY = "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";
const OPENROUTER_API_KEY = "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";
// ─────────────────────────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS = 1000;

// ─── HAZARD — only triggers on explicit urgent phrases at START ───────────────
const HAZARD_PHRASES = ["warning!", "danger!", "चेतावनी!", "सावधान!", "watch out!"];
const isHazard = (text: string): boolean => {
  const lower = text.toLowerCase().trim();
  return HAZARD_PHRASES.some((k) => lower.startsWith(k));
};

// ─── LANGUAGES ───────────────────────────────────────────────────────────────
const LANGUAGES = {
  en: {
    label: "English",
    tts: "en-US",
    scanPrompt: `You are Sentia, a warm and caring AI assistant for visually impaired users.
Look at this image and describe in 1-2 short natural sentences: who is there (with emotion if visible), what objects are nearby, any text or signs, directions (left/right/ahead).
ONLY start with "WARNING!" if you see an IMMEDIATE physical danger like fire, someone falling, or a vehicle about to hit the person.
Use a warm, calm, caring tone — like a caring friend gently guiding someone. Never sound alarming unless it is a real WARNING.
Max 30 words.`,
    readPrompt: `You are Sentia, a warm reading assistant for visually impaired users.
Read ALL text visible in this image out loud. Include currency notes (state denomination clearly), book text, signs, labels, medicine names, dosage, expiry dates.
Read in a warm, clear, calm voice — like a caring person reading to a dear friend.`,
    voicePrompt: `You are Sentia, a warm and caring AI assistant for visually impaired users.
The user asked: "{question}".
ONLY start with "WARNING!" if you see an IMMEDIATE physical danger.
Answer in a warm, calm, caring tone in 1-2 sentences. Max 40 words.`,
    welcomeMessage: "Welcome to Sentia. I am here to help you. Tap once to start scanning. Double tap to stop. Hold to read text. Long hold to ask me anything. Shake phone to open settings.",
    scanStarted: "Scanning started. I am looking around for you.",
    scanStopped: "Scanning stopped. I am here whenever you need me.",
    readMode: "Reading mode. Please point your camera at the text, book, or currency.",
    voiceMode: "I am listening. Please speak your question now.",
    yes: "Of course, let me help you with that.",
    fallback: "I am here with you. Camera is active.",
    tapToScan: "Tap to scan",
    doubleTapToStop: "Double tap to stop",
    holdToRead: "Hold to read",
    longHoldToAsk: "Long hold to ask",
    settingsOpen: "Settings open. Tap once for female voice. Double tap for male voice. Shake phone to close.",
    femaleSelected: "Female voice selected. I will speak softly for you.",
    maleSelected: "Male voice selected. I will speak calmly for you.",
    settingsClosed: "Settings closed. Tap to start scanning whenever you are ready.",
  },
  hi: {
    label: "हिंदी",
    tts: "hi-IN",
    scanPrompt: `आप Sentia हैं, दृष्टिहीन उपयोगकर्ताओं के लिए एक गर्मजोशी भरी AI सहायक।
इस छवि को देखें और 1-2 छोटे वाक्यों में बताएं: कौन है (भावना सहित), क्या वस्तुएं हैं, दिशाएं।
केवल तभी "चेतावनी!" से शुरू करें जब आग, कोई गिर रहा हो, या वाहन टकराने वाला हो।
गर्मजोशी और शांत स्वर में बोलें जैसे एक प्रिय मित्र मार्गदर्शन कर रहा हो।
हिंदी में जवाब दें। अधिकतम 30 शब्द।`,
    readPrompt: `आप Sentia हैं। इस छवि में दिखाई देने वाला सभी टेक्स्ट पढ़ें।
मुद्रा नोट हो तो मूल्य स्पष्ट बताएं। दवा हो तो नाम, खुराक, समाप्ति तिथि बताएं।
गर्मजोशी और शांत स्वर में पढ़ें जैसे किसी प्रिय को पढ़कर सुना रहे हों।
हिंदी में जवाब दें।`,
    voicePrompt: `आप Sentia हैं। उपयोगकर्ता ने पूछा: "{question}"।
केवल तभी "चेतावनी!" से शुरू करें जब तत्काल खतरा हो।
गर्मजोशी और शांत स्वर में उत्तर दें। हिंदी में। अधिकतम 40 शब्द।`,
    welcomeMessage: "Sentia में आपका स्वागत है। मैं आपकी मदद के लिए यहां हूं। स्कैन के लिए एक बार टैप करें। बंद करने के लिए दो बार टैप करें। पढ़ने के लिए दबाएं। सवाल के लिए लंबे समय तक दबाएं। सेटिंग्स के लिए फोन हिलाएं।",
    scanStarted: "स्कैनिंग शुरू हुई। मैं आपके लिए देख रही हूं।",
    scanStopped: "स्कैनिंग बंद हुई। जब भी जरूरत हो मैं यहां हूं।",
    readMode: "पठन मोड। कृपया कैमरा टेक्स्ट, किताब या नोट की तरफ करें।",
    voiceMode: "मैं सुन रही हूं। अपना सवाल बोलें।",
    yes: "बिल्कुल, मैं आपकी मदद करती हूं।",
    fallback: "मैं आपके साथ हूं। कैमरा सक्रिय है।",
    tapToScan: "टैप करें",
    doubleTapToStop: "दो बार टैप करें",
    holdToRead: "दबाकर पढ़ें",
    longHoldToAsk: "लंबे समय तक दबाएं",
    settingsOpen: "सेटिंग्स खुली। महिला आवाज़ के लिए एक बार टैप करें। पुरुष आवाज़ के लिए दो बार टैप करें। बंद करने के लिए फोन हिलाएं।",
    femaleSelected: "महिला आवाज़ चुनी गई। मैं आपके लिए मधुर स्वर में बोलूंगी।",
    maleSelected: "पुरुष आवाज़ चुनी गई। मैं आपके लिए शांत स्वर में बोलूंगा।",
    settingsClosed: "सेटिंग्स बंद। जब चाहें स्कैन के लिए टैप करें।",
  },
  mr: {
    label: "मराठी",
    tts: "mr-IN",
    scanPrompt: `तुम्ही Sentia आहात, दृष्टिहीन वापरकर्त्यांसाठी एक उबदार AI सहाय्यक.
या प्रतिमेकडे पाहा आणि 1-2 छोट्या वाक्यांमध्ये सांगा: कोण आहे (भावनेसह), काय वस्तू आहेत, दिशा.
फक्त तेव्हाच "सावधान!" ने सुरुवात करा जेव्हा आग, कोणी पडत असेल किंवा वाहन धडकणार असेल.
उबदार आणि शांत स्वरात बोला जसे एक प्रिय मित्र मार्गदर्शन करत आहे.
मराठीत उत्तर द्या. जास्तीत जास्त 30 शब्द.`,
    readPrompt: `तुम्ही Sentia आहात. या प्रतिमेत दिसणारा सर्व मजकूर वाचा.
चलन नोट असेल तर मूल्य स्पष्ट सांगा. औषध असेल तर नाव, डोस, कालबाह्यता तारीख सांगा.
उबदार आणि शांत स्वरात वाचा जसे एखाद्या प्रिय व्यक्तीला वाचून दाखवत आहात.
मराठीत उत्तर द्या.`,
    voicePrompt: `तुम्ही Sentia आहात. वापरकर्त्याने विचारले: "{question}".
फक्त तेव्हाच "सावधान!" ने सुरुवात करा जेव्हा तात्काळ धोका असेल.
उबदार आणि शांत स्वरात उत्तर द्या. मराठीत. जास्तीत जास्त 40 शब्द.`,
    welcomeMessage: "Sentia मध्ये स्वागत आहे. मी तुमच्यासाठी इथे आहे. स्कॅनसाठी एकदा टॅप करा. थांबवण्यासाठी दोनदा टॅप करा. वाचण्यासाठी दाबा. प्रश्नासाठी जास्त वेळ दाबा. सेटिंग्जसाठी फोन हलवा.",
    scanStarted: "स्कॅनिंग सुरू झाली. मी तुमच्यासाठी पाहत आहे.",
    scanStopped: "स्कॅनिंग थांबली. जेव्हा गरज असेल तेव्हा मी इथे आहे.",
    readMode: "वाचन मोड. कृपया कॅमेरा मजकूर, पुस्तक किंवा नोटकडे करा.",
    voiceMode: "मी ऐकत आहे. तुमचा प्रश्न बोला.",
    yes: "नक्कीच, मी तुम्हाला मदत करते.",
    fallback: "मी तुमच्यासोबत आहे. कॅमेरा सक्रिय आहे.",
    tapToScan: "टॅप करा",
    doubleTapToStop: "दोनदा टॅप करा",
    holdToRead: "दाबून वाचा",
    longHoldToAsk: "जास्त वेळ दाबा",
    settingsOpen: "सेटिंग्स उघडली. महिला आवाजासाठी एकदा टॅप करा. पुरुष आवाजासाठी दोनदा टॅप करा. बंद करण्यासाठी फोन हलवा.",
    femaleSelected: "महिला आवाज निवडला. मी तुमच्यासाठी मधुर स्वरात बोलेन.",
    maleSelected: "पुरुष आवाज निवडला. मी तुमच्यासाठी शांत स्वरात बोलेन.",
    settingsClosed: "सेटिंग्स बंद. तयार असाल तेव्हा स्कॅनसाठी टॅप करा.",
  },
};

type LangKey = keyof typeof LANGUAGES;
type AppMode = "idle" | "scanning" | "reading" | "listening" | "settings";

export default function SentiaApp() {
  const [permission, requestPermission] = useCameraPermissions();
  const [audioPermission, setAudioPermission] = useState(false);
  const [language, setLanguage] = useState<LangKey | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [mode, setMode] = useState<AppMode>("idle");
  const [isHazardAlert, setIsHazardAlert] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");

  const cameraRef = useRef<CameraView>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScanningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const lastTapTimeRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceGenderRef = useRef<"female" | "male">("female");

  // Keep voiceGenderRef in sync
  useEffect(() => { voiceGenderRef.current = voiceGender; }, [voiceGender]);

  // ─── INIT ────────────────────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem("sentia_lang").then((val) => {
      if (val) setLanguage(val as LangKey);
    });
    AsyncStorage.getItem("sentia_voice").then((val) => {
      if (val) {
        setVoiceGender(val as "female" | "male");
        voiceGenderRef.current = val as "female" | "male";
      }
    });
    Audio.requestPermissionsAsync().then(({ granted }) => {
      setAudioPermission(granted);
    });

    // ── Shake detection ──────────────────────────────────────────────────
    let lastX = 0, lastY = 0, lastZ = 0;
    let lastShakeTime = 0;

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const deltaX = Math.abs(x - lastX);
      const deltaY = Math.abs(y - lastY);
      const deltaZ = Math.abs(z - lastZ);
      lastX = x; lastY = y; lastZ = z;

      const acceleration = deltaX + deltaY + deltaZ;
      const now = Date.now();

      if (acceleration > 2.5 && now - lastShakeTime > 2000) {
        lastShakeTime = now;
        setShowSettings((prev) => {
          const next = !prev;
          if (next) {
            // Opening settings
            setIsScanning(false);
            Speech.stop();
          }
          return next;
        });
      }
    });

    Accelerometer.setUpdateInterval(100);
    return () => subscription.remove();
  }, []);

  // ── Welcome message ──────────────────────────────────────────────────────
  useEffect(() => {
    if (language) {
      setTimeout(() => speakRaw(LANGUAGES[language].welcomeMessage, language), 600);
    }
  }, [language]);

  // ── Settings voice instructions ──────────────────────────────────────────
  useEffect(() => {
    if (showSettings && language) {
      Speech.stop();
      setTimeout(() => {
        speakRaw(LANGUAGES[language].settingsOpen, language);
      }, 400);
    } else if (!showSettings && language) {
      // Speak closed message only if language already set
    }
  }, [showSettings]);

  // ── Scanning loop ────────────────────────────────────────────────────────
  useEffect(() => {
    isScanningRef.current = isScanning;
    if (isScanning) {
      setMode("scanning");
      setTimeout(() => runScan(), 500);
    } else {
      if (scanTimer.current) clearTimeout(scanTimer.current);
      Speech.stop();
      isSpeakingRef.current = false;
      setStatus("Ready");
      setIsLoading(false);
      setIsHazardAlert(false);
      if (mode === "scanning") setMode("idle");
    }
  }, [isScanning]);

  // ─── SPEAK RAW (no gender ref needed — direct call) ───────────────────────
  const speakRaw = (
    text: string,
    lang: LangKey,
    urgent = false,
    gender?: "female" | "male"
  ) => {
    Speech.stop();
    isSpeakingRef.current = true;
    const g = gender ?? voiceGenderRef.current;
    setTimeout(() => {
      Speech.speak(text, {
        language: LANGUAGES[lang].tts,
        rate: urgent ? 1.1 : 0.78,
        pitch: urgent ? 1.3 : g === "male" ? 0.75 : 1.1,
        onDone: () => { isSpeakingRef.current = false; },
        onError: () => { isSpeakingRef.current = false; },
      });
    }, urgent ? 0 : 200);
  };

  const speak = (text: string, lang: LangKey, urgent = false) => {
    speakRaw(text, lang, urgent);
  };

  // ─── HAZARD ALERT ────────────────────────────────────────────────────────
  const triggerHazardAlert = (text: string, lang: LangKey) => {
    Vibration.vibrate([0, 500, 200, 500, 200, 500]);
    setIsHazardAlert(true);
    speak(text, lang, true);
    setTimeout(() => {
      speak(text, lang, true);
      setTimeout(() => setIsHazardAlert(false), 4000);
    }, 3000);
  };

  // ─── SCAN LOOP ───────────────────────────────────────────────────────────
  const runScan = async () => {
    if (!isScanningRef.current) return;
    if (isSpeakingRef.current) {
      scanTimer.current = setTimeout(runScan, 500);
      return;
    }
    await analyzeFrame("scan");
    if (isScanningRef.current) {
      scanTimer.current = setTimeout(runScan, SCAN_INTERVAL_MS);
    }
  };

  // ─── ANALYZE FRAME ───────────────────────────────────────────────────────
  const analyzeFrame = async (
    frameMode: "scan" | "read" | "voice",
    question?: string
  ) => {
    if (!cameraRef.current || !language || isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      setIsLoading(true);
      setStatus("Capturing...");

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.3,
        base64: true,
        skipProcessing: false,
      });

      if (!photo?.base64) { setStatus("Capture failed"); return; }

      const resized = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 320 } }],
        { base64: true, compress: 0.5, format: ImageManipulator.SaveFormat.JPEG }
      );

      if (!resized.base64) return;

      let prompt = "";
      if (frameMode === "read") {
        prompt = LANGUAGES[language].readPrompt;
      } else if (frameMode === "voice" && question) {
        prompt = LANGUAGES[language].voicePrompt.replace("{question}", question);
      } else {
        prompt = LANGUAGES[language].scanPrompt;
      }

      const result = await callAI(resized.base64, language, prompt);
      if (!isScanningRef.current && frameMode === "scan") return;

      setDescription(result);

      if (isHazard(result)) {
        triggerHazardAlert(result, language);
      } else {
        setStatus("Speaking...");
        speak(result, language);
      }

    } catch (err: any) {
      console.error("analyzeFrame error:", err);
      setStatus("Error: " + err?.message);
    } finally {
      setIsLoading(false);
      isProcessingRef.current = false;
    }
  };

  // ─── AI CALL ─────────────────────────────────────────────────────────────
  const callAI = async (
    base64: string,
    lang: LangKey,
    prompt: string
  ): Promise<string> => {
    const imageData = `data:image/jpeg;base64,${base64}`;

    try {
      setStatus("Calling Groq...");
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          max_tokens: 150,
          temperature: 0.4,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageData } },
            ],
          }],
        }),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) { setStatus("Groq ✓"); return text; }
    } catch (e) { console.warn("Groq failed:", e); }

    try {
      setStatus("Calling OpenRouter...");
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "com.sentia.app",
          "X-Title": "Sentia",
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-exp:free",
          max_tokens: 150,
          temperature: 0.4,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageData } },
            ],
          }],
        }),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) { setStatus("OpenRouter ✓"); return text; }
    } catch (e) { console.warn("OpenRouter failed:", e); }

    setStatus("Offline mode");
    return LANGUAGES[lang].fallback;
  };

  // ─── VOICE RECORDING ─────────────────────────────────────────────────────
  const startListening = async () => {
    if (!audioPermission || !language) return;
    try {
      setMode("listening");
      setStatus("Listening...");
      Vibration.vibrate(200);
      speak(LANGUAGES[language].voiceMode, language);

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setTimeout(() => stopListening(), 5000);
    } catch (e) {
      console.error("Recording failed:", e);
      setMode("idle");
    }
  };

  const stopListening = async () => {
    if (!recordingRef.current || !language) return;
    try {
      setStatus("Processing voice...");
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      if (!uri) return;

      const formData = new FormData();
      formData.append("file", { uri, type: "audio/m4a", name: "recording.m4a" } as any);
      formData.append("model", "whisper-large-v3");
      formData.append("language", language === "hi" ? "hi" : language === "mr" ? "mr" : "en");

      const transcriptRes = await fetch(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
          body: formData,
        }
      );

      const transcriptData = await transcriptRes.json();
      const question = transcriptData?.text?.trim();

      if (question) {
        setDescription(
          language === "hi" ? `आपने पूछा: ${question}`
          : language === "mr" ? `तुम्ही विचारले: ${question}`
          : `You asked: ${question}`
        );
        speak(LANGUAGES[language].yes, language);
        setTimeout(() => { setMode("idle"); analyzeFrame("voice", question); }, 1500);
      } else {
        speak(
          language === "hi" ? "मैं आपकी आवाज़ नहीं सुन सका। कृपया फिर कोशिश करें।"
          : language === "mr" ? "मला ऐकू आले नाही. कृपया पुन्हा प्रयत्न करा."
          : "I couldn't hear you clearly. Please try again.",
          language
        );
        setMode("idle");
      }
    } catch (e) {
      console.error("Stop listening error:", e);
      setMode("idle");
    }
  };

  // ─── SETTINGS TAP HANDLER ────────────────────────────────────────────────
  const handleSettingsTap = () => {
    if (!language) return;
    const now = Date.now();
    const timeSinceLast = now - lastTapTimeRef.current;
    lastTapTimeRef.current = now;

    if (timeSinceLast < 400) {
      // Double tap → male voice
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      setVoiceGender("male");
      voiceGenderRef.current = "male";
      AsyncStorage.setItem("sentia_voice", "male");
      Speech.stop();
      setTimeout(() => {
        speakRaw(LANGUAGES[language].maleSelected, language, false, "male");
      }, 200);
      return;
    }

    tapTimerRef.current = setTimeout(() => {
      // Single tap → female voice
      setVoiceGender("female");
      voiceGenderRef.current = "female";
      AsyncStorage.setItem("sentia_voice", "female");
      Speech.stop();
      setTimeout(() => {
        speakRaw(LANGUAGES[language].femaleSelected, language, false, "female");
      }, 200);
    }, 400);
  };

  // ─── MAIN GESTURE HANDLER ────────────────────────────────────────────────
  const handleTap = () => {
    if (!language) return;
    const now = Date.now();
    const timeSinceLast = now - lastTapTimeRef.current;
    lastTapTimeRef.current = now;

    if (timeSinceLast < 400) {
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      // Double tap → stop scanning
      if (isScanning) {
        setIsScanning(false);
        Vibration.vibrate([0, 100, 100, 100]);
        speak(LANGUAGES[language].scanStopped, language);
      }
      return;
    }

    tapTimerRef.current = setTimeout(() => {
      // Single tap → start scanning
      if (!isScanning && mode !== "reading" && mode !== "listening") {
        setIsScanning(true);
        Vibration.vibrate(100);
        speak(LANGUAGES[language].scanStarted, language);
      }
    }, 400);
  };

  const handleLongPress = () => {
    if (!language) return;
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }

    const pressDuration = Date.now() - lastTapTimeRef.current;

    if (pressDuration < 800) {
      // Short hold → read text
      setIsScanning(false);
      setMode("reading");
      Vibration.vibrate(100);
      speak(LANGUAGES[language].readMode, language);
      setTimeout(() => analyzeFrame("read"), 1500);
    } else {
      // Long hold → voice question
      setIsScanning(false);
      Vibration.vibrate([0, 200, 100, 200]);
      startListening();
    }
  };

  // ─── STATUS LABELS ───────────────────────────────────────────────────────
  const getStatusLabel = () => {
    if (isHazardAlert) return "⚠️ HAZARD DETECTED";
    if (mode === "listening") return "🎤 Listening...";
    if (isLoading) return `⏳ ${status}`;
    if (mode === "scanning") return "🟢 Scanning";
    if (mode === "reading") return "📖 Reading";
    return "⚪ Ready";
  };

  const getGestureGuide = () => {
    if (!language) return "";
    const lang = LANGUAGES[language];
    if (mode === "scanning") return `👆👆 ${lang.doubleTapToStop}`;
    return `👆 ${lang.tapToScan}  •  ✋ ${lang.holdToRead}`;
  };

  // ─── SETTINGS SCREEN ─────────────────────────────────────────────────────
  if (showSettings && language) {
    return (
      <TouchableOpacity
        style={styles.settingsScreen}
        activeOpacity={1}
        onPress={handleSettingsTap}
      >
        <StatusBar barStyle="light-content" />

        <Text style={styles.settingsTitle}>⚙️</Text>
        <Text style={styles.settingsHeading}>
          {language === "hi" ? "सेटिंग्स"
          : language === "mr" ? "सेटिंग्स"
          : "Settings"}
        </Text>

        {/* Current voice indicator */}
        <View style={styles.voiceIndicator}>
          <Text style={styles.voiceIndicatorText}>
            {voiceGender === "female" ? "👩" : "👨"}
          </Text>
          <Text style={styles.voiceIndicatorLabel}>
            {voiceGender === "female"
              ? (language === "hi" ? "महिला आवाज़ सक्रिय" : language === "mr" ? "महिला आवाज सक्रिय" : "Female voice active")
              : (language === "hi" ? "पुरुष आवाज़ सक्रिय" : language === "mr" ? "पुरुष आवाज सक्रिय" : "Male voice active")}
          </Text>
        </View>

        {/* Instructions */}
        <View style={styles.settingsInstructions}>
          <Text style={styles.settingsInstructionText}>
            👆 {language === "hi" ? "एक बार टैप = महिला आवाज़"
              : language === "mr" ? "एकदा टॅप = महिला आवाज"
              : "One tap = Female voice"}
          </Text>
          <Text style={styles.settingsInstructionText}>
            👆👆 {language === "hi" ? "दो बार टैप = पुरुष आवाज़"
              : language === "mr" ? "दोनदा टॅप = पुरुष आवाज"
              : "Double tap = Male voice"}
          </Text>
          <Text style={styles.settingsInstructionText}>
            📳 {language === "hi" ? "फोन हिलाएं = बंद करें"
              : language === "mr" ? "फोन हलवा = बंद करा"
              : "Shake phone = Close settings"}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  // ─── LANGUAGE SCREEN ─────────────────────────────────────────────────────
  if (!language) {
    return (
      <View style={styles.langScreen}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.appName}>Sentia</Text>
        <Text style={styles.tagline}>Visual AI for Everyone</Text>
        <Text style={styles.chooseText}>
          Choose Language / भाषा निवडा / भाषा चुनें
        </Text>
        {(Object.keys(LANGUAGES) as LangKey[]).map((key) => (
          <TouchableOpacity
            key={key}
            style={styles.langButton}
            onPress={async () => {
              await AsyncStorage.setItem("sentia_lang", key);
              setLanguage(key);
            }}
          >
            <Text style={styles.langButtonText}>{LANGUAGES[key].label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  // ─── PERMISSION SCREEN ───────────────────────────────────────────────────
  if (!permission?.granted) {
    return (
      <View style={styles.langScreen}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.appName}>Sentia</Text>
        <Text style={styles.chooseText}>Camera permission is required</Text>
        <TouchableOpacity style={styles.langButton} onPress={requestPermission}>
          <Text style={styles.langButtonText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── MAIN SCREEN ─────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, isHazardAlert && styles.hazardContainer]}>
      <StatusBar barStyle="light-content" />

      <TouchableOpacity
        style={styles.fullScreen}
        activeOpacity={1}
        onPress={handleTap}
        onLongPress={handleLongPress}
        delayLongPress={600}
      >
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      </TouchableOpacity>

      <View style={[styles.topBar, isHazardAlert && styles.hazardBar]} pointerEvents="none">
        <Text style={styles.topBarText}>{getStatusLabel()}</Text>
      </View>

      <View style={[styles.descBox, isHazardAlert && styles.hazardDescBox]} pointerEvents="none">
        {isLoading && (
          <ActivityIndicator color="#fff" size="small" style={{ marginBottom: 8 }} />
        )}
        <Text style={styles.descText}>
          {description || LANGUAGES[language].welcomeMessage}
        </Text>
      </View>

      <View style={styles.gestureGuide} pointerEvents="none">
        <Text style={styles.gestureText}>{getGestureGuide()}</Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.langSwitchBtn}
          onPress={async () => {
            setIsScanning(false);
            Speech.stop();
            await AsyncStorage.removeItem("sentia_lang");
            setLanguage(null);
            setMode("idle");
          }}
        >
          <Text style={styles.langSwitchText}>🌐 Language</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  hazardContainer: { backgroundColor: "#1a0000" },
  fullScreen: { flex: 1 },
  camera: { flex: 1 },

  topBar: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
  },
  hazardBar: { backgroundColor: "rgba(176,0,32,0.9)" },
  topBarText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  descBox: {
    position: "absolute",
    bottom: 120,
    left: 16,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
  },
  hazardDescBox: {
    backgroundColor: "rgba(176,0,32,0.9)",
    borderWidth: 2,
    borderColor: "#ff4444",
  },
  descText: {
    color: "#fff",
    fontSize: 18,
    lineHeight: 28,
    fontWeight: "500",
    textAlign: "center",
  },

  gestureGuide: {
    position: "absolute",
    bottom: 72,
    left: 16,
    right: 16,
    alignItems: "center",
  },
  gestureText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    textAlign: "center",
  },

  controls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 20,
    alignItems: "center",
  },
  langSwitchBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
  },
  langSwitchText: { color: "#fff", fontSize: 14 },

  // ── Settings screen ──────────────────────────────────────────────────────
  settingsScreen: {
    flex: 1,
    backgroundColor: "#0a0a1a",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 24,
  },
  settingsTitle: { fontSize: 64 },
  settingsHeading: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: 2,
  },
  voiceIndicator: {
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    borderWidth: 2,
    borderColor: "#6200EE",
    gap: 8,
  },
  voiceIndicatorText: { fontSize: 48 },
  voiceIndicatorLabel: {
    color: "#6200EE",
    fontSize: 18,
    fontWeight: "700",
  },
  settingsInstructions: {
    width: "100%",
    backgroundColor: "#111122",
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  settingsInstructionText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
    lineHeight: 24,
  },

  // ── Language screen ──────────────────────────────────────────────────────
  langScreen: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  appName: { color: "#fff", fontSize: 52, fontWeight: "800", letterSpacing: 3 },
  tagline: { color: "#6200EE", fontSize: 16, fontWeight: "600" },
  chooseText: {
    color: "#aaa",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 8,
  },
  langButton: {
    width: "100%",
    backgroundColor: "#1a1a2e",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#6200EE",
  },
  langButtonText: { color: "#fff", fontSize: 26, fontWeight: "700" },
});