/**
 * Small fetch wrapper shared by every page.
 * Uses same-origin cookies for session auth (credentials: "include").
 */
const API = {
  async get(url) {
    const res = await fetch(url, { credentials: "include" });
    return API._handle(res);
  },
  async post(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    return API._handle(res);
  },
  async put(url, body) {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    return API._handle(res);
  },
  async patch(url, body) {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    return API._handle(res);
  },
  async del(url) {
    const res = await fetch(url, { method: "DELETE", credentials: "include" });
    return API._handle(res);
  },
  async _handle(res) {
    if (res.status === 401) {
      window.location.href = "/login.html";
      return null;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  },
};

/** Guards a dashboard page — redirects to login if there's no active session. */
async function requireSession() {
  const result = await API.get("/api/auth/me");
  if (!result || !result.authenticated) {
    window.location.href = "/login.html";
    return null;
  }
  const el = document.getElementById("current-username");
  if (el) el.textContent = result.username;
  return result;
}

function timeAgo(dateStr) {
  if (!dateStr) return "never";
  const diff = (Date.now() - new Date(dateStr.replace(" ", "T") + "Z")) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtDateTime(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr.replace(" ", "T") + "Z");
  return d.toLocaleString();
}
