#!/usr/bin/env node
// Evaluation runner for the model-written parts of the app. It calls the configured model on every
// case in eval/cases/<suite>.json, applies the checks in eval/checks.js, prints a pass rate and
// average latency, and saves the full result to eval/results/.
//
//   node eval/run.js                                  current prompt, grounding on, configured model
//   node eval/run.js --provider local                 use the local server (LM Studio) instead
//   node eval/run.js --model gemini-3.1-flash-lite    override the model name
//   node eval/run.js --runs 3                         repeat each case (models are not deterministic)
//   node eval/run.js --prompt-file src/prompts/archive/critique.v1.md --no-grounding
//                                                     reproduce the behaviour before the changes
//
// Options: --suite critique | --provider gemini|local | --model NAME | --prompt-file PATH |
//          --no-grounding | --runs N | --delay MS | --label TEXT | --no-save
// It makes real API calls (the cases are small, but free tiers have daily limits).

const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function parseArgs(argv) {
  const args = { suite: "critique", runs: 1, delay: 0, grounding: true, save: true };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => argv[++i];
    if (flag === "--suite") args.suite = value();
    else if (flag === "--provider") args.provider = value();
    else if (flag === "--model") args.model = value();
    else if (flag === "--prompt-file") args.promptFile = value();
    else if (flag === "--no-grounding") args.grounding = false;
    else if (flag === "--runs") args.runs = Math.max(1, Number(value()) || 1);
    else if (flag === "--delay") args.delay = Math.max(0, Number(value()) || 0);
    else if (flag === "--label") args.label = value();
    else if (flag === "--no-save") args.save = false;
    else throw new Error(`unknown option ${flag}`);
  }
  return args;
}

function configure(args) {
  if (args.provider === "local") {
    process.env.LLM_PROVIDER = "local";
    if (args.model) process.env.LOCAL_LLM_MODEL = args.model;
  } else if (args.provider === "gemini") {
    delete process.env.LLM_PROVIDER;
    if (args.model) process.env.GEMINI_MODEL = args.model;
  } else if (args.model) {
    process.env.GEMINI_MODEL = args.model;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  configure(args);

  // Required after configure() so the provider settings are read from the final environment.
  const llm = require("../src/services/llmService");
  const prompts = require("../src/prompts");
  const critiqueService = require("../src/services/critiqueService");
  const scenarios = require("../src/data/scenarios.json");
  const { evaluate, resolveAnswer } = require("./checks");

  if (args.suite !== "critique") throw new Error(`unknown suite "${args.suite}" (available: critique)`);
  if (!llm.isEnabled()) throw new Error("no model configured: set GEMINI_API_KEY in backend/.env or use --provider local");

  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "cases", `${args.suite}.json`), "utf8"));
  const prompt = args.promptFile ? prompts.renderFile(path.resolve(args.promptFile)) : prompts.render("critique");
  const questionFor = ({ scenarioId, questionId }) => {
    const question = scenarios.find((s) => s.id === scenarioId)?.questions.find((q) => q.id === questionId);
    if (!question) throw new Error(`case refers to a missing question ${scenarioId}/${questionId}`);
    return question;
  };

  console.log(`Suite ${args.suite}: ${cases.length} cases x ${args.runs} run(s), prompt v${prompt.version}, grounding ${args.grounding ? "on" : "off"}`);

  const results = [];
  for (const testCase of cases) {
    const question = questionFor(testCase.question);
    const answer = resolveAnswer(testCase.answer);
    const runs = [];
    for (let run = 0; run < args.runs; run++) {
      const started = Date.now();
      let failures;
      let review = null;
      try {
        review = await critiqueService.llmCritique(question, answer, { prompt, grounding: args.grounding });
        failures = evaluate(testCase, question, answer, review);
      } catch (err) {
        failures = [`call failed (${err.code || "error"}): ${err.message}`];
      }
      runs.push({ passed: failures.length === 0, failures, latencyMs: Date.now() - started, review });
      if (args.delay) await sleep(args.delay);
    }
    const passedRuns = runs.filter((r) => r.passed).length;
    results.push({ id: testCase.id, type: testCase.type, passedRuns, runs });
    const mark = passedRuns === runs.length ? "PASS" : passedRuns === 0 ? "FAIL" : "FLAKY";
    console.log(`  ${mark}  ${testCase.id} (${passedRuns}/${runs.length})`);
    for (const failure of new Set(runs.flatMap((r) => r.failures))) console.log(`        - ${failure}`);
  }

  const allRuns = results.flatMap((r) => r.runs);
  const passed = allRuns.filter((r) => r.passed).length;
  const callsOk = allRuns.filter((r) => r.review).length;
  const summary = {
    suite: args.suite,
    label: args.label || null,
    ranAt: new Date().toISOString(),
    provider: llm.status().provider,
    model: llm.status().model,
    promptName: prompt.name,
    promptVersion: prompt.version,
    promptFile: args.promptFile || null,
    grounding: args.grounding,
    runsPerCase: args.runs,
    totalRuns: allRuns.length,
    passedRuns: passed,
    passRate: Number((passed / allRuns.length).toFixed(3)),
    callFailures: allRuns.length - callsOk,
    // Of the runs where the model returned a usable review, how many were also correct. Separates
    // "the model gave a bad review" from "the model gave nothing usable".
    qualityPassRate: callsOk ? Number((passed / callsOk).toFixed(3)) : 0,
    avgLatencyMs: Math.round(allRuns.reduce((sum, r) => sum + r.latencyMs, 0) / allRuns.length),
  };
  console.log(`\nPass rate ${passed}/${allRuns.length} (${Math.round(summary.passRate * 100)}%), ${summary.callFailures} failed call(s), average ${summary.avgLatencyMs} ms per case`);
  console.log(`Of the ${callsOk} usable reviews, ${passed} passed all checks (${Math.round(summary.qualityPassRate * 100)}%)`);
  console.log(`Model ${summary.provider}/${summary.model}`);

  if (args.save) {
    const dir = path.join(__dirname, "results");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = summary.ranAt.replace(/[:.]/g, "-").slice(0, 19);
    const name = [stamp, args.suite, summary.provider, slug(summary.model), `p${prompt.version}`, args.grounding ? null : "noguard", args.label ? slug(args.label) : null]
      .filter(Boolean)
      .join("_");
    const file = path.join(dir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify({ summary, cases: results }, null, 2));
    console.log(`Saved ${path.relative(process.cwd(), file)}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
