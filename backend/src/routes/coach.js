const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const coachService = require("../services/coachService");

const router = express.Router();
router.use(requireAuth);

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
    const answer = await coachService.streamChat(req.user.id, req.body?.message, send, controller.signal);
    if (answer) send({ type: "done", answer });
  } catch (error) {
    send({ type: "error", error: error.status && error.status < 500 ? error.message : "could not stream the reply" });
  } finally { res.end(); }
});

module.exports = router;
