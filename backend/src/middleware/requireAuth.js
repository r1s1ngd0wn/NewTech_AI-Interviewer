const { getUserFromToken } = require("../services/authService");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = token ? getUserFromToken(token) : null;

  if (!user) {
    return res.status(401).json({ error: "missing or invalid authorization token" });
  }
  req.user = user;
  req.token = token;
  next();
}

module.exports = requireAuth;
