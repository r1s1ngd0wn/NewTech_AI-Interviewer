const TOKEN_KEY = "interviewai.token";
import { supabase, previewAuth } from './supabase.js';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
export const AUTH_EXPIRED_EVENT = "interviewai:auth-expired";

function signalAuthEnded(code) {
  setToken(null);
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { code } }));
}

export async function getToken() {
  if (previewAuth) return localStorage.getItem(TOKEN_KEY);
  const { data, error } = supabase ? await supabase.auth.getSession() : { data: {} };
  if (error) throw error;
  return data.session?.access_token || null;
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  // Files and recordings are sent as they are; the browser sets their content type.
  const isFormData = body instanceof FormData || (typeof Blob !== "undefined" && body instanceof Blob);
  const headers = isFormData ? {} : { "Content-Type": "application/json" };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (auth && (res.status === 401 || data.code === 'ACCOUNT_INACTIVE')) signalAuthEnded(data.code);
    const error = new Error(data.error || `request failed (${res.status})`);
    error.code = data.code;
    throw error;
  }
  return data;
}

async function streamRequest(path, message, onEvent, signal) {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || data.code === 'ACCOUNT_INACTIVE') signalAuthEnded(data.code);
    const error = new Error(data.error || `request failed (${res.status})`);
    error.code = data.code;
    throw error;
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
  browseScenarios: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")),
    );
    const suffix = qs.toString() ? "?" + qs.toString() : "";
    return request("/scenarios/browse" + suffix, { auth: false });
  },
  scenarioFilters: () => request("/scenarios/filters", { auth: false }),
  recommendedScenarios: () => request("/scenarios/recommended"),
  getScenario: (id) => request(`/scenarios/${id}`, { auth: false }),

  startSession: (scenarioId) => request("/sessions", { method: "POST", body: { scenarioId } }),
  prepareSession: (id) => request(`/sessions/${id}/prepare`, { method: "POST" }),
  getSession: (id) => request(`/sessions/${id}`),
  submitAnswer: (id, answerText, inputMode) =>
    request(`/sessions/${id}/answer`, { method: "POST", body: { answerText, inputMode } }),
  speechStatus: () => request("/speech/status"),
  transcribeAudio: (audio) => request("/speech/transcribe", { method: "POST", body: audio }),
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
  confirmAction: id => request(`/coach/actions/${id}/confirm`, { method: 'POST' }),
  cancelAction: id => request(`/coach/actions/${id}/cancel`, { method: 'POST' }),
  listPlans: () => request('/plans'),
  createPlan: body => request('/plans', { method: 'POST', body }),
  updatePlan: (id, body) => request(`/plans/${id}`, { method: 'PATCH', body }),
  deletePlan: id => request(`/plans/${id}`, { method: 'DELETE' }),
  addPlanItem: (id, body) => request(`/plans/${id}/items`, { method: 'POST', body }),
  updatePlanItem: (id, body) => request(`/plans/items/${id}`, { method: 'PATCH', body }),
  deletePlanItem: id => request(`/plans/items/${id}`, { method: 'DELETE' }),
  aiHealth: () => request('/health/ai', { auth: false }),
  listSessionDocuments: (id) => request(`/sessions/${id}/documents`),
  uploadSessionDocument: (id, file) => {
    const body = new FormData();
    body.append("file", file);
    return request(`/sessions/${id}/documents`, { method: "POST", body });
  },
  deleteSessionDocument: (id, documentId) =>
    request(`/sessions/${id}/documents/${documentId}`, { method: "DELETE" }),

  getProgress: () => request("/progress"),

  getAdminAiUsage: (range = 30) => request(`/admin/ai-usage?range=${encodeURIComponent(range)}`),
  getAdminAiUsageLog: () => request('/admin/ai-usage-log'),
  listAdminAiLogs: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value !== null && value !== undefined)));
    return request(`/admin/ai-logs?${qs.toString()}`);
  },
  listAdminUsers: (params = {}) => { const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v])=>v!==''&&v!==null&&v!==undefined))); return request(`/admin/users?${qs}`); },
  updateAdminUser: (id, patch) => request(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  setAdminUserActive: (id, isActive) => request(`/admin/users/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { isActive } }),
  listAdminScenarios: (params = {}) => { const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v])=>v!==''&&v!==null&&v!==undefined))); return request(`/admin/scenarios?${qs}`); },
  updateAdminScenario: (id, patch) => request(`/admin/scenarios/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
};
