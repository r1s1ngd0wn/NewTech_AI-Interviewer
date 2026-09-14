const express = require("express");
const progressService = require("../services/progressService");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  res.json(progressService.getProgress(req.user.id));
});

module.exports = router;
