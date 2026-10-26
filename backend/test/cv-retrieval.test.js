process.env.STORE_BACKEND = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");

const documents = require("../src/services/documentService");
const { sectionChunks, TARGET_CHARS } = require("../src/services/documentChunks");
const { classifyCoachRequest } = require("../src/agent/answerPolicy");
const { knowledgeIntent } = require("../src/services/ragService");
const { executeTool } = require("../src/agent/tools");
const { runAgent, excerptOf } = require("../src/agent/agent");
const { buildTwoColumnCvPdf, buildSidebarCvPdf, buildNarrowGutterCvPdf, buildSingleColumnCvPdf } = require("./helpers/twoColumnPdf");

const extract = (buffer) => documents.extractText({ buffer }, "application/pdf");

test("pdf: a two-column CV is read column by column with its words intact", async () => {
  const text = await extract(buildTwoColumnCvPdf());
  for (const broken of ["Co-d eveloped", "Impl emented"]) assert.ok(!text.includes(broken), `${broken} should be rejoined`);
  assert.ok(text.includes("Co-developed an Android"));
  const order = ["PROFILE", "EDUCATION", "SKILLS", "LANGUAGES", "EXPERIENCE", "SOFTWARE ENGINEER INTERN", "ACADEMIC PROJECTS", "REFERENCES"].map((heading) => text.indexOf(heading));
  assert.ok(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1])), `unexpected order ${order}`);
  assert.ok(text.indexOf("Lotus Software") > text.indexOf("EXPERIENCE"), "the internship follows its heading");
  assert.ok(text.indexOf("Example University") < text.indexOf("EXPERIENCE"), "the left column is not mixed into the right one");
});

test("pdf: headings in a side strip stay in front of the text beside them", async () => {
  const text = await extract(buildSidebarCvPdf());
  assert.match(text, /SUMMARY\nFinal-year student/);
  assert.match(text, /EDUCATION\nExample University/);
  assert.match(text, /SKILLS\nBackend: Java/);
  assert.match(text, /PROJECTS\nCampus Courses/);
  assert.match(text, /CERTIFICATIONS\nCloud Foundations/);
});

test("pdf: columns only ten points apart are still read one after the other", async () => {
  const text = await extract(buildNarrowGutterCvPdf());
  const order = ["PROFILE", "EDUCATION", "SKILLS", "LANGUAGES", "EXPERIENCE", "SOFTWARE ENGINEER INTERN", "ACADEMIC PROJECTS", "REFERENCES"].map((heading) => text.indexOf(heading));
  assert.ok(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1])), `unexpected order ${order}`);
  assert.ok(text.indexOf("Tools: PostgreSQL") < text.indexOf("EXPERIENCE"), "the whole left column comes before the right one");
});

test("pdf: a one-column CV with dates at the right edge is not split into columns", async () => {
  const text = await extract(buildSingleColumnCvPdf());
  const order = ["Software Engineer Intern", "Jul 2026", "Built invoicing modules", "Teaching Assistant", "Sep 2025", "Ran weekly lab sessions", "Student Developer", "Jan 2025", "Maintained the faculty website"].map((part) => text.indexOf(part));
  assert.ok(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1])), `unexpected order ${order}`);
});

test("chunks: every CV section keeps its heading as a label and chunks stay small", async () => {
  const chunks = documents.searchableChunks(await extract(buildSidebarCvPdf()));
  for (const opening of ["SUMMARY: Final-year", "EDUCATION: Example University", "SKILLS: Backend", "PROJECTS: Campus Courses", "CERTIFICATIONS: Cloud"]) {
    assert.ok(chunks.some((chunk) => chunk.includes(opening)), `missing the labelled text ${opening}`);
  }
  assert.ok(chunks.every((chunk) => chunk.length <= TARGET_CHARS), "no chunk is larger than the target");
});

test("chunks: a wrapped heading is one heading and tiny neighbouring sections share a chunk", () => {
  const chunks = sectionChunks("EDUCATION\nBACHELOR OF SOFTWARE\nENGINEERING\nExample University\n\nLANGUAGES\nVietnamese, English\n\nEXPERIENCE\n" + "Built an invoicing module with Node.js. ".repeat(12));
  assert.ok(chunks[0].startsWith("EDUCATION BACHELOR OF SOFTWARE ENGINEERING: Example University"));
  assert.ok(chunks[0].includes("LANGUAGES: Vietnamese, English"), "two short sections share a chunk");
  assert.ok(chunks.some((chunk) => chunk.includes("EXPERIENCE: Built an invoicing module")));
});

test("chunks: a long section is cut between paragraphs and a title stays with its text", () => {
  const project = (name) => `${name}\nNode.js, Express\n\n${`Built the ${name} feature set with tests and documentation. `.repeat(8)}`;
  const text = `PROJECTS\n${project("Alpha")}\n\n${project("Beta")}\n\n${project("Gamma")}`;
  const chunks = sectionChunks(text);
  assert.ok(chunks.length >= 2);
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    const holder = chunks.find((chunk) => chunk.includes(`${name} Node.js, Express`));
    assert.ok(holder, `${name} title kept`);
    assert.ok(holder.includes(`Built the ${name} feature set`), `${name} title and description are in the same chunk`);
  }
  assert.ok(chunks.every((chunk) => chunk.startsWith("PROJECTS: ")), "continuation chunks repeat the heading");
});

test("chunks: text with no headings falls back to size-based chunks and nothing is lost", () => {
  const words = Array.from({ length: 700 }, (_, index) => `word${index}`).join(" ");
  const chunks = sectionChunks(words);
  assert.ok(chunks.length > 1 && chunks.every((chunk) => chunk.length <= TARGET_CHARS));
  assert.ok(chunks.join(" ").includes("word0") && chunks.join(" ").includes("word699"));
});

test("routing: questions about the user's own background are CV questions", () => {
  for (const question of [
    "where did I do my internship?", "What is my education?", "what is my most recent work experience", "which role should i take interview for?",
    "Which job roles fit my CV?", "what is my CV about",
  ]) {
    assert.deepEqual(classifyCoachRequest(question), { mode: "knowledge", tools: ["search_knowledge"], requiredSourceKind: "CV" }, question);
  }
});

test("routing: real comparisons still need both documents and app questions still use app tools", () => {
  assert.equal(classifyCoachRequest("Which skills in my CV match the job requirements?").mode, "comparison");
  assert.equal(classifyCoachRequest("How does my CV compare to the role?").mode, "comparison");
  assert.equal(knowledgeIntent("Which job roles fit my CV?"), "document");
  assert.deepEqual(classifyCoachRequest("What are my weakest areas based on my history?"), { mode: "app-data", tools: ["list_weak_areas"] });
  assert.deepEqual(classifyCoachRequest("Find a junior backend scenario"), { mode: "app-data", tools: ["search_scenarios"] });
});

test("search tool: a question about the user's CV also looks inside the CV with the lower floor", async () => {
  const calls = [];
  const retrieveDocument = async (userId, query, kind, limit) => { calls.push({ userId, kind, limit }); return [{ id: "cv-1", label: "CV: me.pdf", text: "Software Engineer Intern at Lotus" }]; };
  const ctx = { user: { id: "u1" }, retrieve: async () => [{ id: "q-1", label: "Question bank", text: "reference answer" }], retrieveDocument, requiredSourceKind: "CV" };
  const result = await executeTool("search_knowledge", { query: "where did I intern" }, ctx);
  assert.deepEqual(calls, [{ userId: "u1", kind: "cv", limit: 3 }]);
  assert.deepEqual(result.sources.map((source) => source.id), ["cv-1", "q-1"]);
});

test("search tool: the CV is not searched again when the normal search already found it, or when no CV is required", async () => {
  let calls = 0;
  const retrieveDocument = async () => { calls++; return []; };
  const found = { user: { id: "u1" }, retrieve: async () => [{ id: "cv-1", label: "CV: me.pdf", text: "text" }], retrieveDocument, requiredSourceKind: "CV" };
  await executeTool("search_knowledge", { query: "my education" }, found);
  await executeTool("search_knowledge", { query: "what is an index" }, { ...found, retrieve: async () => [], requiredSourceKind: undefined });
  assert.equal(calls, 0);
});

test("agent: a document question is searched in code and the sources reach the model in the first message", async () => {
  const seen = [];
  const executed = [];
  const execute = async (name, args, ctx) => { executed.push({ name, query: args.query, kind: ctx.requiredSourceKind }); return { sources: [{ id: "cv-1", label: "CV: me.pdf", text: "Software Engineer Intern at Lotus Software", number: 1 }] }; };
  const generate = async (options) => { seen.push(options.contents[0].parts[0].text); return { text: "You interned at Lotus Software [1].", calls: [] }; };
  const events = [];
  const answer = await runAgent({ user: { id: "u1" }, message: "Where did I do my internship?", onEvent: (event) => events.push(event), generate, execute });
  assert.deepEqual(executed, [{ name: "search_knowledge", query: "Where did I do my internship?", kind: "CV" }]);
  assert.match(seen[0], /Sources already retrieved/);
  assert.match(seen[0], /\[1\] CV: me\.pdf\nSoftware Engineer Intern at Lotus Software/);
  assert.equal(answer.source, "rag");
  assert.equal(answer.sources.length, 1);
  assert.ok(events.some((event) => event.type === "tool" && event.name === "search_knowledge" && event.status === "done"));
});

test("agent: when the search finds nothing the user gets the no-data reply without a model call", async () => {
  let modelCalls = 0;
  const answer = await runAgent({ user: { id: "u1" }, message: "What is my most recent work experience according to my CV?", onEvent() {},
    execute: async () => ({ sources: [] }), generate: async () => { modelCalls++; return { text: "invented", calls: [] }; } });
  assert.equal(answer.source, "rag-no-match");
  assert.equal(modelCalls, 0);
});

test("excerpt: long previews end at a sentence or word boundary with an ellipsis, short text is untouched", () => {
  assert.equal(excerptOf("Short text."), "Short text.");
  const long = `${"Built an API with Node.js and PostgreSQL. ".repeat(12)}`;
  const preview = excerptOf(long, 100);
  assert.ok(preview.endsWith("…") || preview.endsWith("."), preview);
  assert.ok(preview.length <= 102);
  const noSentence = excerptOf("word ".repeat(80), 100);
  assert.ok(noSentence.endsWith("word…"), noSentence);
});
