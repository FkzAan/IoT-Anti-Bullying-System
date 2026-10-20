(async function init() {
  const session = await requireSession();
  if (!session) return;
  renderSidebar("devices");

  await loadDevices();
  document.getElementById("add-device-btn").addEventListener("click", () => openDeviceForm());
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });
})();

async function loadDevices() {
  const body = document.getElementById("devices-body");
  try {
    const devices = await API.get("/api/devices");
    if (!devices.length) {
      body.innerHTML = `<tr><td colspan="6" class="empty-state">No devices registered yet.</td></tr>`;
      return;
    }
    body.innerHTML = devices
      .map(
        (d) => `
      <tr>
        <td>${d.device_name}</td>
        <td class="mono">${d.device_id}</td>
        <td>${d.location || "—"}</td>
        <td><span class="status-pill ${d.status}"><span class="dot"></span>${d.status}</span></td>
        <td class="mono">${timeAgo(d.last_seen)}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;" onclick='openDeviceForm(${JSON.stringify(d)})'>Edit</button>
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;color:var(--alarm);" onclick="deleteDevice('${d.device_id}')">Delete</button>
        </td>
      </tr>`
      )
      .join("");
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="empty-state">Failed to load devices.</td></tr>`;
  }
}

function openDeviceForm(device) {
  const isEdit = !!device;
  const backdrop = document.getElementById("modal-backdrop");
  const content = document.getElementById("modal-content");
  backdrop.style.display = "flex";

  content.innerHTML = `
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <h2 style="margin-top:0;">${isEdit ? "Edit device" : "Register new device"}</h2>
    <div class="field">
      <label>Device ID</label>
      <input id="f-device-id" value="${isEdit ? device.device_id : ""}" placeholder="ESP32-CAM-01" ${isEdit ? "disabled" : ""} />
    </div>
    <div class="field">
      <label>Device name</label>
      <input id="f-device-name" value="${isEdit ? device.device_name : ""}" placeholder="Corridor Sentry A" />
    </div>
    <div class="field">
      <label>Location</label>
      <input id="f-location" value="${isEdit ? device.location || "" : ""}" placeholder="Block A, Level 2 Corridor" />
    </div>
    <div class="error-text" id="form-error"></div>
    <button class="btn btn-primary" id="save-device-btn">${isEdit ? "Save changes" : "Register device"}</button>
  `;

  document.getElementById("save-device-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("form-error");
    const device_id = document.getElementById("f-device-id").value.trim();
    const device_name = document.getElementById("f-device-name").value.trim();
    const location = document.getElementById("f-location").value.trim();

    if (!device_id || !device_name) {
      errorEl.textContent = "Device ID and name are required.";
      return;
    }

    try {
      if (isEdit) {
        await API.put(`/api/devices/${device_id}`, { device_name, location });
      } else {
        await API.post("/api/devices", { device_id, device_name, location });
      }
      closeModal();
      loadDevices();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

async function deleteDevice(deviceId) {
  if (!confirm(`Remove device "${deviceId}" and all its history? This cannot be undone.`)) return;
  try {
    await API.del(`/api/devices/${deviceId}`);
    loadDevices();
  } catch (err) {
    alert(err.message);
  }
}

function closeModal() {
  document.getElementById("modal-backdrop").style.display = "none";
}
