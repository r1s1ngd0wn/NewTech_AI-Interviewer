const express = require("express");
const usageService = require("../services/usageService");

// Mounted at /api/admin behind requireAuth + requireRole('admin') (see server.js), so every handler
// here may assume the caller is an administrator.
const router = express.Router();

// AI usage statistics: ?from=&to=&capability=&model=&prompt=
router.get("/usage", async (req, res, next) => {
  try {
    res.json(await usageService.summarize(req.query));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
