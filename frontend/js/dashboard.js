(async function init() {
  const session = await requireSession();
  if (!session) return;
  renderSidebar("home");

  await Promise.all([loadSummary(), loadRecentAlerts(), loadSparkline()]);
  updateTimestamp();
})();

async function loadSummary() {
  try {
    const s = await API.get("/api/analytics/summary");

    setText("stat-total-devices",    s.total_devices);
    setText("stat-active-devices",   s.active_devices);
    setText("stat-total-alerts",     s.total_alerts);
    setText("stat-unresolved-alerts",s.unresolved_alerts);

    // Health bars
    const total      = Number(s.total_devices)    || 0;
    const active     = Number(s.active_devices)   || 0;
    const totalAlert = Number(s.total_alerts)      || 0;
    const unresolved = Number(s.unresolved_alerts) || 0;

    // Active ratio
    const activeRatio = total > 0 ? Math.round((active / total) * 100) : 0;
    setBar("hbar-active",  activeRatio, activeRatio >= 60 ? "ok" : "warn");
    setText("hval-active", activeRatio + "%");

    // Alert backlog: unresolved as % of total alerts (capped at 100)
    const backlogPct = totalAlert > 0 ? Math.min(100, Math.round((unresolved / totalAlert) * 100)) : 0;
    setBar("hbar-backlog", backlogPct, backlogPct > 40 ? "alarm" : "warn");
    setText("hval-backlog", backlogPct + "%");

    // Resolve rate: resolved / total
    const resolved    = totalAlert - unresolved;
    const resolvePct  = totalAlert > 0 ? Math.round((resolved / totalAlert) * 100) : 100;
    setBar("hbar-resolve", resolvePct, resolvePct >= 60 ? "ok" : "warn");
    setText("hval-resolve", resolvePct + "%");

    // Network status banner
    const statusEl = document.getElementById("network-status");
    if (active === 0 && total > 0) {
      statusEl.style.background    = "var(--alarm-dim)";
      statusEl.style.borderColor   = "rgba(255,77,94,.2)";
      statusEl.style.color         = "var(--alarm)";
      statusEl.innerHTML = warningIcon() + " All devices offline";
    } else if (unresolved > 5) {
      statusEl.style.background    = "var(--warn-dim)";
      statusEl.style.borderColor   = "rgba(255,207,92,.2)";
      statusEl.style.color         = "var(--warn)";
      statusEl.innerHTML = warningIcon() + " High alert backlog";
    }
  } catch (err) {
    console.error("loadSummary:", err);
  }
}

async function loadRecentAlerts() {
  const body = document.getElementById("recent-alerts-body");
  try {
    const alerts = await API.get("/api/alerts");
    const recent  = alerts.slice(0, 8);
    if (!recent.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty-state" style="padding:40px 20px;">No alerts recorded yet.</td></tr>`;
      return;
    }
    body.innerHTML = recent
      .map(
        (a) => `
      <tr onclick="window.location.href='/alerts.html?id=${a.alert_id}'" style="cursor:pointer;">
        <td class="mono">${fmtDateTime(a.timestamp)}</td>
        <td>
          <div style="font-weight:600;">${a.device_name}</div>
          <div class="mono" style="color:var(--text-faint);font-size:11px;">${a.location || ""}</div>
        </td>
        <td style="color:${a.detection_type === "Distress Sound" ? "var(--alarm)" : "var(--text)"};">${a.detection_type}</td>
        <td class="mono">${Number(a.confidence_score).toFixed(1)}%</td>
        <td><span class="badge ${a.status}">${a.status}</span></td>
      </tr>`
      )
      .join("");
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="empty-state" style="padding:40px 20px;">Failed to load alerts.</td></tr>`;
  }
}

async function loadSparkline() {
  try {
    const data = await API.get("/api/analytics/incidents-per-day?days=7");
    if (!data || !data.length) return;

    const wrap = document.getElementById("mini-sparkline");
    const max  = Math.max(...data.map((d) => Number(d.count)), 1);
    wrap.innerHTML = data
      .map((d) => {
        const pct = Math.max(6, Math.round((Number(d.count) / max) * 100));
        const cls = Number(d.count) > 0 ? "bar alarm" : "bar";
        const label = new Date(d.day).toLocaleDateString(undefined, { weekday: "short" });
        return `<div class="${cls}" style="height:${pct}%" title="${label}: ${d.count} incident${d.count !== 1 ? "s" : ""}"></div>`;
      })
      .join("");

    // label left edge with the oldest day
    const oldest = new Date(data[0].day);
    const leftLabel = document.getElementById("spark-label-left");
    if (leftLabel) leftLabel.textContent = oldest.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch (err) {
    // sparkline is decorative — fail silently
  }
}

function updateTimestamp() {
  const el = document.getElementById("last-updated");
  if (el) {
    const now = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    el.innerHTML = clockIcon() + " Updated at " + now;
  }
}

// ── helpers ──────────────────────────────────────────────────────────

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "—";
}

function setBar(id, pct, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.width = pct + "%";
  el.className   = "health-bar " + cls;
}

function warningIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;"><polygon points="10.29 3.86 1.82 18 22.18 18 13.71 3.86 10.29 3.86"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
}

function clockIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
}
