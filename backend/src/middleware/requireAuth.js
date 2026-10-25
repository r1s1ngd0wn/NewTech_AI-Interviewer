const { getUserFromToken } = require("../services/authService");
const aiRequestLog = require("../services/aiRequestLogService");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  let user;
  try {
    user = token ? await getUserFromToken(token) : null;
  } catch (err) {
    return next(err);
  }

  if (!user) {
    return res.status(401).json({ error: "missing or invalid authorization token" });
  }
  req.user = user;
  req.token = token;
  aiRequestLog.runForUser(user.id, next);
}

module.exports = requireAuth;
