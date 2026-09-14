const express = require("express");
const authService = require("../services/authService");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.post("/register", (req, res, next) => {
  try {
    const result = authService.register(req.body || {});
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/login", (req, res, next) => {
  try {
    const result = authService.login(req.body || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: authService.toPublicUser(req.user) });
});

module.exports = router;
