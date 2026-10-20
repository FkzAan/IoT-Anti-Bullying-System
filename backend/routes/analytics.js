const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/analytics/summary — counts for the Dashboard Home summary cards
router.get("/summary", async (req, res) => {
  try {
    const [[{ total_devices }]] = await pool.query("SELECT COUNT(*) AS total_devices FROM device");
    const [[{ active_devices }]] = await pool.query(
      "SELECT COUNT(*) AS active_devices FROM device WHERE status = 'online'"
    );
    const [[{ total_alerts }]] = await pool.query("SELECT COUNT(*) AS total_alerts FROM alerts");
    const [[{ unresolved_alerts }]] = await pool.query(
      "SELECT COUNT(*) AS unresolved_alerts FROM alerts WHERE status != 'resolved'"
    );

    res.json({ total_devices, active_devices, total_alerts, unresolved_alerts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load summary." });
  }
});

// GET /api/analytics/incidents-per-day?days=14
// Always returns a full series with 0-count days filled in so charts never
// render with gaps or an empty dataset.
router.get("/incidents-per-day", async (req, res) => {
  const days = Number(req.query.days) || 14;
  try {
    const [rows] = await pool.query(
      `SELECT DATE(timestamp) AS day, COUNT(*) AS count
       FROM alerts
       WHERE timestamp >= (CURDATE() - INTERVAL ? DAY)
       GROUP BY DATE(timestamp)
       ORDER BY day ASC`,
      [days]
    );

    // Build a complete day-by-day map so the frontend always gets a full series
    const countByDay = {};
    for (const row of rows) {
      const key = row.day instanceof Date
        ? row.day.toISOString().slice(0, 10)
        : String(row.day).slice(0, 10);
      countByDay[key] = Number(row.count);
    }

    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      series.push({ day: key, count: countByDay[key] || 0 });
    }

    res.json(series);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load incident trend." });
  }
});

// GET /api/analytics/sound-frequency — Normal vs Distress classification counts
router.get("/sound-frequency", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT sound_type, COUNT(*) AS count FROM sensor_logs GROUP BY sound_type`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load sound frequency." });
  }
});

// GET /api/analytics/device-uptime — % of recent heartbeats where device was online
router.get("/device-uptime", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT d.device_id, d.device_name,
        d.status,
        TIMESTAMPDIFF(MINUTE, d.last_seen, NOW()) AS minutes_since_last_seen
      FROM device d
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load device uptime." });
  }
});

module.exports = router;
