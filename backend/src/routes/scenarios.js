const express = require("express");
const scenarioService = require("../services/scenarioService");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.get("/browse", (req, res) => {
  const stringFields = ["q", "industry", "seniority", "questionType", "sort", "page"];
  if (stringFields.some((field) => req.query[field] !== undefined && typeof req.query[field] !== "string")) {
    return res.status(400).json({ error: "scenario browse parameters must be single values" });
  }

  const { q = "", industry, seniority, questionType, sort = "title-asc", page = "1" } = req.query;
  if (q.length > 100 || [industry, seniority, questionType].some((value) => value !== undefined && value.length > 80)) {
    return res.status(400).json({ error: "scenario search and filters are too long" });
  }
  if (!["title-asc", "title-desc", "questions-desc"].includes(sort)) {
    return res.status(400).json({ error: "sort must be title-asc, title-desc or questions-desc" });
  }
  if (!/^[1-9]\d*$/.test(page) || Number(page) > 1_000_000) {
    return res.status(400).json({ error: "page must be a positive integer" });
  }

  res.json(scenarioService.browseScenarios({ q, industry, seniority, questionType, sort, page: Number(page), pageSize: 8 }));
});

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
  const scenario = scenarioService.getPublicScenario(req.params.id);
  if (!scenario) return res.status(404).json({ error: "scenario not found" });
  res.json({ scenario });
});

module.exports = router;
