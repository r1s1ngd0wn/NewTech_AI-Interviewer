function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}
module.exports = { httpError };
