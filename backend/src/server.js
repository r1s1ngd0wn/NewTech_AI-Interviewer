require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const scenarioRoutes = require("./routes/scenarios");
const sessionRoutes = require("./routes/sessions");
const progressRoutes = require("./routes/progress");
const documentRoutes = require("./routes/documents");
const coachRoutes = require("./routes/coach");
const { seedTestAccount } = require("./db/seed");
const { purgeStaleSessions } = require("./services/sessionService");
const { checkConnection } = require("./db/postgres");
const { securityHeaders, rateLimit } = require("./middleware/security");
const { randomUUID } = require('node:crypto');
const requestContext = require('./context/requestContext');
const requireAuth = require('./middleware/requireAuth');
const requireRole = require('./middleware/requireRole');

const isProduction = process.env.NODE_ENV === "production";

const app = express();
app.use((req, res, next) => requestContext.run({ requestId: randomUUID() }, next));

if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);

app.use(cors({ origin: process.env.CORS_ORIGIN || (isProduction ? false : "*") }));
app.use(securityHeaders);
app.use(express.json({ limit: "50kb", inflate: false }));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.get('/api/health/ai', (req, res) => res.json(require('./services/aiHealth').status()));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/admin', requireAuth, requireRole('admin'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin/users', require('./routes/adminUsers'));
app.use('/api/admin/scenarios', require('./routes/adminScenarios'));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

// Each chat message can be a paid/quota-limited model call, so cap them per IP.
app.post("/api/sessions/:id/chat", rateLimit({ windowMs: 60 * 1000, max: 20 }));
app.post("/api/sessions/:id/chat/stream", rateLimit({ windowMs: 60 * 1000, max: 20 }));
app.post("/api/documents", rateLimit({ windowMs: 60 * 1000, max: 10 }));
app.post("/api/coach/chat", rateLimit({ windowMs: 60 * 1000, max: 20 }));
app.use('/api/coach/actions', rateLimit({ windowMs: 60 * 1000, max: 30 }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/scenarios", scenarioRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/coach", coachRoutes);
app.use("/api/progress", progressRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "not found" });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
    return res.status(status).json({ error: "internal server error" });
  }
  const message = err.type === "entity.parse.failed" ? "request body is not valid JSON" : err.message;
  res.status(status).json({ error: message, ...(err.code ? { code: err.code } : {}) });
});

async function start() {
  if (process.env.STORE_BACKEND === "memory") {
    if (isProduction) throw new Error("memory store is only for local preview and tests");
    console.warn("InterviewAI is running in temporary memory preview mode; data will not persist.");
  } else {
    await checkConnection();
  }
  // Persistent environments create test users explicitly through seed:auth.
  if (process.env.STORE_BACKEND === 'memory' && !isProduction) await seedTestAccount();
  const purged = await purgeStaleSessions();
  if (purged) console.log(`Removed ${purged} abandoned interview session(s).`);
  setInterval(() => purgeStaleSessions().catch(console.error), 60 * 60 * 1000).unref();
  const port = process.env.PORT || 4000;
  app.listen(port, () => console.log(`InterviewAI backend listening on http://localhost:${port}`));
}

if (require.main === module) start().catch((err) => {
  console.error("InterviewAI backend could not start:", err.message);
  process.exitCode = 1;
});
module.exports = { app, start };
