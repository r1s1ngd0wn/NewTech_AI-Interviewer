import { useCallback, useEffect, useRef, useState } from "react";

// Wraps the browser's Web Speech API for STT (SpeechRecognition) and TTS
// (speechSynthesis). Matches SRS 4.2 "Frontend <-> Speech Service" at the
// interface level; a self-hosted STT/TTS engine could replace this hook
// later without touching the interview page's logic.
export function useSpeech() {
  const [supported, setSupported] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }
    const recognition = new SpeechRecognition();
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
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);

    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, []);

  const startRecording = useCallback(() => {
    if (!recognitionRef.current) return;
    setFinalTranscript("");
    setInterimTranscript("");
    recognitionRef.current.start();
    setIsRecording(true);
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
    transcript: `${finalTranscript}${interimTranscript}`,
    startRecording,
    stopRecording,
    speak,
    resetTranscript,
  };
}
