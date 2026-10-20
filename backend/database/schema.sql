-- IoT Sentry Admin Dashboard — MySQL schema
-- Run with: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS sentry_dashboard CHARACTER SET utf8mb4;
USE sentry_dashboard;

-- Admin users who can log into the dashboard
CREATE TABLE IF NOT EXISTS admin (
  admin_id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Registered ESP32-CAM sentry devices
CREATE TABLE IF NOT EXISTS device (
  device_id VARCHAR(50) PRIMARY KEY,
  device_name VARCHAR(100) NOT NULL,
  location VARCHAR(150) DEFAULT NULL,
  status ENUM('online', 'offline') NOT NULL DEFAULT 'offline',
  last_seen DATETIME DEFAULT NULL,
  registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Every classification result reported by a device (both normal and distress)
CREATE TABLE IF NOT EXISTS sensor_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(50) NOT NULL,
  sound_type VARCHAR(50) NOT NULL,       -- e.g. 'Normal Ambient' | 'Distress Sound'
  confidence DECIMAL(5,2) NOT NULL,      -- 0.00 - 100.00
  timestamp DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES device(device_id) ON DELETE CASCADE,
  INDEX idx_sensor_device_time (device_id, timestamp)
);

-- Confirmed distress-sound incidents with captured image
CREATE TABLE IF NOT EXISTS alerts (
  alert_id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(50) NOT NULL,
  detection_type VARCHAR(50) NOT NULL DEFAULT 'Distress Sound',
  confidence_score DECIMAL(5,2) NOT NULL,
  image_path VARCHAR(255) DEFAULT NULL,
  snap_ready TINYINT(1) NOT NULL DEFAULT 0,  -- set to 1 by audio ESP32 after servo stops
  timestamp DATETIME NOT NULL,
  status ENUM('new', 'investigating', 'resolved') NOT NULL DEFAULT 'new',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES device(device_id) ON DELETE CASCADE,
  INDEX idx_alerts_status (status),
  INDEX idx_alerts_time (timestamp)
);

-- Audit trail for alert status changes
CREATE TABLE IF NOT EXISTS alert_status_log (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  alert_id INT NOT NULL,
  old_status VARCHAR(20),
  new_status VARCHAR(20) NOT NULL,
  changed_by VARCHAR(50),
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alert_id) REFERENCES alerts(alert_id) ON DELETE CASCADE
);
