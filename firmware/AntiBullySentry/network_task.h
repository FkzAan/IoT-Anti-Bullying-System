// =============================================================================
//  network_task.h
//  Copy this file into the same folder as AntiBullySentry.ino
//
//  HOW TO USE:
//    1.  In AntiBullySentry.ino, at the very top (before every other #include):
//            #define NETWORK_TASK_IMPL
//            #include "network_config.h"
//            #include "network_task.h"
//
//    2.  In setup(), after Serial.begin():
//            networkInit();
//
//    3.  At the distress confirmation point, add ONE line after moveTo():
//            networkQueueAlert(distress_score, dir);
//
//  That's it. Everything else (WiFi reconnect, NTP, HTTP POST, heartbeat)
//  runs on Core 0 in a background FreeRTOS task — it never touches loop()
//  or the audio capture task.
// =============================================================================
#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>
#include "network_config.h"

// ---------------------------------------------------------------------------
//  Direction type — uses the same enum names as AntiBullySentry.ino
//  (LEFT / RIGHT / CENTER / UNKNOWN) so the cast in the .ino is trivial.
// ---------------------------------------------------------------------------
// The .ino already defines:  enum Direction { LEFT, RIGHT, CENTER, UNKNOWN };
// We re-use that enum directly — no second typedef needed.

// ---------------------------------------------------------------------------
//  Alert event struct pushed into the queue by loop()
// ---------------------------------------------------------------------------
struct AlertEvent {
  float     confidence;    // raw 0.0–1.0 from result.classification[ix].value
  int       direction;     // cast from your Direction enum: LEFT=0, RIGHT=1, CENTER=2, UNKNOWN=3
  uint32_t  deviceMillis;  // millis() snapshot at detection time
};

// Queue handle — defined here, allocated in networkInit()
extern QueueHandle_t xAlertQueue;

// ---------------------------------------------------------------------------
//  Public API
// ---------------------------------------------------------------------------

/** Call once from setup() — WiFi, NTP, queue, background task. */
void networkInit();

/**
 * Non-blocking. Call at the distress confirmation point.
 *   networkQueueAlert(distress_score, dir);
 * Drops an AlertEvent into the FreeRTOS queue; the background task sends it.
 */
void networkQueueAlert(float confidence, int direction);


// ===========================================================================
//  IMPLEMENTATION  — compiled only in the one translation unit that defines
//  NETWORK_TASK_IMPL (i.e. AntiBullySentry.ino).
// ===========================================================================
#ifdef NETWORK_TASK_IMPL

QueueHandle_t xAlertQueue = nullptr;

// ---------------------------------------------------------------------------
//  Internal helpers
// ---------------------------------------------------------------------------

static const char* dirStr(int d) {
  // Matches AntiBullySentry.ino's Direction enum: LEFT=0, RIGHT=1, CENTER=2
  switch (d) {
    case 0:  return "LEFT";
    case 1:  return "RIGHT";
    case 2:  return "CENTER";
    default: return "UNKNOWN";
  }
}

/** Returns current ISO-8601 timestamp, or millis string if NTP not synced. */
static String nowISO() {
  struct tm ti;
  if (getLocalTime(&ti, 0)) {
    char buf[25];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &ti);
    return String(buf);
  }
  return String(millis());  // backend falls back to server time if unparseable
}

/**
 * (Re)connect WiFi if needed.
 * Called before every outgoing HTTP request.
 * Blocks up to ~10 s, then gives up and returns false.
 */
static bool ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.println("[net] WiFi lost — reconnecting…");
  WiFi.disconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  for (int i = 0; i < 40; i++) {          // 40 × 250 ms = 10 s
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("[net] WiFi reconnected: ");
      Serial.println(WiFi.localIP());
      return true;
    }
    vTaskDelay(pdMS_TO_TICKS(250));
  }
  Serial.println("[net] WiFi reconnect timed out");
  return false;
}

/**
 * HTTP POST application/json to  http://SERVER_HOST:SERVER_PORT/<path>
 * Returns HTTP status code, or -1 on connection failure.
 */
static int postJSON(const char* path, const String& body) {
  if (!ensureWiFi()) return -1;

  String url = "http://";
  url += SERVER_HOST;
  url += ":";
  url += SERVER_PORT;
  url += path;

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_API_KEY);
  http.setTimeout(8000);   // 8 s — generous but finite

  int code = http.POST(body);
  if (code < 0) {
    Serial.printf("[net] POST %s failed: %s\n", path,
                  HTTPClient::errorToString(code).c_str());
  }
  http.end();
  return code;
}

// ---------------------------------------------------------------------------
//  Three outgoing message types
// ---------------------------------------------------------------------------

/** Marks the device online on the dashboard.  No body needed. */
static void doHeartbeat() {
  char path[80];
  snprintf(path, sizeof(path), "/api/device-ingest/%s/heartbeat", DEVICE_ID);

  int code = postJSON(path, "{}");
  if (code == 200 || code == 201)
    Serial.println("[net] ✓ Heartbeat");
  else if (code > 0)
    Serial.printf("[net] Heartbeat HTTP %d\n", code);
}

/**
 * Sends a sensor_logs row → shows up on the Live Monitoring page and
 * flashes the device card red.
 */
static void doTelemetry(float confidence) {
  char path[80];
  snprintf(path, sizeof(path), "/api/device-ingest/%s/telemetry", DEVICE_ID);

  // confidence is 0.0–1.0; the DB stores 0–100
  String body = "{\"sound_type\":\"Distress Sound\",\"confidence\":";
  body += String(confidence * 100.0f, 2);
  body += ",\"timestamp\":\"";
  body += nowISO();
  body += "\"}";

  int code = postJSON(path, body);
  if (code == 200 || code == 201)
    Serial.println("[net] ✓ Telemetry");
  else if (code > 0)
    Serial.printf("[net] Telemetry HTTP %d\n", code);
}

/**
 * Creates an alert row in the DB.
 * → emits  alert:new  over Socket.IO  → dashboard Alerts page updates live
 * → fires Telegram notification
 * detection_type encodes both "Distress Sound" and the direction so you can
 * see it in the dashboard without changing the schema.
 */
static void doAlert(const AlertEvent& evt) {
  char path[80];
  snprintf(path, sizeof(path), "/api/device-ingest/%s/alert", DEVICE_ID);

  // e.g.  "Distress Sound (LEFT)"
  String detType = "Distress Sound (";
  detType += dirStr(evt.direction);
  detType += ")";

  String body = "{\"detection_type\":\"";
  body += detType;
  body += "\",\"confidence_score\":";
  body += String(evt.confidence * 100.0f, 2);
  body += ",\"direction\":\"";
  body += dirStr(evt.direction);
  body += "\",\"timestamp\":\"";
  body += nowISO();
  body += "\",\"device_millis\":";
  body += String(evt.deviceMillis);
  body += "}";

  int code = postJSON(path, body);
  if (code == 201)
    Serial.printf("[net] ✓ Alert sent  conf=%.1f%%  dir=%s\n",
                  evt.confidence * 100.0f, dirStr(evt.direction));
  else if (code > 0)
    Serial.printf("[net] Alert HTTP %d\n", code);
}

// ---------------------------------------------------------------------------
//  Background FreeRTOS task — runs on Core 0, loop() on Core 1
// ---------------------------------------------------------------------------
static void networkTask(void* pv) {
  (void)pv;
  uint32_t lastHeartbeatMs = 0;

  Serial.println("[net] Network task running on Core 0");

  for (;;) {
    // 1. Drain alert queue (non-blocking)
    AlertEvent evt;
    while (xQueueReceive(xAlertQueue, &evt, 0) == pdTRUE) {
      Serial.printf("[net] Sending alert: conf=%.3f dir=%s\n",
                    evt.confidence, dirStr(evt.direction));
      doTelemetry(evt.confidence);   // live monitoring feed
      doAlert(evt);                  // alerts table + Telegram + Socket.IO
    }

    // 2. Periodic heartbeat
    uint32_t nowMs = (uint32_t)(esp_timer_get_time() / 1000ULL);
    if (nowMs - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeatMs = nowMs;
      doHeartbeat();
    }

    vTaskDelay(pdMS_TO_TICKS(500));  // check queue every 500 ms
  }
}

// ---------------------------------------------------------------------------
//  Public function bodies
// ---------------------------------------------------------------------------

void networkInit() {
  // WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[net] Connecting to WiFi");
  for (int i = 0; i < 80; i++) {   // up to 20 s at boot
    if (WiFi.status() == WL_CONNECTED) break;
    vTaskDelay(pdMS_TO_TICKS(250));
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[net] Connected — IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[net] WiFi not connected at boot (will retry on first send)");
  }

  // NTP
  configTime(NTP_GMT_OFFSET, 0, NTP_SERVER);
  struct tm ti;
  if (getLocalTime(&ti, 5000)) {
    char buf[25];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &ti);
    Serial.printf("[net] NTP synced: %s\n", buf);
  } else {
    Serial.println("[net] NTP pending (millis fallback active)");
  }

  // Queue (depth 8 — more than enough for any burst)
  xAlertQueue = xQueueCreate(8, sizeof(AlertEvent));
  if (!xAlertQueue) {
    Serial.println("[net] FATAL: queue creation failed");
    return;
  }

  // Task pinned to Core 0; audio capture task runs on Core 1
  xTaskCreatePinnedToCore(
    networkTask,   // function
    "netTask",     // name
    8192,          // stack bytes (HTTPClient needs ~6 KB)
    nullptr,       // param
    1,             // priority (low — never competes with audio)
    nullptr,       // handle not needed
    0              // Core 0
  );
}

void networkQueueAlert(float confidence, int direction) {
  if (!xAlertQueue) return;
  AlertEvent evt{ confidence, direction, millis() };
  // Non-blocking: if queue is somehow full, drop rather than stall audio
  if (xQueueSend(xAlertQueue, &evt, 0) != pdTRUE)
    Serial.println("[net] Queue full — alert dropped");
}

#endif // NETWORK_TASK_IMPL
