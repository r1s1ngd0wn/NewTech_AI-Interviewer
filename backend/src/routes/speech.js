const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const speechService = require("../services/speechService");

const router = express.Router();
router.use(requireAuth);

router.get("/status", (req, res) => res.json(speechService.status()));

router.post("/synthesize", async (req, res, next) => {
  try {
    const { audio, contentType } = await speechService.synthesize(req.body?.text);
    res.type(contentType).send(audio);
  } catch (error) {
    next(error);
  }
});

router.post("/transcribe", express.raw({ type: "*/*", limit: "25mb" }), async (req, res, next) => {
  try {
    if (!req.is("audio/*")) return res.status(415).json({ error: "Send an audio recording to transcribe." });
    res.json(await speechService.transcribe(req.body, req.get("content-type")));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
