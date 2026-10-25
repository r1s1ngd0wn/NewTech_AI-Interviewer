const { randomUUID } = require("node:crypto");

const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:4000/api";

async function request(path, options = {}, token) {
  const response = await fetch(base + path, {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${data?.error || "request failed"}`);
  return data;
}

async function coachAnswer(token, message) {
  const response = await fetch(base + "/coach/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw new Error(`coach request returned ${response.status}`);
  const events = (await response.text()).split(/\r?\n\r?\n/).map((block) => {
    const line = block.split(/\r?\n/).find((part) => part.startsWith("data: "));
    return line ? JSON.parse(line.slice(6)) : null;
  }).filter(Boolean);
  return events.find((event) => event.type === "done")?.answer;
}

async function main() {
  const id = randomUUID();
  const user = await request("/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `document-smoke-${id}@example.invalid`,
      name: "Document Smoke Test", password: `Smoke-${id}` }),
  });
  const token = user.token;
  let otherToken;
  try {
    const form = new FormData();
    form.append("kind", "cv");
    form.append("file", new Blob(["I built a Java API for a university project and worked with a small team."],
      { type: "text/plain" }), "smoke-cv.txt");
    const uploaded = await request("/documents", { method: "POST", body: form }, token);
    const listed = await request("/documents", {}, token);
    const preview = await request(`/documents/${uploaded.document.id}`, {}, token);
    if (!listed.documents.some((document) => document.id === uploaded.document.id) ||
        !preview.document.extractedText.includes("Java API")) throw new Error("list or preview mismatch");
    const other = await request("/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `document-smoke-other-${id}@example.invalid`,
        name: "Other Smoke Test", password: `Smoke-Other-${id}` }),
    });
    otherToken = other.token;
    const otherList = await request("/documents", {}, otherToken);
    if (otherList.documents.some((document) => document.id === uploaded.document.id)) {
      throw new Error("another user can list the document");
    }
    let blocked = false;
    try { await request(`/documents/${uploaded.document.id}`, {}, otherToken); }
    catch (error) { blocked = /404/.test(error.message); }
    if (!blocked) throw new Error("another user can preview the document");
    console.log("Cross-user document access blocked.");
    const answer = await coachAnswer(token, "What did I build for my university project?");
    if (!answer || !["rag", "rag-extractive"].includes(answer.source) || !answer.sources.length ||
        !/Java API/i.test(answer.text)) {
      throw new Error(`coach grounding failed (${answer?.source || "no answer"})`);
    }
    console.log(`Coach RAG answer, SSE and citation passed (${answer.source}).`);
    const jdForm = new FormData();
    jdForm.append("kind", "jd");
    jdForm.append("file", new Blob(["A backend role requiring Java REST APIs and PostgreSQL."],
      { type: "text/plain" }), "smoke-jd.txt");
    const jd = await request("/documents", { method: "POST", body: jdForm }, token);
    const comparison = await coachAnswer(token, "Compare my CV with the job description for this backend role");
    if (!comparison || !["rag", "rag-extractive"].includes(comparison.source) ||
        !comparison.sources.some((source) => /^CV:/i.test(source.label)) ||
        !comparison.sources.some((source) => /^JD:/i.test(source.label))) {
      throw new Error(`CV/JD comparison lacked both sources (${comparison?.source || "no answer"})`);
    }
    console.log("CV/JD comparison cited both uploaded documents.");
    await request(`/documents/${uploaded.document.id}`, { method: "DELETE" }, token);
    await request(`/documents/${jd.document.id}`, { method: "DELETE" }, token);
    const afterDelete = await request("/documents", {}, token);
    if (afterDelete.documents.some((document) => document.id === uploaded.document.id)) {
      throw new Error("document remained after deletion");
    }
    console.log("Document upload, list, preview and deletion passed.");
  } finally {
    if (otherToken) await request("/users/me", { method: "DELETE" }, otherToken)
      .then(() => console.log("Other temporary account deleted."))
      .catch((error) => console.error("Other account cleanup failed:", error.message));
    await request("/users/me", { method: "DELETE" }, token)
      .then(() => console.log("Temporary account deleted."))
      .catch((error) => console.error("Temporary account cleanup failed:", error.message));
  }
}

main().catch((error) => {
  console.error("Document smoke test failed:", error.message);
  process.exitCode = 1;
});
