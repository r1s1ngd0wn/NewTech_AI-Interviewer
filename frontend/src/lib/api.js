const TOKEN_KEY = "interviewai.token";

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
    throw new Error(data.error || `request failed (${res.status})`);
  }
  return data;
}

export const api = {
  register: (payload) => request("/auth/register", { method: "POST", body: payload, auth: false }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload, auth: false }),
  me: () => request("/auth/me"),
  updateProfile: (payload) => request("/users/me", { method: "PUT", body: payload }),

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
  submitAnswer: (id, answerText) =>
    request(`/sessions/${id}/answer`, { method: "POST", body: { answerText } }),
  finishSession: (id) => request(`/sessions/${id}/finish`, { method: "POST" }),
  getFeedback: (id) => request(`/sessions/${id}/feedback`),
  deleteSession: (id) => request(`/sessions/${id}`, { method: "DELETE" }),

  getProgress: () => request("/progress"),
};
