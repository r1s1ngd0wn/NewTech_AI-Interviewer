const fs = require("node:fs");
const path = require("node:path");
const scenarios = require("../data/scenarios.json");
const { createScenarioCatalog } = require("./scenarioCatalog");

const catalog = createScenarioCatalog({
  scenarios,
  filePath: process.env.SCENARIO_DATA_FILE || path.resolve(process.env.SCENARIO_DATA_DIR || path.join(__dirname, "../../data"), "scenario-overrides.json"),
  fs,
});

module.exports = catalog;
