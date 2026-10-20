# IoT Sentry Admin Dashboard

Web admin dashboard + backend for the Autonomous Audio-Reactive Anti-Bullying
Sentry System (ESP32-CAM + INMP441 + TinyML + pan-tilt servo camera).

- **Backend:** Node.js + Express, MySQL, Socket.IO real-time push
- **Frontend:** Plain HTML/CSS/JS (no build step), Chart.js for analytics
- **Device comms:** HTTP POST only — no broker required

## 1. Prerequisites

- Node.js 18+
- MySQL 8+ running locally (or update `.env` to point elsewhere)

That's the whole list — no MQTT broker needed.

## 2. Setup

```bash
cd backend
npm install
cp .env.example .env
# edit .env: set DB_PASSWORD and DEVICE_API_KEY
```

The schema (`database/schema.sql`) and a default admin account are created
automatically the first time the server starts — you do not need to run the
SQL file by hand, though you can if you prefer:
```bash
mysql -u root -p < database/schema.sql
```

Default admin login (change immediately after first sign-in):
```
username: admin
password: admin123
```
(set via `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` in `.env`)

## 3. Run

```bash
cd backend
npm start          # or: npm run dev  (with nodemon auto-reload)
```

Open **http://localhost:3000** — this serves both the dashboard (`/frontend`)
and the API (`/api/...`).

## 4. Test without real hardware

A simulator fakes an ESP32 posting data over HTTP so you can see the Live
Monitoring page update in real time without flashing any hardware:

```bash
# 1. Register the device first from Device Management (device_id: ESP32-CAM-01)
# 2. Then run:
cd backend
npm run simulate
```

It posts random "Normal Ambient" / "Distress Sound" telemetry every 5s and a
heartbeat every 10s. It does not POST a real alert image — for that, call
the alert endpoint manually, e.g.:

```bash
curl -X POST http://localhost:3000/api/devices/ESP32-CAM-01/alert \
  -H "X-Device-Key: <your DEVICE_API_KEY from .env>" \
  -F "detection_type=Distress Sound" \
  -F "confidence_score=93.2" \
  -F "image=@/path/to/test.jpg"
```

## 5. How the ESP32 should talk to this backend

Every request from the device includes the header `X-Device-Key` set to the
value of `DEVICE_API_KEY` in `.env` — this lets the backend trust the device
without a browser-style login.

| Purpose | Method | Endpoint |
|---|---|---|
| Routine classification result | HTTP POST (JSON) | `POST /api/devices/{device_id}/telemetry` — body `{ sound_type, confidence, timestamp }` |
| Heartbeat / keep-alive | HTTP POST | `POST /api/devices/{device_id}/heartbeat` — no body needed |
| Confirmed distress alert + image | HTTP POST (multipart) | `POST /api/devices/{device_id}/alert` — fields `detection_type`, `confidence_score`, `timestamp`, and file field `image` |

Example ESP32 Arduino-style pseudocode for telemetry:
```cpp
HTTPClient http;
http.begin("http://<server-ip>:3000/api/devices/ESP32-CAM-01/telemetry");
http.addHeader("Content-Type", "application/json");
http.addHeader("X-Device-Key", "<your DEVICE_API_KEY>");
String body = "{\"sound_type\":\"Distress Sound\",\"confidence\":92.5}";
http.POST(body);
```

Devices must be registered from the dashboard's Device Management page
before the backend will accept data from them.

## 6. Project structure

```
backend/
  server.js              Express app entry point
  config/db.js           MySQL pool + auto schema init + default admin
  database/schema.sql    Table definitions
  middleware/auth.js     Session guard for dashboard API routes
  sockets/socket.js      Socket.IO emit helpers (device/alert/sensor events)
  routes/
    auth.js              Login / logout / session check
    devices.js            Dashboard-facing device CRUD (session auth)
    deviceIngest.js       Device-facing telemetry/heartbeat/alert ingestion (device key auth)
    alerts.js             Alert list/detail/status update
    analytics.js          Summary counts + chart data
  simulate/simulateDeviceHttp.js   Fake ESP32 for testing over HTTP
  uploads/                Captured incident images (static-served)

frontend/
  login.html, index.html, live.html, alerts.html, devices.html, analytics.html
  css/style.css
  js/api.js               Shared fetch helper + session guard
  js/sidebar.js            Shared nav injected into every page
  js/*.js                  Per-page logic
```

## 7. Security notes for the demo/viva

- Passwords are hashed with bcrypt; sessions are httpOnly cookies.
- The device-ingest endpoints use a separate shared-secret header
  (`X-Device-Key`) rather than the dashboard session, since the ESP32 can't
  do a browser login — set `DEVICE_API_KEY` in `.env` and flash the same
  value into the ESP32 firmware.
- For a real deployment (beyond this academic project) you'd want HTTPS,
  per-device keys instead of one shared key, and rate limiting on the
  ingest endpoints.
