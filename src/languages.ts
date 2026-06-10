import type { LangKey } from "./types";

export const LANGUAGES = {
  en: { label: "English", tts: "en-US" },
  hi: { label: "हिंदी", tts: "hi-IN" },
  mr: { label: "मराठी", tts: "mr-IN" },
} as const;

export const WELCOME: Record<LangKey, string> = {
  en: "Welcome to Sentia. Tap once to start scanning. Double tap to stop. Hold anywhere to read text. Hold the microphone button to open conversation mode, then speak your command. Triple tap to save a face. Two finger tap to repeat the last message. Triple-tap the mic for Walk With Me navigation. Shake the phone to open settings. Four taps in settings to save emergency contacts. In any emergency, hold mic and say HELP, BACHAO, or MADAD. Or shake phone twice for SOS.",

  hi: "Sentia में स्वागत है। एक बार टैप स्कैन शुरू। दो बार टैप स्कैन बंद। कहीं भी दबाएं पढ़ने के लिए। माइक दबाएं बातचीत खोलने के लिए, फिर अपना आदेश बोलें। तीन बार टैप चेहरा याद करें। दो उंगली से पिछला संदेश दोहराएं। माइक तीन बार टैप Walk With Me चलना शुरू। सेटिंग्स के लिए फोन हिलाएं। सेटिंग्स में चार बार टैप करके आपातकालीन संपर्क सेव करें। किसी भी आपातकाल में माइक दबाएं और HELP, बचाओ या मदद बोलें। या फोन दो बार हिलाएं।",

  mr: "Sentia मध्ये स्वागत. एकदा टॅप स्कॅन सुरू. दोनदा टॅप स्कॅन थांब. कुठेही दाबा वाचण्यासाठी. मायक दाबा संभाषण उघडण्यासाठी, मग तुमची आज्ञा सांगा. तीनदा टॅप चेहरा लक्षात ठेवा. दोन बोटांनी शेवटचा संदेश पुन्हा ऐका. मायक तीनदा टॅप Walk With Me सुरू. सेटिंग्जसाठी फोन हलवा. सेटिंग्जमध्ये चारदा टॅप करून आणीबाणी संपर्क जतन करा. कोणत्याही आणीबाणीत मायक दाबा आणि HELP, बचाओ किंवा मदत म्हणा. किंवा फोन दोनदा हलवा.",
};

export const LANG_SELECT_AUDIO =
  "Sentia. Choose your language. Tap the top button for English. Middle for Hindi. Bottom for Marathi.";
