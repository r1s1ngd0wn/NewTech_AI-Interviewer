const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { runAgent, memoryActions } = require('../agent/agent');
const { createPlanService } = require('../services/planService');
const { createActionService } = require('../services/actionService');

const router = express.Router();
router.use(requireAuth);

for (const operation of ['confirm', 'cancel']) router.post(`/actions/:id/${operation}`, async (req, res, next) => {
  try {
    const actions = req.db ? createActionService(req.db, createPlanService(req.db)) : memoryActions;
    res.json(await actions[operation](req.user.id, req.params.id));
  } catch (error) { next(error); }
});

router.post("/chat", async (req, res) => {
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (event) => {
    if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  try {
    const answer = await runAgent({ user: req.user, db: req.db, message: req.body?.message, onEvent: send, signal: controller.signal });
    if (answer) send({ type: "done", answer });
  } catch (error) {
    send({ type: "error", error: error.status && error.status < 500 ? error.message : "could not stream the reply" });
  } finally { res.end(); }
});

module.exports = router;
