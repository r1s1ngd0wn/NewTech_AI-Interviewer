const { providers } = require('./llmProviders');
let observation = null;
// A health observation belongs to the provider setup it was made under.
const signature = () => `${providers().join(',')}|${process.env.GEMINI_API_KEY || ''}`;
let keyAtObservation = null;
function recordSuccess() { keyAtObservation = signature(); observation = { state: 'available', available: true, reason: null, checkedAt: new Date().toISOString() }; }
function recordFailure(error) {
  keyAtObservation = signature();
  observation = { state: 'unavailable', available: false,
    reason: error.upstreamStatus === 429 ? 'quota' : error.upstreamStatus === 401 || error.upstreamStatus === 403 || error.upstreamStatus === 400 ? 'configuration'
      : error.name === 'AbortError' || /timed out|timeout/i.test(error.message || '') ? 'timeout' : 'provider_error', checkedAt: new Date().toISOString() };
}
function status() {
  if (!providers().length) return { state: 'unconfigured', available: false, reason: 'not_configured', checkedAt: null };
  if (keyAtObservation !== signature()) return { state: 'unknown', available: null, reason: 'not_checked', checkedAt: null };
  return observation || { state: 'unknown', available: null, reason: 'not_checked', checkedAt: null };
}
module.exports = { recordSuccess, recordFailure, status };
