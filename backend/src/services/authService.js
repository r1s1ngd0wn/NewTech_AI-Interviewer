const crypto = require("crypto");
const { newId } = require("../utils/id");
const store = require("../store");

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function toPublicUser(user) {
  const { passwordHash, salt, ...publicUser } = user;
  return publicUser;
}

function register({ email, password, name }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !password || !name) {
    throw httpError(400, "email, password, and name are required");
  }
  if (password.length < 6) {
    throw httpError(400, "password must be at least 6 characters");
  }
  if (store.usersByEmail.has(normalizedEmail)) {
    throw httpError(409, "an account with this email already exists");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    id: newId("user"),
    email: normalizedEmail,
    name,
    salt,
    passwordHash: hashPassword(password, salt),
    profile: {
      targetIndustry: null,
      targetRole: null,
      experienceLevel: null,
      onboardingComplete: false,
    },
    createdAt: new Date().toISOString(),
  };

  store.users.set(user.id, user);
  store.usersByEmail.set(normalizedEmail, user.id);

  const token = issueToken(user.id);
  return { user: toPublicUser(user), token };
}

function login({ email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const userId = store.usersByEmail.get(normalizedEmail);
  const user = userId ? store.users.get(userId) : null;

  if (!user || hashPassword(password, user.salt) !== user.passwordHash) {
    throw httpError(401, "invalid email or password");
  }

  const token = issueToken(user.id);
  return { user: toPublicUser(user), token };
}

function issueToken(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  store.tokens.set(token, userId);
  return token;
}

function getUserFromToken(token) {
  const userId = store.tokens.get(token);
  if (!userId) return null;
  return store.users.get(userId) || null;
}

function updateProfile(userId, patch) {
  const user = store.users.get(userId);
  if (!user) throw httpError(404, "user not found");

  const allowed = ["targetIndustry", "targetRole", "experienceLevel", "name"];
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    if (key === "name") {
      user.name = patch.name;
    } else {
      user.profile[key] = patch[key];
    }
  }
  if (user.profile.targetIndustry && user.profile.targetRole && user.profile.experienceLevel) {
    user.profile.onboardingComplete = true;
  }
  store.users.set(userId, user);
  return toPublicUser(user);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = {
  register,
  login,
  getUserFromToken,
  updateProfile,
  toPublicUser,
  httpError,
};
