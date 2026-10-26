import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ speechStatus: vi.fn(), transcribeAudio: vi.fn() }));
vi.mock("../lib/api.js", () => ({ api }));
import { useSpeech } from "./useSpeech.js";

let stopTrack;
let recorders;
class FakeRecorder {
  static isTypeSupported = (type) => type === "audio/webm;codecs=opus";
  constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType || ""; this.state = "inactive"; recorders.push(this); }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["voice"]) }); this.onstop?.(); }
}

beforeEach(() => {
  recorders = [];
  stopTrack = vi.fn();
  api.speechStatus.mockResolvedValue({ enabled: true, asrEnabled: true });
  api.transcribeAudio.mockResolvedValue({ text: "I led the migration." });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

async function cloudHook() {
  const hook = renderHook(() => useSpeech());
  await waitFor(() => expect(hook.result.current.cloudEnabled).toBe(true));
  return hook;
}

test("with a Groq key the answer is recorded, sent for transcription and shown as editable text", async () => {
  const { result } = await cloudHook();
  expect(result.current.supported).toBe(true);
  await act(async () => { await result.current.startRecording(); });
  expect(result.current.isRecording).toBe(true);
  expect(recorders[0].mimeType).toBe("audio/webm;codecs=opus");
  await act(async () => { result.current.stopRecording(); });
  await waitFor(() => expect(result.current.transcript).toBe("I led the migration."));
  const sent = api.transcribeAudio.mock.calls[0][0];
  expect(sent).toBeInstanceOf(Blob);
  expect(sent.type).toBe("audio/webm;codecs=opus");
  expect(result.current.isTranscribing).toBe(false);
  expect(result.current.isRecording).toBe(false);
  expect(stopTrack).toHaveBeenCalled();
});

test("while the recording is being transcribed the page can tell", async () => {
  let finish;
  api.transcribeAudio.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const { result } = await cloudHook();
  await act(async () => { await result.current.startRecording(); });
  await act(async () => { result.current.stopRecording(); });
  expect(result.current.isTranscribing).toBe(true);
  await act(async () => { finish({ text: "Done." }); });
  await waitFor(() => expect(result.current.isTranscribing).toBe(false));
  expect(result.current.transcript).toBe("Done.");
});

test("a failed transcription shows the server's message and keeps typing available", async () => {
  api.transcribeAudio.mockRejectedValue(new Error("Groq speech quota reached. Try again in a moment or type your answer."));
  const { result } = await cloudHook();
  await act(async () => { await result.current.startRecording(); });
  await act(async () => { result.current.stopRecording(); });
  await waitFor(() => expect(result.current.error).toMatch(/quota reached/));
  expect(result.current.transcript).toBe("");
  expect(result.current.isTranscribing).toBe(false);
});

test("a blocked microphone gives the usual message and releases nothing it never got", async () => {
  navigator.mediaDevices.getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  const { result } = await cloudHook();
  await act(async () => { await result.current.startRecording(); });
  expect(result.current.error).toMatch(/Microphone access is blocked/);
  expect(result.current.isRecording).toBe(false);
  expect(result.current.isStarting).toBe(false);
  expect(api.transcribeAudio).not.toHaveBeenCalled();
});

test("leaving the page mid-recording stops the microphone and ignores the late result", async () => {
  const { result, unmount } = await cloudHook();
  await act(async () => { await result.current.startRecording(); });
  unmount();
  expect(stopTrack).toHaveBeenCalled();
  expect(api.transcribeAudio).not.toHaveBeenCalled();
});

test("without a Groq key (or when the status call fails) nothing is recorded or uploaded", async () => {
  api.speechStatus.mockResolvedValue({ enabled: false, asrEnabled: false });
  const { result } = renderHook(() => useSpeech());
  await waitFor(() => expect(api.speechStatus).toHaveBeenCalled());
  expect(result.current.cloudEnabled).toBe(false);
  await act(async () => { await result.current.startRecording(); });
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  expect(api.transcribeAudio).not.toHaveBeenCalled();
  expect(result.current.error).toMatch(/not available in this browser/);

  api.speechStatus.mockRejectedValue(new Error("offline"));
  const second = renderHook(() => useSpeech());
  await waitFor(() => expect(api.speechStatus).toHaveBeenCalledTimes(2));
  expect(second.result.current.cloudEnabled).toBe(false);
});
