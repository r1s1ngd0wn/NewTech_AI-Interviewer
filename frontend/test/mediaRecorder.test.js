import test from "node:test";
import assert from "node:assert/strict";
import { createMediaRecorder } from "../src/hooks/mediaRecorder.js";

test("stops acquired microphone tracks when MediaRecorder initialization fails", () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  let stopped = false;
  globalThis.MediaRecorder = class {
    constructor() {
      throw new Error("unsupported recording format");
    }
  };
  const stream = { getTracks: () => [{ stop: () => { stopped = true; } }] };

  try {
    assert.throws(() => createMediaRecorder(stream), /unsupported recording format/);
    assert.equal(stopped, true);
  } finally {
    if (originalMediaRecorder === undefined) delete globalThis.MediaRecorder;
    else globalThis.MediaRecorder = originalMediaRecorder;
  }
});
