import test from "node:test";
import assert from "node:assert/strict";
import { createTaskGate } from "../src/hooks/speechLifecycle.js";

test("a newer speech task invalidates an older pending task", () => {
  const gate = createTaskGate();
  const first = gate.begin();
  const second = gate.begin();

  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test("unmount invalidation prevents pending speech tasks from continuing", () => {
  const gate = createTaskGate();
  const pending = gate.begin();

  gate.invalidate();

  assert.equal(gate.isCurrent(pending), false);
});
