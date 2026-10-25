const { getUserFromToken } = require("../services/authService");
const { userClient, memoryPreview } = require('../db/supabase');
const { authenticate } = require('../services/supabaseAuth');
const context = require('../context/requestContext');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  let user;
  try {
    if (token && !memoryPreview()) {
      req.db = userClient(token);
      user = await authenticate(token, req.db);
    } else {
      user = token ? await getUserFromToken(token) : null;
    }
  } catch (err) {
    return next(err);
  }

  if (!user) {
    return res.status(401).json({ error: "missing or invalid authorization token" });
  }
  req.user = user;
  req.token = token;
  const claims = !memoryPreview() ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) : null;
  context.run({ ...context.getStore(), userId: user.id, user, db: req.db, claims }, next);
}

module.exports = requireAuth;
