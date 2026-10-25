const scenarios = require("../data/scenarios.json");

function filteredScenarios({ industry, seniority, questionType } = {}) {
  return scenarios
    .filter((s) => !industry || s.industry === industry)
    .filter((s) => !seniority || s.seniority === seniority)
    .filter((s) => !questionType || s.questionType === questionType);
}

function listScenarios({ industry, seniority, questionType } = {}) {
  return filteredScenarios({ industry, seniority, questionType }).map(toSummary);
}

function browseScenarios({ q = "", industry, seniority, questionType, sort = "title-asc", page = 1, pageSize = 8 } = {}) {
  const query = q.normalize("NFKC").trim().toLocaleLowerCase();
  let results = filteredScenarios({ industry, seniority, questionType }).filter((scenario) => {
    if (!query) return true;
    return [scenario.title, scenario.industry, scenario.seniority, scenario.questionType]
      .some((value) => value.normalize("NFKC").toLocaleLowerCase().includes(query));
  });

  const titleOrder = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
  if (sort === "title-desc") results.sort((a, b) => titleOrder(b, a));
  else if (sort === "questions-desc") results.sort((a, b) => b.questions.length - a.questions.length || titleOrder(a, b));
  else results.sort(titleOrder);

  const total = results.length;
  const totalPages = Math.ceil(total / pageSize);
  const currentPage = totalPages ? Math.min(page, totalPages) : 1;
  const offset = (currentPage - 1) * pageSize;
  return {
    scenarios: results.slice(offset, offset + pageSize).map(toSummary),
    page: currentPage,
    pageSize,
    total,
    totalPages,
  };
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

module.exports = { listScenarios, browseScenarios, getScenario, getPublicScenario, recommendFor, getFilterOptions };
