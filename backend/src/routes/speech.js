const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const speechService = require("../services/speechService");

const router = express.Router();
router.use(requireAuth);

// Tells the page whether to record and upload audio or to use the browser's own recogniser.
router.get("/status", (req, res) => res.json(speechService.status()));

router.post("/transcribe", express.raw({ type: "audio/*", limit: speechService.MAX_AUDIO_BYTES }), async (req, res, next) => {
  try {
    if (!req.is("audio/*") || !Buffer.isBuffer(req.body)) return res.status(415).json({ error: "Send an audio recording to transcribe." });
    res.json(await speechService.transcribe(req.body, req.get("content-type")));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
