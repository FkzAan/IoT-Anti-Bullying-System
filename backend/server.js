require("dotenv").config();
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const { initDb } = require("./config/db");
const { initSocket } = require("./sockets/socket");

const authRoutes = require("./routes/auth");
const deviceRoutes = require("./routes/devices");
const alertRoutes = require("./routes/alerts");
const analyticsRoutes = require("./routes/analytics");
const deviceIngestRoutes = require("./routes/deviceIngest");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
  })
);

// Uploaded incident images are served statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// --- API routes ---
app.use("/api/auth", authRoutes);

app.use("/api/devices", deviceRoutes);          // Dashboard (login required)

app.use("/api/device-ingest", deviceIngestRoutes); // ESP32 (Device API Key)

app.use("/api/alerts", alertRoutes);
app.use("/api/analytics", analyticsRoutes);

// --- Frontend (static files) ---
const frontendPath = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendPath));
app.get("/", (req, res) => res.sendFile(path.join(frontendPath, "login.html")));

// Fallback 404 for unknown API routes
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

initSocket(io);

async function start() {
  try {
    await initDb();
    server.listen(PORT, () => {
      console.log(`[server] IoT Sentry Dashboard backend running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("[server] Failed to start:", err);
    process.exit(1);
  }
}

start();
