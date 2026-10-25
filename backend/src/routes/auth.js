const express = require("express");
const authService = require("../services/authService");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.post("/register", async (req, res, next) => {
  try {
    const result = await authService.register(req.body || {});
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const result = await authService.login(req.body || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await authService.revokeToken(req.token);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: authService.toPublicUser(req.user) });
});

module.exports = router;
