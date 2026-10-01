require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const scenarioRoutes = require("./routes/scenarios");
const sessionRoutes = require("./routes/sessions");
const progressRoutes = require("./routes/progress");
const { seedTestAccount } = require("./db/seed");
const { purgeStaleSessions } = require("./services/sessionService");
const { securityHeaders, rateLimit } = require("./middleware/security");

const isProduction = process.env.NODE_ENV === "production";

// The demo login (see db/seed.js) is created outside production, or when explicitly asked for.
if (!isProduction || process.env.SEED_TEST_ACCOUNT === "true") {
  seedTestAccount();
}

const purged = purgeStaleSessions();
if (purged) console.log(`Removed ${purged} abandoned interview session(s).`);
setInterval(purgeStaleSessions, 60 * 60 * 1000).unref();

const app = express();

if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);

app.use(cors({ origin: process.env.CORS_ORIGIN || (isProduction ? false : "*") }));
app.use(securityHeaders);
app.use(express.json({ limit: "50kb" }));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

// Each chat message can be a paid/quota-limited model call, so cap them per IP.
app.post("/api/sessions/:id/chat", rateLimit({ windowMs: 60 * 1000, max: 20 }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/scenarios", scenarioRoutes);
app.use("/api/sessions", sessionRoutes);
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
  res.status(status).json({ error: message });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`InterviewAI backend listening on http://localhost:${port}`);
});
