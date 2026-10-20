// =============================================================================
//  network_task.h  — Simple version that works
//  Alert POST happens AFTER moveTo() — CAM polls time window, always snaps
//  after servo has already stopped.
// =============================================================================
#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>
#include "network_config.h"

struct AlertEvent {
  float    confidence;
  int      direction;
  uint32_t deviceMillis;
};

extern QueueHandle_t xAlertQueue;

void networkInit();
void networkQueueAlert(float confidence, int direction);  // call AFTER moveTo()

#ifdef NETWORK_TASK_IMPL

QueueHandle_t xAlertQueue = nullptr;

static const char* dirStr(int d) {
  switch (d) {
    case 0:  return "LEFT";
    case 1:  return "RIGHT";
    case 2:  return "CENTER";
    default: return "UNKNOWN";
  }
}

static String nowISO() {
  struct tm ti;
  if (getLocalTime(&ti, 0)) {
    char buf[25];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &ti);
    return String(buf);
  }
  return String(millis());
}

static bool ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.println("[net] WiFi lost — reconnecting...");
  WiFi.disconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; i < 40; i++) {
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

static int postJSON(const char* path, const String& body) {
  if (!ensureWiFi()) return -1;
  String url = "http://";
  url += SERVER_HOST; url += ":"; url += SERVER_PORT; url += path;
  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_API_KEY);
  http.setTimeout(8000);
  int code = http.POST(body);
  if (code < 0)
    Serial.printf("[net] POST %s failed: %s\n", path, HTTPClient::errorToString(code).c_str());
  http.end();
  return code;
}

static void doHeartbeat() {
  char path[80];
  snprintf(path, sizeof(path), "/api/device-ingest/%s/heartbeat", DEVICE_ID);
  int code = postJSON(path, "{}");
  if (code == 200 || code == 201) Serial.println("[net] Heartbeat OK");
  else if (code > 0) Serial.printf("[net] Heartbeat HTTP %d\n", code);
}

static void doTelemetry(float confidence) {
  char path[80];
  snprintf(path, sizeof(path), "/api/device-ingest/%s/telemetry", DEVICE_ID);
  String body = "{\"sound_type\":\"Distress Sound\",\"confidence\":";
  body += String(confidence * 100.0f, 2);
  body += ",\"timestamp\":\""; body += nowISO(); body += "\"}";
  int code = postJSON(path, body);
  if (code == 200 || code == 201) Serial.println("[net] Telemetry OK");
  else if (code > 0) Serial.printf("[net] Telemetry HTTP %d\n", code);
}

static void doAlert(const AlertEvent& evt) {
  char path[80];
  snprintf(path, sizeof(path), "/api/device-ingest/%s/alert", DEVICE_ID);

  String detType = "Distress Sound (";
  detType += dirStr(evt.direction); detType += ")";

  String body = "{\"detection_type\":\""; body += detType;
  body += "\",\"confidence_score\":";     body += String(evt.confidence * 100.0f, 2);
  body += ",\"direction\":\"";            body += dirStr(evt.direction);
  body += "\",\"timestamp\":\"";          body += nowISO();
  body += "\",\"device_millis\":";        body += String(evt.deviceMillis);
  body += "}";

  int code = postJSON(path, body);
  if (code == 201)
    Serial.printf("[net] Alert sent  conf=%.1f%%  dir=%s\n",
                  evt.confidence * 100.0f, dirStr(evt.direction));
  else if (code > 0)
    Serial.printf("[net] Alert HTTP %d\n", code);
}

static void networkTask(void* pv) {
  (void)pv;
  uint32_t lastHeartbeatMs = 0;
  Serial.println("[net] Network task running on Core 0");

  for (;;) {
    AlertEvent evt;
    while (xQueueReceive(xAlertQueue, &evt, 0) == pdTRUE) {
      doTelemetry(evt.confidence);
      doAlert(evt);
    }

    uint32_t nowMs = (uint32_t)(esp_timer_get_time() / 1000ULL);
    if (nowMs - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeatMs = nowMs;
      doHeartbeat();
    }

    vTaskDelay(pdMS_TO_TICKS(500));
  }
}

void networkInit() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[net] Connecting to WiFi");
  for (int i = 0; i < 80; i++) {
    if (WiFi.status() == WL_CONNECTED) break;
    vTaskDelay(pdMS_TO_TICKS(250));
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[net] Connected: "); Serial.println(WiFi.localIP());
  } else {
    Serial.println("[net] WiFi not connected at boot (will retry)");
  }

  configTime(NTP_GMT_OFFSET, 0, NTP_SERVER);
  struct tm ti;
  if (getLocalTime(&ti, 5000)) {
    char buf[25]; strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &ti);
    Serial.printf("[net] NTP synced: %s\n", buf);
  } else {
    Serial.println("[net] NTP pending");
  }

  xAlertQueue = xQueueCreate(4, sizeof(AlertEvent));
  if (!xAlertQueue) { Serial.println("[net] FATAL: queue failed"); return; }

  xTaskCreatePinnedToCore(networkTask, "netTask", 8192, nullptr, 1, nullptr, 0);
}

void networkQueueAlert(float confidence, int direction) {
  if (!xAlertQueue) return;
  AlertEvent evt{ confidence, direction, millis() };
  if (xQueueSend(xAlertQueue, &evt, 0) != pdTRUE)
    Serial.println("[net] Alert queue full — dropped");
}

#endif // NETWORK_TASK_IMPL
