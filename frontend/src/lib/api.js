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
  const isFormData = body instanceof FormData;
  const headers = isFormData ? {} : { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
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

async function streamRequest(path, message, onEvent, signal) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const line = block.split("\n").find((part) => part.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "error") throw new Error(event.error);
        onEvent(event);
        if (event.type === "done") completed = true;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!completed) throw new Error("the reply stream ended before completion");
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
  prepareSession: (id) => request(`/sessions/${id}/prepare`, { method: "POST" }),
  getSession: (id) => request(`/sessions/${id}`),
  submitAnswer: (id, answerText, inputMode) =>
    request(`/sessions/${id}/answer`, { method: "POST", body: { answerText, inputMode } }),
  finishSession: (id) => request(`/sessions/${id}/finish`, { method: "POST" }),
  getFeedback: (id) => request(`/sessions/${id}/feedback`),
  deleteSession: (id) => request(`/sessions/${id}`, { method: "DELETE" }),
  getSessionChat: (id) => request(`/sessions/${id}/chat`),
  sendSessionChatMessage: (id, message) =>
    request(`/sessions/${id}/chat`, { method: "POST", body: { message } }),
  streamSessionChatMessage: (id, message, onEvent, signal) =>
    streamRequest(`/sessions/${id}/chat/stream`, message, onEvent, signal),
  listDocuments: () => request("/documents"),
  getDocument: (id) => request(`/documents/${id}`),
  uploadDocument: (kind, file) => {
    const body = new FormData();
    body.append("kind", kind);
    body.append("file", file);
    return request("/documents", { method: "POST", body });
  },
  deleteDocument: (id) => request(`/documents/${id}`, { method: "DELETE" }),
  streamCoachMessage: (message, onEvent, signal) =>
    streamRequest("/coach/chat", message, onEvent, signal),
  listSessionDocuments: (id) => request(`/sessions/${id}/documents`),
  uploadSessionDocument: (id, file) => {
    const body = new FormData();
    body.append("file", file);
    return request(`/sessions/${id}/documents`, { method: "POST", body });
  },
  deleteSessionDocument: (id, documentId) =>
    request(`/sessions/${id}/documents/${documentId}`, { method: "DELETE" }),

  getProgress: () => request("/progress"),
};
