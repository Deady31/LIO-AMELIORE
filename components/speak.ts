// Synthèse vocale du navigateur (lecture des réponses). Aucun service externe appelé par l'appli.
export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function speak(text: string) {
  if (!canSpeak() || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR";
  u.rate = 0.95;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("fr"));
  if (voice) u.voice = voice;
  window.speechSynthesis.speak(u);
}

// --- Dictée (reconnaissance vocale du navigateur : Chrome Android, Safari iOS récent ; absente sur Firefox)

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export function createRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, (new () => Recognition) | undefined>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function dictationError(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") return "Micro refusé. Autorisez-le dans les réglages du navigateur, ou tapez votre question.";
  if (code === "no-speech") return "Je n'ai rien entendu. Touchez le micro et parlez juste après.";
  if (code === "audio-capture") return "Aucun micro détecté sur cet appareil.";
  if (code === "network") return "La dictée a besoin d'une connexion internet sur ce téléphone.";
  return "La dictée n'a pas fonctionné. Réessayez ou tapez votre question.";
}
