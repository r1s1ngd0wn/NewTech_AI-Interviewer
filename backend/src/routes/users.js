const express = require("express");
const authService = require("../services/authService");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.put("/me", requireAuth, (req, res, next) => {
  try {
    const user = authService.updateProfile(req.user.id, req.body || {});
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
