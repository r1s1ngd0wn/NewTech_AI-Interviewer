// Production data lives in Supabase Postgres. Tests use isolated memory tables.
const { table } = require("./table");

module.exports = {
  users: table("interviewai_users", "id"),
  usersByEmail: table("interviewai_users_by_email", "email"),
  tokens: table("interviewai_tokens", "token"),
  sessions: table("interviewai_sessions", "id"),
  feedbacks: table("interviewai_feedbacks", "session_id"),
  sessionChats: table("interviewai_session_chats", "session_id"),
};
