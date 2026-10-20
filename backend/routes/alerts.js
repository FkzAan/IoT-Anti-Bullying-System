const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { emitAlertStatusChange } = require("../sockets/socket");

const router = express.Router();
router.use(requireAuth);

// GET /api/alerts?status=new&device_id=...&from=2026-07-01&to=2026-07-11
router.get("/", async (req, res) => {
  const { status, device_id, from, to } = req.query;
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push("a.status = ?");
    params.push(status);
  }
  if (device_id) {
    conditions.push("a.device_id = ?");
    params.push(device_id);
  }
  if (from) {
    conditions.push("a.timestamp >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("a.timestamp <= ?");
    params.push(to);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const [rows] = await pool.query(
      `SELECT a.*, d.device_name, d.location
       FROM alerts a
       JOIN device d ON d.device_id = a.device_id
       ${whereClause}
       ORDER BY a.timestamp DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load alerts." });
  }
});

// GET /api/alerts/:id — full detail including status history
router.get("/:id", async (req, res) => {
  try {
    const [alertRows] = await pool.query(
      `SELECT a.*, d.device_name, d.location
       FROM alerts a JOIN device d ON d.device_id = a.device_id
       WHERE a.alert_id = ?`,
      [req.params.id]
    );
    if (!alertRows[0]) return res.status(404).json({ error: "Alert not found." });

    const [history] = await pool.query(
      "SELECT * FROM alert_status_log WHERE alert_id = ? ORDER BY changed_at ASC",
      [req.params.id]
    );

    res.json({ ...alertRows[0], history });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load alert." });
  }
});

// PATCH /api/alerts/:id/status  { status: "investigating" }
router.patch("/:id/status", async (req, res) => {
  const { status } = req.body;
  const validStatuses = ["new", "investigating", "resolved"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(", ")}` });
  }

  try {
    const [current] = await pool.query("SELECT status FROM alerts WHERE alert_id = ?", [req.params.id]);
    if (!current[0]) return res.status(404).json({ error: "Alert not found." });

    await pool.query("UPDATE alerts SET status = ? WHERE alert_id = ?", [status, req.params.id]);
    await pool.query(
      "INSERT INTO alert_status_log (alert_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)",
      [req.params.id, current[0].status, status, req.session.username]
    );

    const [updated] = await pool.query(
      `SELECT a.*, d.device_name, d.location FROM alerts a JOIN device d ON d.device_id = a.device_id WHERE a.alert_id = ?`,
      [req.params.id]
    );
    emitAlertStatusChange(updated[0]);
    res.json(updated[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update alert status." });
  }
});

module.exports = router;
