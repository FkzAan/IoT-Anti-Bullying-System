const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/devices — list all registered devices
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM device ORDER BY device_name ASC");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load devices." });
  }
});

// GET /api/devices/:id — single device detail
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM device WHERE device_id = ?", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Device not found." });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load device." });
  }
});

// POST /api/devices — register a new ESP32 device
router.post("/", async (req, res) => {
  const { device_id, device_name, location } = req.body;
  if (!device_id || !device_name) {
    return res.status(400).json({ error: "device_id and device_name are required." });
  }
  try {
    await pool.query(
      "INSERT INTO device (device_id, device_name, location, status) VALUES (?, ?, ?, 'offline')",
      [device_id, device_name, location || null]
    );
    const [rows] = await pool.query("SELECT * FROM device WHERE device_id = ?", [device_id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A device with this ID already exists." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to register device." });
  }
});

// PUT /api/devices/:id — update device name/location
router.put("/:id", async (req, res) => {
  const { device_name, location } = req.body;
  try {
    await pool.query(
      "UPDATE device SET device_name = COALESCE(?, device_name), location = COALESCE(?, location) WHERE device_id = ?",
      [device_name || null, location || null, req.params.id]
    );
    const [rows] = await pool.query("SELECT * FROM device WHERE device_id = ?", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Device not found." });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update device." });
  }
});

// DELETE /api/devices/:id
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM device WHERE device_id = ?", [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Device not found." });
    res.json({ message: "Device deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete device." });
  }
});

module.exports = router;
