const express = require("express");
const progressService = require("../services/progressService");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.get("/", requireAuth, async (req, res, next) => {
  try {
    res.json(await progressService.getProgress(req.user.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
