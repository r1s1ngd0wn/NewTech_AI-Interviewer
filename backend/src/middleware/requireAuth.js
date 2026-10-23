const { getUserFromToken } = require("../services/authService");

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
  next();
}

module.exports = requireAuth;
