# How to add networking to your existing .ino sketch

This patch is purely additive — it does not touch any detection, direction,
or servo logic.

---

## Step 1 — Add the two new files

Copy `network_config.h` and `network_task.h` into the same folder as your
`.ino` sketch. The Arduino IDE will include them automatically.

---

## Step 2 — Top of your .ino (before any other #includes)

Add these three lines. The `#define` must come BEFORE the `#include` of
`network_task.h` so the implementation is compiled in exactly once.

```cpp
// ── ADD THESE THREE LINES ──────────────────────────────────────────────────
#define NETWORK_TASK_IMPL    // compile the implementation in this translation unit
#include "network_config.h"
#include "network_task.h"
// ──────────────────────────────────────────────────────────────────────────
```

---

## Step 3 — In setup(), after Serial.begin and before EI init

```cpp
void setup() {
  Serial.begin(115200);

  // ── ADD: start networking (WiFi + NTP + background task) ─────────────────
  networkInit();
  // ─────────────────────────────────────────────────────────────────────────

  // ... rest of your existing setup (servo attach, mic init, EI task, etc.)
}
```

---

## Step 4 — At the distress confirmation point in your sketch

Find the exact spot where you already trigger the servo sweep — it will look
something like:

```cpp
// Your existing code (DO NOT CHANGE THIS)
if (distress_frames >= CONFIRM_FRAMES && !in_cooldown) {
    in_cooldown = true;
    cooldown_start = millis();

    // existing: move servo
    int angle = (direction == DIR_LEFT) ? 30 : (direction == DIR_RIGHT) ? 150 : 90;
    sentry_servo.write(angle);

    // ── ADD: queue the alert for the network task (non-blocking) ──────────
    networkQueueAlert(result.classification[distress_idx].value, direction);
    // ──────────────────────────────────────────────────────────────────────

    distress_frames = 0;
}
```

`result.classification[distress_idx].value` is the raw confidence float
(0.0–1.0) from your Edge Impulse `run_classifier_continuous()` output.
Replace `distress_idx` with whatever index you use to look up the
"distress" label.

The `direction` variable is whatever you're already using — just make sure
it uses the `SoundDirection` enum values (`DIR_LEFT`, `DIR_CENTER`,
`DIR_RIGHT`). If your existing code uses an int or a different enum, either:

- Cast it: `networkQueueAlert(conf, (SoundDirection)direction);`
- Or change your direction variable to use the `SoundDirection` enum
  (defined in `network_task.h`).

---

## Step 5 — Fill in your credentials

Open `network_config.h` and set:

| Define | What to put |
|---|---|
| `WIFI_SSID` | Your WiFi network name |
| `WIFI_PASSWORD` | Your WiFi password |
| `SERVER_HOST` | LAN IP of the PC running the Node backend, e.g. `"192.168.1.42"` |
| `SERVER_PORT` | Leave as 3000 unless you changed the backend port |
| `DEVICE_ID` | The exact device_id you registered in the dashboard Device Management page |
| `DEVICE_API_KEY` | The value of `DEVICE_API_KEY` in the backend's `.env` file |
| `NTP_GMT_OFFSET` | Your UTC offset in seconds (UTC+8 = `28800`, UTC+0 = `0`) |

---

## Step 6 — Register your device in the dashboard

Before flashing, log into the dashboard and go to **Device Management → Add Device**.
Set the Device ID to exactly the value of `DEVICE_ID` in `network_config.h`.
The backend will reject requests from unknown device IDs with HTTP 404.

---

## What you'll see on the dashboard

Once the device is online:

- **Live Monitoring page** — the device card turns green (online). Each
  distress event flashes the card red and shows the confidence score.
- **Alerts page** — a new row appears for every confirmed distress event,
  with timestamp, device name, detection type (including direction), and
  confidence score. You can change its status to Investigating / Resolved.
- **Telegram** — a notification is sent automatically if the backend has a
  Telegram bot configured.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Serial prints "WiFi not connected at boot" | Wrong SSID/password, or device not in range |
| HTTP 403 on all requests | `DEVICE_API_KEY` doesn't match backend `.env` |
| HTTP 404 on all requests | Device ID not registered in dashboard |
| HTTP 400 / 500 | Check the Node backend console for the exact error message |
| Alerts appear but with wrong direction | Check that your direction variable maps to DIR_LEFT/CENTER/RIGHT |
| NTP shows "not yet synced" but timestamps still work | Backend uses server time when it can't parse the timestamp — fine for now |
