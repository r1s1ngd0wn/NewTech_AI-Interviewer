const crypto = require("crypto");

function newId(prefix) {
  const suffix = crypto.randomBytes(6).toString("hex");
  return prefix ? `${prefix}_${suffix}` : suffix;
}

module.exports = { newId };
