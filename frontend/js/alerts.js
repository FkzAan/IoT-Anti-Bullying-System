(async function init() {
  const session = await requireSession();
  if (!session) return;
  renderSidebar("alerts");

  await loadAlerts();

  document.getElementById("filter-apply").addEventListener("click", () => loadAlerts());
  document.getElementById("filter-clear").addEventListener("click", () => {
    document.getElementById("filter-status").value = "";
    document.getElementById("filter-from").value = "";
    document.getElementById("filter-to").value = "";
    loadAlerts();
  });
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });

  const socket = io({ withCredentials: true });
  socket.on("alert:new", () => loadAlerts());
  socket.on("alert:status", () => loadAlerts());

  // Deep-link support: /alerts.html?id=123 opens that alert directly
  const params = new URLSearchParams(window.location.search);
  if (params.get("id")) openAlertDetail(params.get("id"));
})();

async function loadAlerts() {
  const body = document.getElementById("alerts-body");
  const status = document.getElementById("filter-status").value;
  const from = document.getElementById("filter-from").value;
  const to = document.getElementById("filter-to").value;

  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);

  try {
    const alerts = await API.get(`/api/alerts?${qs.toString()}`);
    if (!alerts.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty-state">No alerts match these filters.</td></tr>`;
      return;
    }
    body.innerHTML = alerts
      .map(
        (a) => `
      <tr onclick="openAlertDetail(${a.alert_id})">
        <td class="mono">${fmtDateTime(a.timestamp)}</td>
        <td>${a.device_name}<div class="mono" style="color:var(--text-faint)">${a.location || ""}</div></td>
        <td>${a.detection_type}</td>
        <td class="mono">${Number(a.confidence_score).toFixed(1)}%</td>
        <td><span class="badge ${a.status}">${a.status}</span></td>
      </tr>`
      )
      .join("");
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="empty-state">Failed to load alerts.</td></tr>`;
  }
}

async function openAlertDetail(alertId) {
  const backdrop = document.getElementById("modal-backdrop");
  const content = document.getElementById("modal-content");
  backdrop.style.display = "flex";
  content.innerHTML = "Loading…";

  try {
    const a = await API.get(`/api/alerts/${alertId}`);
    content.innerHTML = `
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <h2 style="margin-top:0;">Alert #${a.alert_id}</h2>
      <div class="mono" style="color:var(--text-dim);font-size:12px;margin-bottom:12px;">${fmtDateTime(a.timestamp)}</div>
      ${a.image_path ? `<img src="${a.image_path}" alt="Captured frame" />` : `<div class="empty-state" style="padding:24px;">No image captured</div>`}
      <div class="detection-row"><span class="k">Device</span><span class="v">${a.device_name} (${a.device_id})</span></div>
      <div class="detection-row"><span class="k">Location</span><span class="v">${a.location || "—"}</span></div>
      <div class="detection-row"><span class="k">Classification</span><span class="v distress">${a.detection_type}</span></div>
      <div class="detection-row"><span class="k">Confidence</span><span class="v">${Number(a.confidence_score).toFixed(1)}%</span></div>

      <div class="field" style="margin-top:18px;">
        <label>Status</label>
        <select id="status-select">
          <option value="new" ${a.status === "new" ? "selected" : ""}>New</option>
          <option value="investigating" ${a.status === "investigating" ? "selected" : ""}>Investigating</option>
          <option value="resolved" ${a.status === "resolved" ? "selected" : ""}>Resolved</option>
        </select>
      </div>
      ${a.image_path ? `<a class="btn btn-ghost" style="margin-right:8px;" href="${a.image_path}" download>Download image</a>` : ""}
      <button class="btn btn-primary" id="save-status-btn">Save status</button>

      ${a.history && a.history.length ? `
        <h3 style="font-size:12px;color:var(--text-dim);text-transform:uppercase;margin-top:22px;">Status history</h3>
        ${a.history.map(h => `<div class="mono" style="font-size:11.5px;color:var(--text-faint);padding:4px 0;">${fmtDateTime(h.changed_at)} — ${h.old_status || "created"} → ${h.new_status} (${h.changed_by || "system"})</div>`).join("")}
      ` : ""}
    `;

    document.getElementById("save-status-btn").addEventListener("click", async () => {
      const newStatus = document.getElementById("status-select").value;
      try {
        await API.patch(`/api/alerts/${alertId}/status`, { status: newStatus });
        closeModal();
        loadAlerts();
      } catch (err) {
        alert(err.message);
      }
    });
  } catch (err) {
    content.innerHTML = `<button class="modal-close" onclick="closeModal()">&times;</button><div class="empty-state">Failed to load alert.</div>`;
  }
}

function closeModal() {
  document.getElementById("modal-backdrop").style.display = "none";
  // Clean the ?id= param without reloading
  const url = new URL(window.location);
  url.searchParams.delete("id");
  window.history.replaceState({}, "", url);
}
