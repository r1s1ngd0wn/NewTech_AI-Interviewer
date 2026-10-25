const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const cases = require('./duc-cases.json');
const results = cases.map(item => {
  const start = performance.now();
  const pattern = '^' + item.test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern', pattern, path.join(__dirname, '../test', item.file)], { encoding: 'utf8', timeout: 30000 });
  const pass = run.status === 0 && /# pass [1-9]/.test(run.stdout);
  return { id: item.id, capability: item.capability, type: item.type, pass, latency_ms: Math.round(performance.now() - start),
    tokens_in: 0, tokens_out: 0, cost_usd: 0, ...(pass ? {} : { diagnostic: (run.stderr || run.stdout).slice(-2000) }) };
});
const report = { created_at: new Date().toISOString(), prompt_version: 'duc-v1', mode: 'offline-contract',
  provider: 'fixtures', latency_kind: 'whole_test_process_not_provider', model_quality_evaluated: false,
  pass_rate: results.filter(r => r.pass).length / results.length,
  latency_avg_ms: results.reduce((n, r) => n + r.latency_ms, 0) / results.length,
  tokens_in: 0, tokens_out: 0, cost_usd: 0, results };
const dir = path.join(__dirname, 'results'); fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-duc-v1-offline.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
console.log(`${results.filter(r => r.pass).length}/${results.length} offline contract cases passed. ${file}`);
console.log('No cloud requests. This report does not measure live Gemini tool-selection quality.');
if (report.pass_rate !== 1) process.exitCode = 1;
