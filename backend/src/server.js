require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const scenarioRoutes = require("./routes/scenarios");
const sessionRoutes = require("./routes/sessions");
const progressRoutes = require("./routes/progress");
const { seedTestAccount } = require("./db/seed");

seedTestAccount();

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

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
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "internal server error" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`InterviewAI backend listening on http://localhost:${port}`);
});
