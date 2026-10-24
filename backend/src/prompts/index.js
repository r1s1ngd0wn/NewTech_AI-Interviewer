// Prompt registry. Every prompt the LLM receives as its system instruction lives in a .md file
// in this folder, so wording changes show up in Git history and carry a version number that is
// logged with each AI request. A file starts with a small header:
//
//   ---
//   name: critique
//   version: 2
//   ---
//   ...prompt text, with {{placeholders}}...
//
// Bump `version` whenever the wording changes in a way that could change results.

const fs = require("fs");
const path = require("path");

const HEADER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

let cache = null;

function parse(raw, file) {
  const match = raw.match(HEADER);
  if (!match) throw new Error(`prompt ${file} has no header`);
  const meta = Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => line.split(/:\s*/))
      .filter((pair) => pair.length >= 2)
      .map(([key, ...rest]) => [key, rest.join(":")])
  );
  const name = meta.name || path.basename(file).replace(/\.md$/, "");
  const version = Number(meta.version);
  if (!Number.isInteger(version) || version < 1) throw new Error(`prompt ${file} needs an integer version`);
  return { name, version, template: match[2].trim() };
}

function load() {
  if (cache) return cache;
  cache = new Map();
  for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith(".md"))) {
    const prompt = parse(fs.readFileSync(path.join(__dirname, file), "utf8"), file);
    cache.set(prompt.name, prompt);
  }
  return cache;
}

function fill(prompt, vars) {
  const text = prompt.template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    if (vars[key] === undefined || vars[key] === null) throw new Error(`prompt "${prompt.name}" needs "${key}"`);
    return String(vars[key]);
  });
  return { name: prompt.name, version: prompt.version, text };
}

// Returns { name, version, text } with every {{placeholder}} replaced. A placeholder with no
// value is an error, so a typo cannot silently send "{{persona}}" to the model.
function render(name, vars = {}) {
  const prompt = load().get(name);
  if (!prompt) throw new Error(`unknown prompt "${name}"`);
  return fill(prompt, vars);
}

// Same as render() for a prompt file outside the registry (the evaluation runner uses it to
// compare an archived version with the current one).
function renderFile(file, vars = {}) {
  return fill(parse(fs.readFileSync(file, "utf8"), file), vars);
}

function list() {
  return [...load().values()].map(({ name, version }) => ({ name, version }));
}

module.exports = { render, renderFile, list };
