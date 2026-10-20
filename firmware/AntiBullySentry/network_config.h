// =============================================================================
//  network_config.h
//  Copy this file into the same folder as AntiBullySentry.ino
//  Fill in YOUR values below — do not commit this file.
// =============================================================================
#pragma once

// ── WiFi ──────────────────────────────────────────────────────────────────────
#define WIFI_SSID     "apai696-2.4G@unifi"   // your hotspot name
#define WIFI_PASSWORD  "0197538009"   // ← your WiFi password

// ── Backend server ────────────────────────────────────────────────────────────
// Run  ipconfig  on the PC running the Node backend.
// Use the IPv4 address under your WiFi adapter (e.g. 192.168.1.42).
// Port 3000 matches PORT=3000 in the backend .env.
#define SERVER_HOST  "192.168.1.108"   // your PC's IP on hotspot W
#define SERVER_PORT  3000

// ── Device identity ───────────────────────────────────────────────────────────
// Must EXACTLY match the device_id you type in Device Management → Add Device.
// Backend returns HTTP 404 for unknown IDs — register first, then flash.
#define DEVICE_ID  "ESP32"   // ← must match the dashboard registration

// ── Shared secret ─────────────────────────────────────────────────────────────
// Must be IDENTICAL to DEVICE_API_KEY in the backend .env file.
// Your .env currently has:  DEVICE_API_KEY=change-this-shared-secret
// Change BOTH to something real before testing, e.g. "sentry-key-faiq2024"
#define DEVICE_API_KEY  "change-this-shared-secret"  // ← match backend .env

// ── NTP / timezone ────────────────────────────────────────────────────────────
// Malaysia / Singapore / Philippines = UTC+8 = 8 × 3600 = 28800
#define NTP_SERVER      "pool.ntp.org"
#define NTP_GMT_OFFSET  28800

// ── Keep-alive heartbeat ──────────────────────────────────────────────────────
#define HEARTBEAT_INTERVAL_MS  30000UL   // ping backend every 30 s

