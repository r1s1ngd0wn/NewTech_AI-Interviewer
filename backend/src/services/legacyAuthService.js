const crypto = require("crypto");
const { newId } = require("../utils/id");
const store = require("../store");

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NAME_LENGTH = 80;
const MAX_PROFILE_FIELD_LENGTH = 80;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function passwordMatches(password, user) {
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = Buffer.from(hashPassword(password, user.salt), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function toPublicUser(user) {
  const { passwordHash, salt, ...publicUser } = user;
  return publicUser;
}

function requireString(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(400, `${field} is required`);
  }
  if (value.trim().length > maxLength) {
    throw httpError(400, `${field} must be ${maxLength} characters or fewer`);
  }
  return value.trim();
}

async function register({ email, password, name } = {}) {
  const normalizedEmail = requireString(email, "email", 254).toLowerCase();
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    throw httpError(400, "email is not a valid address");
  }
  if (typeof password !== "string" || !password) throw httpError(400, "password is required");
  if (password.length < 6) throw httpError(400, "password must be at least 6 characters");
  if (password.length > 200) throw httpError(400, "password must be 200 characters or fewer");
  const cleanName = requireString(name, "name", MAX_NAME_LENGTH);

  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    id: newId("user"),
    email: normalizedEmail,
    name: cleanName,
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

  if (!await store.usersByEmail.insertIfAbsent(normalizedEmail, user.id)) {
    throw httpError(409, "an account with this email already exists");
  }
  try {
    await store.users.set(user.id, user);
    const token = await issueToken(user.id);
    return { user: toPublicUser(user), token };
  } catch (error) {
    await store.users.delete(user.id);
    await store.usersByEmail.delete(normalizedEmail);
    throw error;
  }
}

async function login({ email, password } = {}) {
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    throw httpError(400, "email and password are required");
  }
  const normalizedEmail = email.trim().toLowerCase();
  const userId = await store.usersByEmail.get(normalizedEmail);
  const user = userId ? await store.users.get(userId) : null;

  if (!user || !passwordMatches(password, user)) {
    throw httpError(401, "invalid email or password");
  }

  const token = await issueToken(user.id);
  return { user: toPublicUser(user), token };
}

async function issueToken(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  await store.tokens.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

async function revokeToken(token) {
  if (token) await store.tokens.delete(token);
}

async function getUserFromToken(token) {
  const record = await store.tokens.get(token);
  if (!record) return null;
  // Tokens issued before expiry existed were stored as a bare userId string.
  const userId = typeof record === "string" ? record : record.userId;
  if (typeof record === "object" && record.expiresAt < Date.now()) {
    await store.tokens.delete(token);
    return null;
  }
  return (await store.users.get(userId)) || null;
}

async function updateProfile(userId, patch = {}) {
  const user = await store.users.get(userId);
  if (!user) throw httpError(404, "user not found");

  if (patch.name !== undefined) {
    user.name = requireString(patch.name, "name", MAX_NAME_LENGTH);
  }
  for (const key of ["targetIndustry", "targetRole", "experienceLevel"]) {
    if (patch[key] === undefined) continue;
    if (patch[key] === null || patch[key] === "") {
      user.profile[key] = null;
      continue;
    }
    user.profile[key] = requireString(patch[key], key, MAX_PROFILE_FIELD_LENGTH);
  }
  user.profile.onboardingComplete = Boolean(
    user.profile.targetIndustry && user.profile.targetRole && user.profile.experienceLevel
  );
  await store.users.set(userId, user);
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
  revokeToken,
  updateProfile,
  toPublicUser,
  httpError,
};
