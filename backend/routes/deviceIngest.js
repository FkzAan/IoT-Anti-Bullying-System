const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { pool } = require("../config/db");
const { emitNewAlert, emitDeviceUpdate, emitSensorLog } = require("../sockets/socket");
const { sendAlert } = require("../config/telegram");
const router = express.Router();

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${req.params.id}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — plenty for an ESP32-CAM JPEG frame
  fileFilter: (req, file, cb) => {
  console.log(file);

  const allowedExtensions = [".jpg", ".jpeg", ".png"];
  const ext = path.extname(file.originalname).toLowerCase();

  if (
    file.mimetype.startsWith("image/") ||
    allowedExtensions.includes(ext)
  ) {
    return cb(null, true);
  }

  return cb(new Error("Only image uploads are allowed."));
}
});

/**
 * POST /api/devices/:id/alert
 *
 * Accepts TWO content types:
 *
 * A) multipart/form-data  (ESP32-CAM with camera)
 *    Fields: image (file), detection_type, confidence_score, timestamp?
 *
 * B) application/json  (audio-only ESP32, no camera — e.g. AntiBully Sentry)
 *    Body: { detection_type, confidence_score, timestamp?, direction? }
 *
 * Both paths write to the alerts table, emit alert:new over Socket.IO, and
 * trigger the Telegram notification. The image_path is simply null for path B.
 */

// Middleware that handles BOTH content types on the same route:
// - If Content-Type is multipart/form-data → multer parses it (file + fields)
// - If Content-Type is application/json    → express.json() already ran globally;
//   req.body is populated and req.file is undefined (no multer interference)
function flexibleAlertParser(req, res, next) {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) {
    // Delegate to multer for multipart (camera upload path)
    upload.single("image")(req, res, next);
  } else {
    // JSON body — express.json() has already parsed req.body globally in server.js
    next();
  }
}

router.post("/:id/alert", flexibleAlertParser, async (req, res) => {
  try {
    // Simple shared-secret check so random clients can't create fake alerts.
    const key = req.header("X-Device-Key");
    if (process.env.DEVICE_API_KEY && key !== process.env.DEVICE_API_KEY) {
      return res.status(403).json({ error: "Invalid device key." });
    }

    const deviceId = req.params.id;
    // direction is an extra field sent by audio-only devices (no camera).
    // It is stored as part of detection_type for backwards-compat with the
    // existing alerts table (no schema migration needed).
    const { detection_type, confidence_score, timestamp, direction } = req.body;

    const [deviceRows] = await pool.query("SELECT * FROM device WHERE device_id = ?", [deviceId]);
    if (!deviceRows[0]) {
      return res.status(404).json({ error: "Unknown device. Register it first via the dashboard." });
    }

    const ts = timestamp ? new Date(timestamp) : new Date();
    const formattedTs = ts.toISOString().slice(0, 19).replace("T", " ");
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    const [result] = await pool.query(
      `INSERT INTO alerts (device_id, detection_type, confidence_score, image_path, timestamp, status)
       VALUES (?, ?, ?, ?, ?, 'new')`,
      [deviceId, detection_type || "Distress Sound", Number(confidence_score) || 0, imagePath, formattedTs]
    );

    // Mark any previous imageless/pending alerts for this device as 'none'
    // so the CAM's pending-snap query never picks up stale events
    await pool.query(
      `UPDATE alerts SET image_path = 'none'
       WHERE device_id = ? AND (image_path IS NULL OR image_path = 'pending') AND alert_id != ?`,
      [deviceId, result.insertId]
    );

    await pool.query("UPDATE device SET status = 'online', last_seen = ? WHERE device_id = ?", [
      formattedTs,
      deviceId,
    ]);

    const [alertRows] = await pool.query(
      `SELECT a.*, d.device_name, d.location FROM alerts a JOIN device d ON d.device_id = a.device_id WHERE a.alert_id = ?`,
      [result.insertId]
    );
    const [deviceRow] = await pool.query("SELECT * FROM device WHERE device_id = ?", [deviceId]);

emitNewAlert(alertRows[0]);
emitDeviceUpdate(deviceRow[0]);

const telegramMessage = `
🚨 Bullying Alert!

📍 Device : ${deviceRow[0].device_name}
📌 Location : ${deviceRow[0].location}

🎤 Detection : ${detection_type || "Distress Sound"}
🧭 Direction : ${direction || "—"}

📊 Confidence : ${Number(confidence_score) || 0}%

🕒 Time : ${formattedTs}

⚠ Please investigate immediately.
`;

await sendAlert(telegramMessage, imagePath);

res.status(201).json(alertRows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to record alert." });
  }
});

/**
 * POST /api/devices/:id/telemetry
 * JSON body:
 *   { "sound_type": "Normal Ambient" | "Distress Sound", "confidence": 82.5, "timestamp": "..." (optional) }
 *
 * Call this from the ESP32 every time the classifier produces a result
 * (e.g. every few seconds). Writes a row to sensor_logs, marks the device
 * online, and pushes a live update to the dashboard over Socket.IO.
 */
router.post("/:id/telemetry", express.json(), async (req, res) => {
  try {
    const key = req.header("X-Device-Key");
    if (process.env.DEVICE_API_KEY && key !== process.env.DEVICE_API_KEY) {
      return res.status(403).json({ error: "Invalid device key." });
    }

    const deviceId = req.params.id;
    const { sound_type, confidence, timestamp } = req.body;

    const [deviceRows] = await pool.query("SELECT * FROM device WHERE device_id = ?", [deviceId]);
    if (!deviceRows[0]) {
      return res.status(404).json({ error: "Unknown device. Register it first via the dashboard." });
    }

    const ts = timestamp ? new Date(timestamp) : new Date();
    const formattedTs = ts.toISOString().slice(0, 19).replace("T", " ");
    const finalSoundType = sound_type || "Normal Ambient";
    const finalConfidence = Number(confidence) || 0;

    const [result] = await pool.query(
      "INSERT INTO sensor_logs (device_id, sound_type, confidence, timestamp) VALUES (?, ?, ?, ?)",
      [deviceId, finalSoundType, finalConfidence, formattedTs]
    );
    await pool.query("UPDATE device SET status = 'online', last_seen = ? WHERE device_id = ?", [
      formattedTs,
      deviceId,
    ]);

    const [deviceRow] = await pool.query("SELECT * FROM device WHERE device_id = ?", [deviceId]);
    emitSensorLog({
      log_id: result.insertId,
      device_id: deviceId,
      sound_type: finalSoundType,
      confidence: finalConfidence,
      timestamp: formattedTs,
    });
    emitDeviceUpdate(deviceRow[0]);

    res.status(201).json({ message: "Telemetry recorded.", log_id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to record telemetry." });
  }
});

/**
 * POST /api/devices/:id/heartbeat
 * No body required — just marks the device online with an updated last_seen.
 * Call this periodically (e.g. every 10s) even when there's nothing to report,
 * so the dashboard can tell the device is still alive.
 */
router.post("/:id/heartbeat", express.json(), async (req, res) => {
  try {
    const key = req.header("X-Device-Key");
    if (process.env.DEVICE_API_KEY && key !== process.env.DEVICE_API_KEY) {
      return res.status(403).json({ error: "Invalid device key." });
    }

    const deviceId = req.params.id;
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    const [result] = await pool.query(
      "UPDATE device SET status = 'online', last_seen = ? WHERE device_id = ?",
      [now, deviceId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Unknown device. Register it first via the dashboard." });
    }

    const [deviceRow] = await pool.query("SELECT * FROM device WHERE device_id = ?", [deviceId]);
    emitDeviceUpdate(deviceRow[0]);

    res.json({ message: "Heartbeat received." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to record heartbeat." });
  }
});

/**
 * GET /api/device-ingest/:id/pending-snap
 *
 * Called by the ESP32-CAM every ~1 s.
 * Returns an alert only when:
 *   - snap_ready = 1  (audio ESP32 confirmed servo has stopped)
 *   - image_path IS NULL  (no image taken yet)
 * Immediately clears snap_ready so the CAM won't snap it twice.
 */
router.get("/:id/pending-snap", async (req, res) => {
  try {
    const key = req.header("X-Device-Key");
    if (process.env.DEVICE_API_KEY && key !== process.env.DEVICE_API_KEY) {
      return res.status(403).json({ error: "Invalid device key." });
    }

    const deviceId = req.params.id;

    const [rows] = await pool.query(
      `SELECT alert_id, detection_type, confidence_score, timestamp
       FROM alerts
       WHERE device_id = ?
         AND image_path IS NULL
         AND created_at >= (NOW() - INTERVAL 10 SECOND)
       ORDER BY created_at DESC
       LIMIT 1`,
      [deviceId]
    );

    if (!rows[0]) return res.status(204).send();

    // Immediately claim this alert so no other CAM poll can grab it
    // while the image is being captured and uploaded.
    // image_path = 'pending' means: claimed, upload in progress.
    await pool.query(
      "UPDATE alerts SET image_path = 'pending' WHERE alert_id = ? AND image_path IS NULL",
      [rows[0].alert_id]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to check pending snap." });
  }
});

/**
 * POST /api/device-ingest/:id/alert/:alertId/image
 * multipart/form-data:  image (JPEG file)
 *
 * Called by the ESP32-CAM to attach a captured image to an existing alert.
 * Updates the alerts row with the image path, re-emits alert:new so the
 * dashboard refreshes with the image, and re-sends the Telegram notification
 * this time with the photo attached.
 */
router.post("/:id/alert/:alertId/image",
  upload.single("image"),
  async (req, res) => {
    try {
      const key = req.header("X-Device-Key");
      if (process.env.DEVICE_API_KEY && key !== process.env.DEVICE_API_KEY) {
        return res.status(403).json({ error: "Invalid device key." });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No image file received." });
      }

      const { id: deviceId, alertId } = req.params;
      const imagePath = `/uploads/${req.file.filename}`;

      const [result] = await pool.query(
        "UPDATE alerts SET image_path = ? WHERE alert_id = ? AND device_id = ? AND image_path IN (NULL, 'pending')",
        [imagePath, alertId, deviceId]
      );

      if (result.affectedRows === 0) {
        // Already has a real image or wrong alert_id — delete the uploaded file
        fs.unlink(req.file.path, () => {});
        return res.status(409).json({ error: "Alert not found or image already attached." });
      }

      // Fetch the updated alert and re-emit so the dashboard shows the image
      const [alertRows] = await pool.query(
        `SELECT a.*, d.device_name, d.location
         FROM alerts a JOIN device d ON d.device_id = a.device_id
         WHERE a.alert_id = ?`,
        [alertId]
      );
      const alert = alertRows[0];

      emitNewAlert(alert);  // dashboard Alerts page refreshes with the image

      // Re-send Telegram with the actual photo this time
      const telegramMessage = `
📸 Snapshot captured for Alert #${alertId}

📍 Device : ${alert.device_name}
📌 Location : ${alert.location}
🎤 Detection : ${alert.detection_type}
📊 Confidence : ${Number(alert.confidence_score)}%
🕒 Time : ${alert.timestamp}
`;
      await sendAlert(telegramMessage, imagePath);

      res.json({ message: "Image attached.", image_path: imagePath });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to attach image." });
    }
  }
);

module.exports = router;
