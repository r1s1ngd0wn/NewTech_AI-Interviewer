const express = require("express");
const authService = require("../services/authService");
const accountService = require("../services/accountService");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

router.put("/me", (req, res, next) => {
  try {
    const user = authService.updateProfile(req.user.id, req.body || {});
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.get("/me/export", (req, res, next) => {
  try {
    res.json(accountService.exportData(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.delete("/me", (req, res, next) => {
  try {
    accountService.deleteAccount(req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
