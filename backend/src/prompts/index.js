const fs = require("node:fs");
const path = require("node:path");

const versions = Object.freeze({ coach: "v1", debrief: "v1", "debrief-rag": "v1" });

function prompt(name) {
  const version = versions[name];
  if (!version) throw new Error(`unknown prompt: ${name}`);
  return fs.readFileSync(path.join(__dirname, `${name}.${version}.md`), "utf8").trim();
}

module.exports = { prompt, versions };
