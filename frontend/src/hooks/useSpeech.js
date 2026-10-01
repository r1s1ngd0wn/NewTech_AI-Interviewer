import { useCallback, useEffect, useRef, useState } from "react";

const SpeechRecognitionImpl =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const ERROR_MESSAGES = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser's site settings, or type your answer instead.",
  "service-not-allowed": "Microphone access is blocked. Allow it in your browser's site settings, or type your answer instead.",
  "no-speech": "I didn't catch anything. Tap the microphone and try again, or type your answer.",
  "audio-capture": "No microphone was found. Connect one, or type your answer instead.",
  network: "Speech recognition needs a network connection. Type your answer instead.",
};

// Wraps the browser's Web Speech API for STT (SpeechRecognition) and TTS
// (speechSynthesis). Matches SRS 4.2 "Frontend <-> Speech Service" at the
// interface level; a self-hosted STT/TTS engine could replace this hook
// later without touching the interview page's logic.
export function useSpeech() {
  const supported = Boolean(SpeechRecognitionImpl);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (!SpeechRecognitionImpl) return undefined;
    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += chunk;
        else interimText += chunk;
      }
      if (finalText) setFinalTranscript((prev) => `${prev}${finalText} `);
      setInterimTranscript(interimText);
    };
    recognition.onend = () => {
      setIsRecording(false);
      setInterimTranscript("");
    };
    recognition.onerror = (event) => {
      setIsRecording(false);
      if (event.error === "aborted") return;
      setError(ERROR_MESSAGES[event.error] || "Speech recognition stopped unexpectedly. You can type your answer instead.");
    };

    recognitionRef.current = recognition;
    return () => recognition.abort();
  }, []);

  const startRecording = useCallback(() => {
    if (!recognitionRef.current) return;
    // Stop the interviewer's voice so the microphone doesn't transcribe it.
    window.speechSynthesis?.cancel();
    setFinalTranscript("");
    setInterimTranscript("");
    setError("");
    try {
      recognitionRef.current.start();
      setIsRecording(true);
    } catch {
      // start() throws if recognition is already running; nothing to do.
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsRecording(false);
  }, []);

  const speak = useCallback((text) => {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const resetTranscript = useCallback(() => {
    setFinalTranscript("");
    setInterimTranscript("");
  }, []);

  return {
    supported,
    isRecording,
    isSpeaking,
    error,
    transcript: `${finalTranscript}${interimTranscript}`,
    startRecording,
    stopRecording,
    speak,
    resetTranscript,
  };
}
