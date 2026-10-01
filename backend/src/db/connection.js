const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

// DB_PATH=":memory:" keeps tests off the real data file.
let dbPath = process.env.DB_PATH;
if (!dbPath) {
  const dataDir = path.join(__dirname, "..", "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, "interviewai.sqlite");
}
const db = new DatabaseSync(dbPath);

if (dbPath !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users_by_email (email TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS feedbacks (session_id TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS session_chats (session_id TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

module.exports = db;
