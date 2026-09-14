const express = require("express");
const scenarioService = require("../services/scenarioService");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.get("/", (req, res) => {
  const { industry, seniority, questionType } = req.query;
  res.json({ scenarios: scenarioService.listScenarios({ industry, seniority, questionType }) });
});

router.get("/filters", (req, res) => {
  res.json(scenarioService.getFilterOptions());
});

router.get("/recommended", requireAuth, (req, res) => {
  res.json({ scenarios: scenarioService.recommendFor(req.user.profile) });
});

router.get("/:id", (req, res) => {
  const scenario = scenarioService.getScenario(req.params.id);
  if (!scenario) return res.status(404).json({ error: "scenario not found" });
  res.json({ scenario });
});

module.exports = router;
