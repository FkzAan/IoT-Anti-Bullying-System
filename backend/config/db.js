const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "sentry_dashboard",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
});

/**
 * Makes sure the schema exists and a default admin account is present.
 * Safe to call every startup — everything uses IF NOT EXISTS.
 */
async function initDb() {
  const fs = require("fs");
  const path = require("path");

  // Create database if it doesn't exist yet (connect without a default db first)
  const rootConn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  });
  await rootConn.query(
    `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || "sentry_dashboard"}\` CHARACTER SET utf8mb4`
  );
  await rootConn.end();

  const schemaPath = path.join(__dirname, "..", "database", "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const statements = schemaSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length && !s.toUpperCase().startsWith("CREATE DATABASE") && !s.toUpperCase().startsWith("USE "));

  for (const stmt of statements) {
    await pool.query(stmt);
  }

  // Bootstrap a default admin if none exists
  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM admin");
  if (rows[0].count === 0) {
    const username = process.env.DEFAULT_ADMIN_USERNAME || "admin";
    const password = process.env.DEFAULT_ADMIN_PASSWORD || "admin123";
    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO admin (username, password_hash) VALUES (?, ?)", [username, hash]);
    console.log(`[db] Created default admin account "${username}" — change this password after first login.`);
  }

  // Migrations — safe to run every startup (only adds if missing)
  const migrations = [
    // v1.1: snap_ready flag so the CAM only fires after servo has stopped
    `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS snap_ready TINYINT(1) NOT NULL DEFAULT 0`,
  ];
  for (const m of migrations) {
    try {
      await pool.query(m);
    } catch (err) {
      // ALTER TABLE errors are non-fatal (column may already exist on older MySQL)
      if (!err.message.includes("Duplicate column")) {
        console.warn("[db] Migration warning:", err.message);
      }
    }
  }

  console.log("[db] Schema ready.");
}

module.exports = { pool, initDb };
