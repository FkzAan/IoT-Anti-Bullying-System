let devicesById = {};
let latestDetectionByDevice = {}; // device_id -> { sound_type, confidence, timestamp }

(async function init() {
  const session = await requireSession();
  if (!session) return;
  renderSidebar("live");

  await loadDevices();
  renderDeviceGrid();
  connectSocket();
})();

async function loadDevices() {
  try {
    const devices = await API.get("/api/devices");
    devicesById = {};
    devices.forEach((d) => (devicesById[d.device_id] = d));
  } catch (err) {
    console.error(err);
  }
}

function connectSocket() {
  const socket = io({ withCredentials: true });

  socket.on("device:update", (device) => {
    devicesById[device.device_id] = device;
    renderDeviceGrid();
  });

  socket.on("sensor:log", (log) => {
    latestDetectionByDevice[log.device_id] = log;
    renderDeviceGrid();
    if (log.sound_type === "Distress Sound") flashCard(log.device_id);
  });

  socket.on("alert:new", () => {
    // A confirmed alert also implies a fresh distress detection — refresh device list quietly
    loadDevices().then(renderDeviceGrid);
  });
}

function renderDeviceGrid() {
  const grid = document.getElementById("device-grid");
  const devices = Object.values(devicesById);

  if (!devices.length) {
    grid.innerHTML = `<div class="empty-state">No devices registered yet. Add one from Device Management.</div>`;
    return;
  }

  grid.innerHTML = devices
    .map((d) => {
      const det = latestDetectionByDevice[d.device_id];
      const isDistress = det && det.sound_type === "Distress Sound";
      return `
      <div class="device-card ${isDistress ? "detecting" : ""}" id="card-${d.device_id}">
        <div class="top-row">
          <div>
            <div class="device-name">${d.device_name}</div>
            <div class="device-loc">${d.location || "No location set"}</div>
          </div>
          <span class="status-pill ${d.status}"><span class="dot"></span>${d.status}</span>
        </div>
        <div class="device-id">${d.device_id}</div>
        <div style="margin-top:12px;">
          <div class="detection-row"><span class="k">Classification</span><span class="v ${isDistress ? "distress" : "normal"}">${det ? det.sound_type : "—"}</span></div>
          <div class="detection-row"><span class="k">Confidence</span><span class="v">${det ? Number(det.confidence).toFixed(1) + "%" : "—"}</span></div>
          <div class="detection-row"><span class="k">Last seen</span><span class="v">${timeAgo(d.last_seen)}</span></div>
        </div>
      </div>`;
    })
    .join("");
}

function flashCard(deviceId) {
  const card = document.getElementById(`card-${deviceId}`);
  if (!card) return;
  card.classList.add("detecting");
  setTimeout(() => card.classList.remove("detecting"), 4000);
}
