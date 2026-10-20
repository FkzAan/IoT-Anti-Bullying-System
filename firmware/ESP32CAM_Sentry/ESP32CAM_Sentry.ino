/*
 * ESP32-CAM Sentry — Snapshot on Distress Alert
 * Board: AI-Thinker ESP32-CAM
 *
 * HOW IT WORKS:
 *   1. Connects to the same hotspot as the audio ESP32.
 *   2. Every second, polls GET /api/device-ingest/ESP32/pending-snap
 *      — the backend returns the latest alert that has no image yet.
 *   3. Captures a JPEG and POSTs it to
 *      POST /api/device-ingest/ESP32/alert/<alertId>/image
 *   4. Dashboard alert row updates live with the photo.
 *
 * SETUP:
 *   Board:        AI Thinker ESP32-CAM  (in Arduino IDE board manager)
 *   Programmer:   Anything — flash via USB-to-serial adapter or onboard USB
 *   Partition:    "Huge APP (3MB No OTA)" — camera + WiFi needs the space
 *
 * FILL IN:
 *   WIFI_SSID, WIFI_PASSWORD, SERVER_HOST — same values as audio ESP32
 *   DEVICE_API_KEY — same shared secret
 *   DEVICE_ID — same device_id registered in the dashboard (e.g. "ESP32")
 *
 * FIX (this version):
 *   fb_count was 2, which enables the camera driver's background DMA
 *   queue — esp_camera_fb_get() then returns the OLDEST queued frame,
 *   not a fresh one. That caused some alerts to ship with the PREVIOUS
 *   alert's snapshot instead of a live one. Setting fb_count = 1 forces
 *   every fb_get() to block for a genuinely new capture. The old
 *   "grab-and-discard one frame" workaround is no longer needed and
 *   has been removed — with fb_count = 1 there's no queue to flush.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_camera.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"   // disable brownout detector

// ── Credentials — fill these in ──────────────────────────────────────────────
#define WIFI_SSID       "apai696"
#define WIFI_PASSWORD   "00000000"
#define SERVER_HOST     "192.168.1.108"
#define SERVER_PORT     3000
#define DEVICE_ID       "ESP32"
#define DEVICE_API_KEY  "change-this-shared-secret"

// ── Polling interval ─────────────────────────────────────────────────────────
#define POLL_INTERVAL_MS  1000   // check for pending snap every 1 s

// ── AI-Thinker ESP32-CAM pin map ─────────────────────────────────────────────
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ── Flash LED (GPIO 4 on AI-Thinker) ─────────────────────────────────────────
#define FLASH_LED_PIN 4

// ─────────────────────────────────────────────────────────────────────────────

static String buildUrl(const char* path) {
  String url = "http://";
  url += SERVER_HOST;
  url += ":";
  url += SERVER_PORT;
  url += path;
  return url;
}

static bool ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.println("[cam] WiFi lost — reconnecting…");
  WiFi.disconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; i < 40; i++) {
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("[cam] Reconnected: ");
      Serial.println(WiFi.localIP());
      return true;
    }
    delay(250);
  }
  Serial.println("[cam] WiFi reconnect failed");
  return false;
}

/**
 * Poll the backend for a pending alert that needs an image.
 * Returns alert_id if one exists, -1 if none or error.
 */
static int getPendingAlertId() {
  if (!ensureWiFi()) return -1;

  char path[80];
  snprintf(path, sizeof(path), "/api/device-ingest/%s/pending-snap", DEVICE_ID);

  HTTPClient http;
  http.begin(buildUrl(path));
  http.addHeader("X-Device-Key", DEVICE_API_KEY);
  http.setTimeout(5000);

  int code = http.GET();
  if (code == 204) {
    http.end();
    return -1;   // nothing pending
  }
  if (code != 200) {
    Serial.printf("[cam] pending-snap HTTP %d\n", code);
    http.end();
    return -1;
  }

  String body = http.getString();
  http.end();

  // Parse alert_id from JSON — avoid pulling in ArduinoJson
  // body looks like: {"alert_id":104,"detection_type":"Distress Sound (RIGHT)",...}
  int idx = body.indexOf("\"alert_id\":");
  if (idx < 0) return -1;
  int start = idx + 11;   // skip past  "alert_id":
  int end   = body.indexOf(',', start);
  if (end < 0) end = body.indexOf('}', start);
  String idStr = body.substring(start, end);
  idStr.trim();
  return idStr.toInt();
}

/**
 * Capture a JPEG frame and POST it as multipart to the backend.
 * Returns true on HTTP 200.
 *
 * With fb_count = 1 (see initCamera), esp_camera_fb_get() always
 * blocks until a fresh frame is captured — no stale queued frame
 * can be returned, so a single get() after the flash settle delay
 * is sufficient. No discard-and-regrab needed anymore.
 */
static bool captureAndUpload(int alertId) {
  // FLUSH OLD FRAMES: The sensor runs continuously and buffers frames internally.
  // Even with fb_count=1, fb_get() can return stale frames from before servo moved.
  // Solution: grab and discard 3 frames, THEN capture the real one with flash.
  Serial.println("[cam] Flushing stale frames...");
  for (int i = 0; i < 3; i++) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (fb) {
      esp_camera_fb_return(fb);
    }
    delay(50);  // brief pause between discards
  }
  Serial.println("[cam] Stale frames flushed, capturing fresh frame...");

  // NOW capture the real frame with flash
  digitalWrite(FLASH_LED_PIN, HIGH);
  delay(150);                        // let the sensor adjust to the light

  camera_fb_t* fb = esp_camera_fb_get();   // THIS is the fresh frame

  digitalWrite(FLASH_LED_PIN, LOW);  // flash off after capture

  if (!fb) {
    Serial.println("[cam] Camera capture failed");
    return false;
  }

  Serial.printf("[cam] Captured %u bytes, uploading for alert %d…\n",
                fb->len, alertId);

  if (!ensureWiFi()) {
    esp_camera_fb_return(fb);
    return false;
  }

  char path[100];
  snprintf(path, sizeof(path),
           "/api/device-ingest/%s/alert/%d/image", DEVICE_ID, alertId);

  HTTPClient http;
  http.begin(buildUrl(path));
  http.addHeader("X-Device-Key", DEVICE_API_KEY);
  http.setTimeout(15000);   // image upload can take a few seconds on hotspot

  // Build multipart body manually
  String boundary = "----SentryBoundary7MA4YWxkTrZu0gW";
  String head = "--" + boundary + "\r\n";
  head += "Content-Disposition: form-data; name=\"image\"; filename=\"snap.jpg\"\r\n";
  head += "Content-Type: image/jpeg\r\n\r\n";
  String tail = "\r\n--" + boundary + "--\r\n";

  uint32_t totalLen = head.length() + fb->len + tail.length();
  http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
  http.addHeader("Content-Length", String(totalLen));

  // Build the full buffer in one shot (JPEG is typically 20-60 KB — fits in heap)
  uint8_t* buf = (uint8_t*)malloc(totalLen);
  if (!buf) {
    Serial.println("[cam] Not enough heap for upload buffer");
    esp_camera_fb_return(fb);
    http.end();
    return false;
  }

  size_t pos = 0;
  memcpy(buf + pos, head.c_str(), head.length()); pos += head.length();
  memcpy(buf + pos, fb->buf, fb->len);            pos += fb->len;
  memcpy(buf + pos, tail.c_str(), tail.length()); pos += tail.length();

  esp_camera_fb_return(fb);   // return frame buffer ASAP

  int code = http.POST(buf, totalLen);
  free(buf);
  http.end();

  if (code == 200) {
    Serial.printf("[cam] ✓ Image uploaded for alert %d\n", alertId);
    return true;
  } else {
    Serial.printf("[cam] Upload HTTP %d\n", code);
    return false;
  }
}

// ── Camera init ───────────────────────────────────────────────────────────────
static bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // fb_count is forced to 1 in BOTH branches below.
  // fb_count > 1 enables a background DMA queue where fb_get() can
  // return a stale, previously-captured frame instead of a fresh one —
  // that was the root cause of alerts showing the previous snapshot.
  if (psramFound()) {
    config.frame_size   = FRAMESIZE_UXGA;   // 1600×1200 (immediately overridden to SVGA below)
    config.jpeg_quality = 10;               // 0=best, 63=worst
    config.fb_count     = 1;                // was 2 — caused stale frame bug
  } else {
    config.frame_size   = FRAMESIZE_SVGA;   // 800×600
    config.jpeg_quality = 12;
    config.fb_count     = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[cam] Camera init failed: 0x%x\n", err);
    return false;
  }

  // Sensor tweaks for better indoor image
  sensor_t* s = esp_camera_sensor_get();
  s->set_brightness(s, 1);
  s->set_saturation(s, 0);
  s->set_framesize(s, FRAMESIZE_SVGA);   // SVGA plenty for dashboard thumbnail

  Serial.println("[cam] Camera ready (fb_count=1, single-buffer mode)");
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);   // disable brownout — camera draws heavy current

  Serial.begin(115200);
  Serial.println("--- ESP32-CAM Sentry ---");

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  // Camera
  if (!initCamera()) {
    Serial.println("[cam] FATAL: camera init failed — halting");
    while (true) delay(1000);
  }

  // WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[cam] Connecting to WiFi");
  for (int i = 0; i < 80; i++) {
    if (WiFi.status() == WL_CONNECTED) break;
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[cam] Connected: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[cam] WiFi not connected at boot (will retry)");
  }

  Serial.println("[cam] Polling for alerts every 1 s…");
}

void loop() {
  int alertId = getPendingAlertId();
  if (alertId > 0) {
    Serial.printf("[cam] Pending snap for alert %d\n", alertId);
    captureAndUpload(alertId);
  }
  delay(POLL_INTERVAL_MS);
}
