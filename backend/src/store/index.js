// Data store, backed by SQLite (see ../db/connection.js) instead of plain JS Maps,
// so data survives a server restart. Each export is a Map-like object (get/set/delete/
// has/values) over its own table - the services that use this file were written
// against the Map interface and did not need to change when this moved off memory.
const db = require("../db/connection");
const { SqliteTable } = require("../db/sqliteTable");

const users = new SqliteTable(db, "users", "id");
const usersByEmail = new SqliteTable(db, "users_by_email", "email");
const tokens = new SqliteTable(db, "tokens", "token");
const sessions = new SqliteTable(db, "sessions", "id");
const feedbacks = new SqliteTable(db, "feedbacks", "session_id");
const sessionChats = new SqliteTable(db, "session_chats", "session_id");

module.exports = {
  users,
  usersByEmail,
  tokens,
  sessions,
  feedbacks,
  sessionChats,
};
