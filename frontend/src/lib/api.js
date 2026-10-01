const TOKEN_KEY = "interviewai.token";
export const AUTH_EXPIRED_EVENT = "interviewai:auth-expired";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && auth) {
      // Token expired or was revoked: drop it and let AuthContext send the user to /login.
      setToken(null);
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw new Error(data.error || `request failed (${res.status})`);
  }
  return data;
}

export const api = {
  register: (payload) => request("/auth/register", { method: "POST", body: payload, auth: false }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload, auth: false }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me"),
  updateProfile: (payload) => request("/users/me", { method: "PUT", body: payload }),
  exportMyData: () => request("/users/me/export"),
  deleteMyAccount: () => request("/users/me", { method: "DELETE" }),

  listScenarios: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/scenarios${suffix}`, { auth: false });
  },
  scenarioFilters: () => request("/scenarios/filters", { auth: false }),
  recommendedScenarios: () => request("/scenarios/recommended"),
  getScenario: (id) => request(`/scenarios/${id}`, { auth: false }),

  startSession: (scenarioId) => request("/sessions", { method: "POST", body: { scenarioId } }),
  getSession: (id) => request(`/sessions/${id}`),
  submitAnswer: (id, answerText, inputMode) =>
    request(`/sessions/${id}/answer`, { method: "POST", body: { answerText, inputMode } }),
  finishSession: (id) => request(`/sessions/${id}/finish`, { method: "POST" }),
  getFeedback: (id) => request(`/sessions/${id}/feedback`),
  deleteSession: (id) => request(`/sessions/${id}`, { method: "DELETE" }),
  getSessionChat: (id) => request(`/sessions/${id}/chat`),
  sendSessionChatMessage: (id, message) =>
    request(`/sessions/${id}/chat`, { method: "POST", body: { message } }),

  getProgress: () => request("/progress"),
};
