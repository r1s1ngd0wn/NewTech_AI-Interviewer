import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { createTaskGate } from "./speechLifecycle.js";
import { createMediaRecorder } from "./mediaRecorder.js";

const SpeechRecognitionImpl =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const ERROR_MESSAGES = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser's site settings, or type your answer instead.",
  "service-not-allowed": "Microphone access is blocked. Allow it in your browser's site settings, or type your answer instead.",
  "no-speech": "I didn't catch anything. Tap the microphone and try again, or type your answer.",
  "audio-capture": "No microphone was found. Connect one, or type your answer instead.",
  network: "Speech recognition needs a network connection. Type your answer instead.",
};

function preferredMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
    .find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

export function useSpeech() {
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudTtsEnabled, setCloudTtsEnabled] = useState(false);
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
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const recordingGateRef = useRef(null);
  const playbackGateRef = useRef(null);
  if (!recordingGateRef.current) recordingGateRef.current = createTaskGate();
  if (!playbackGateRef.current) playbackGateRef.current = createTaskGate();

  useEffect(() => {
    let active = true;
    api.speechStatus()
      .then(({ asrEnabled, ttsEnabled, enabled }) => {
        if (!active) return;
        setCloudEnabled(Boolean(asrEnabled ?? enabled));
        setCloudTtsEnabled(Boolean(ttsEnabled));
      })
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

  const startRecording = useCallback(async () => {
    window.speechSynthesis?.cancel();
    playbackGateRef.current.invalidate();
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setIsSpeaking(false);
    setFinalTranscript("");
    setInterimTranscript("");
    setError("");
    if (cloudEnabled) {
      if (isAcquiringMicRef.current) return;
      const recordingTask = recordingGateRef.current.begin();
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setError("This browser cannot record audio for cloud transcription. Type your answer instead.");
        return;
      }
      try {
        isAcquiringMicRef.current = true;
        setIsStarting(true);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        isAcquiringMicRef.current = false;
        if (!recordingGateRef.current.isCurrent(recordingTask)) {
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
          if (!recordingGateRef.current.isCurrent(recordingTask)) return;
          setIsRecording(false);
          setIsTranscribing(true);
          const audio = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
          chunksRef.current = [];
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          try {
            const { text } = await api.transcribeAudio(audio);
            if (recordingGateRef.current.isCurrent(recordingTask)) setFinalTranscript(text);
          } catch (err) {
            if (recordingGateRef.current.isCurrent(recordingTask)) {
              setError(err.message || "Cloud speech recognition failed. You can type your answer instead.");
            }
          } finally {
            if (recordingGateRef.current.isCurrent(recordingTask)) setIsTranscribing(false);
          }
        };
        recorder.start();
        setIsRecording(true);
      } catch (err) {
        isAcquiringMicRef.current = false;
        if (!recordingGateRef.current.isCurrent(recordingTask)) return;
        setIsStarting(false);
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setError(err.name === "NotAllowedError"
          ? "Microphone access is blocked. Allow it in your browser's site settings, or type your answer instead."
          : "Could not start the microphone. Check that it is connected, or type your answer instead.");
      }
      return;
    }
    if (!recognitionRef.current) {
      setError("Speech recognition is not available in this browser. Type your answer instead.");
      return;
    }
    try {
      recognitionRef.current.start();
      setIsRecording(true);
    } catch {
      // start() throws if recognition is already running.
    }
  }, [cloudEnabled]);

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
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
    }
  }, [cloudEnabled]);

  const speak = useCallback(async (text) => {
    if (!text) return;
    const playbackTask = playbackGateRef.current.begin();
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;

    const speakInBrowser = () => {
      if (!playbackGateRef.current.isCurrent(playbackTask) || !window.speechSynthesis) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    };

    if (cloudTtsEnabled && text.length <= 200) {
      try {
        const audioBlob = await api.synthesizeSpeech(text);
        if (!playbackGateRef.current.isCurrent(playbackTask)) return;
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audioUrlRef.current = audioUrl;
        audio.onplay = () => setIsSpeaking(true);
        const clearAudio = () => {
          setIsSpeaking(false);
          if (audioRef.current === audio) audioRef.current = null;
          if (audioUrlRef.current === audioUrl) audioUrlRef.current = null;
          URL.revokeObjectURL(audioUrl);
        };
        audio.onended = clearAudio;
        audio.onerror = () => {
          clearAudio();
          speakInBrowser();
        };
        await audio.play();
        return;
      } catch {
        if (!playbackGateRef.current.isCurrent(playbackTask)) return;
      }
    }
    speakInBrowser();
  }, [cloudTtsEnabled]);

  const resetTranscript = useCallback(() => {
    setFinalTranscript("");
    setInterimTranscript("");
  }, []);

  useEffect(() => () => {
    isAcquiringMicRef.current = false;
    recordingGateRef.current.invalidate();
    playbackGateRef.current.invalidate();
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    window.speechSynthesis?.cancel();
  }, []);

  return {
    supported: cloudEnabled
      ? Boolean(typeof MediaRecorder !== "undefined" && navigator.mediaDevices?.getUserMedia)
      : Boolean(SpeechRecognitionImpl),
    cloudEnabled,
    cloudTtsEnabled,
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
