/**
 * Simulates an ESP32-CAM sentry device using plain HTTP POST.
 *
 * Usage:
 *   node simulate/simulateDeviceHttp.js
 *
 * Register the device "ESP32-CAM-01" from the dashboard's Device Management
 * page first — the backend ignores telemetry/heartbeats from unknown device IDs.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const DEVICE_ID = "ESP32-CAM-01";
const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const DEVICE_KEY = process.env.DEVICE_API_KEY || "";

async function postJson(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Key": DEVICE_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function sendHeartbeat() {
  try {
    await postJson(`/api/devices/${DEVICE_ID}/heartbeat`, {});
    console.log("[simulate] Heartbeat sent");
  } catch (err) {
    console.error("[simulate] Heartbeat failed:", err.message);
  }
}

async function sendTelemetry() {
  const isDistress = Math.random() < 0.15;
  const payload = {
    sound_type: isDistress ? "Distress Sound" : "Normal Ambient",
    confidence: Number(isDistress ? (85 + Math.random() * 14).toFixed(2) : (60 + Math.random() * 30).toFixed(2)),
    timestamp: new Date().toISOString(),
  };
  try {
    await postJson(`/api/devices/${DEVICE_ID}/telemetry`, payload);
    console.log("[simulate] Telemetry sent:", payload);
    if (isDistress) {
      console.log("[simulate] (Real hardware would now POST an image to /api/devices/:id/alert)");
    }
  } catch (err) {
    console.error("[simulate] Telemetry failed:", err.message);
  }
}

console.log(`[simulate] Acting as ${DEVICE_ID}, posting to ${BASE_URL}`);
sendHeartbeat();
sendTelemetry();
setInterval(sendHeartbeat, 10000);
setInterval(sendTelemetry, 5000);
