import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { createTaskGate } from "./speechLifecycle.js";
import { createMediaRecorder } from "./mediaRecorder.js";

const SpeechRecognitionImpl =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const MIC_BLOCKED = "Microphone access is blocked. Allow it in your browser's site settings, or type your answer instead.";
const ERROR_MESSAGES = {
  "not-allowed": MIC_BLOCKED,
  "service-not-allowed": MIC_BLOCKED,
  "no-speech": "I didn't catch anything. Tap the microphone and try again, or type your answer.",
  "audio-capture": "No microphone was found. Connect one, or type your answer instead.",
  network: "Speech recognition needs a network connection. Type your answer instead.",
};

function preferredMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
    .find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

// Speech for the interview page. Speech to text has two modes, chosen by the backend:
//   - cloud: when the backend has a GROQ_API_KEY the answer is recorded here, sent to the backend
//     and transcribed by Groq's hosted Whisper model (much better with accents);
//   - browser: otherwise the browser's own Web Speech API (SpeechRecognition) is used.
// The interviewer's voice is always the browser's speechSynthesis. The transcript stays editable.
export function useSpeech() {
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const recognitionRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const isAcquiringMicRef = useRef(false);
  const chunksRef = useRef([]);
  const recordingGateRef = useRef(null);
  if (!recordingGateRef.current) recordingGateRef.current = createTaskGate();

  useEffect(() => {
    let active = true;
    api.speechStatus()
      .then((status) => { if (active) setCloudEnabled(Boolean(status?.asrEnabled ?? status?.enabled)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (cloudEnabled || !SpeechRecognitionImpl) return undefined;
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
  }, [cloudEnabled]);

  const startCloudRecording = useCallback(async () => {
    if (isAcquiringMicRef.current) return;
    const task = recordingGateRef.current.begin();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio. Type your answer instead.");
      return;
    }
    try {
      isAcquiringMicRef.current = true;
      setIsStarting(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      isAcquiringMicRef.current = false;
      if (!recordingGateRef.current.isCurrent(task)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setIsStarting(false);
      const mimeType = preferredMimeType();
      const recorder = createMediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        if (!recordingGateRef.current.isCurrent(task)) return;
        setIsRecording(false);
        setIsTranscribing(true);
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        chunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        try {
          const { text } = await api.transcribeAudio(audio);
          if (recordingGateRef.current.isCurrent(task)) setFinalTranscript(text);
        } catch (err) {
          if (recordingGateRef.current.isCurrent(task)) setError(err.message || "Speech recognition failed. You can type your answer instead.");
        } finally {
          if (recordingGateRef.current.isCurrent(task)) setIsTranscribing(false);
        }
      };
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      isAcquiringMicRef.current = false;
      if (!recordingGateRef.current.isCurrent(task)) return;
      setIsStarting(false);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setError(err.name === "NotAllowedError" ? MIC_BLOCKED : "Could not start the microphone. Check that it is connected, or type your answer instead.");
    }
  }, []);

  const startRecording = useCallback(() => {
    // Stop the interviewer's voice so the microphone doesn't transcribe it.
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setFinalTranscript("");
    setInterimTranscript("");
    setError("");
    if (cloudEnabled) return startCloudRecording();
    if (!recognitionRef.current) {
      setError("Speech recognition is not available in this browser. Type your answer instead.");
      return undefined;
    }
    try {
      recognitionRef.current.start();
      setIsRecording(true);
    } catch {
      // start() throws if recognition is already running; nothing to do.
    }
    return undefined;
  }, [cloudEnabled, startCloudRecording]);

  const stopRecording = useCallback(() => {
    if (cloudEnabled) {
      if (isAcquiringMicRef.current) {
        isAcquiringMicRef.current = false;
        recordingGateRef.current.invalidate();
        setIsStarting(false);
        return;
      }
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      return;
    }
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsRecording(false);
  }, [cloudEnabled]);

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

  // Leaving the page releases the microphone and ignores a transcription that is still on its way.
  useEffect(() => () => {
    isAcquiringMicRef.current = false;
    recordingGateRef.current.invalidate();
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    window.speechSynthesis?.cancel();
  }, []);

  return {
    supported: cloudEnabled
      ? Boolean(typeof MediaRecorder !== "undefined" && navigator.mediaDevices?.getUserMedia)
      : Boolean(SpeechRecognitionImpl),
    cloudEnabled,
    isRecording,
    isStarting,
    isTranscribing,
    isSpeaking,
    error,
    transcript: `${finalTranscript}${interimTranscript}`,
    startRecording,
    stopRecording,
    speak,
    resetTranscript,
  };
}
