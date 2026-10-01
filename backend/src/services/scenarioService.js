const scenarios = require("../data/scenarios.json");

function listScenarios({ industry, seniority, questionType } = {}) {
  return scenarios
    .filter((s) => !industry || s.industry === industry)
    .filter((s) => !seniority || s.seniority === seniority)
    .filter((s) => !questionType || s.questionType === questionType)
    .map(toSummary);
}

function getScenario(id) {
  return scenarios.find((s) => s.id === id) || null;
}

// What the client may see about a scenario. Question text and per-question keywords stay
// server-side: the keywords are the relevance answer key, and the questions are revealed
// one at a time by the interview flow.
function getPublicScenario(id) {
  const scenario = getScenario(id);
  return scenario ? toSummary(scenario) : null;
}

function toSummary(scenario) {
  const { questions, persona, ...summary } = scenario;
  return { ...summary, questionCount: questions.length };
}

function recommendFor(profile) {
  if (!profile || !profile.targetIndustry) return listScenarios();
  const byIndustry = scenarios.filter((s) => s.industry === profile.targetIndustry);
  const bySeniority = byIndustry.filter((s) => s.seniority === profile.experienceLevel);
  const pool = bySeniority.length ? bySeniority : byIndustry.length ? byIndustry : scenarios;
  return pool.map(toSummary);
}

function getFilterOptions() {
  return {
    industries: [...new Set(scenarios.map((s) => s.industry))],
    seniorities: [...new Set(scenarios.map((s) => s.seniority))],
    questionTypes: [...new Set(scenarios.map((s) => s.questionType))],
  };
}

module.exports = { listScenarios, getScenario, getPublicScenario, recommendFor, getFilterOptions };
