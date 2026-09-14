const express = require("express");
const sessionService = require("../services/sessionService");
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

router.post("/:id/answer", (req, res, next) => {
  try {
    const { answerText } = req.body || {};
    if (!answerText || !answerText.trim()) {
      return res.status(400).json({ error: "answerText is required" });
    }
    const result = sessionService.submitAnswer(req.user.id, req.params.id, answerText);
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

module.exports = router;
