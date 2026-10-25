const express = require("express");
const authService = require("../services/authService");
const accountService = require("../services/accountService");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

router.put("/me", async (req, res, next) => {
  try {
    const user = await authService.updateProfile(req.user.id, req.body || {});
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.get("/me/export", async (req, res, next) => {
  try {
    res.json(await accountService.exportData(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.delete("/me", async (req, res, next) => {
  try {
    await accountService.deleteAccount(req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
