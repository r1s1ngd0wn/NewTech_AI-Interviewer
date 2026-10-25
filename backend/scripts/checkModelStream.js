require("dotenv").config();
const llm = require("../src/services/llmService");

async function main() {
  const args = { system: "Reply with exactly OK.",
    messages: [{ role: "user", text: "Connection check" }], maxOutputTokens: 16 };
  if (process.env.CHECK_NON_STREAM === "true") {
    const answer = await llm.generate(args);
    console.log("Model non-stream received", answer.length, "characters.");
    return;
  }
  const tokens = [];
  for await (const token of llm.generateStream(args)) tokens.push(token);
  console.log("Model stream received", tokens.join("").length, "characters.");
}

main().catch((error) => {
  console.error("Model stream check failed:", error.message);
  process.exitCode = 1;
});
