const express = require("express");
const sessionService = require("../services/sessionService");
const chatService = require("../services/chatService");
const llmService = require("../services/llmService");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

router.post("/", (req, res, next) => {
  try {
    const { scenarioId } = req.body || {};
    if (!scenarioId) return res.status(400).json({ error: "scenarioId is required" });
    const result = sessionService.startSession(req.user.id, scenarioId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", (req, res, next) => {
  try {
    res.json({ session: sessionService.getSession(req.user.id, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/answer", async (req, res, next) => {
  try {
    const { answerText, inputMode } = req.body || {};
    const result = await sessionService.answerTurn(req.user.id, req.params.id, answerText, inputMode);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/finish", (req, res, next) => {
  try {
    const feedback = sessionService.finishSession(req.user.id, req.params.id);
    res.json({ feedback });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/feedback", (req, res, next) => {
  try {
    res.json({ feedback: sessionService.getFeedback(req.user.id, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", (req, res, next) => {
  try {
    sessionService.deleteSession(req.user.id, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/:id/chat", (req, res, next) => {
  try {
    res.json({ messages: chatService.getHistory(req.user.id, req.params.id), llm: llmService.status() });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/chat", async (req, res, next) => {
  try {
    const { message } = req.body || {};
    const messages = await chatService.postMessage(req.user.id, req.params.id, message);
    res.status(201).json({ messages, llm: llmService.status() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
