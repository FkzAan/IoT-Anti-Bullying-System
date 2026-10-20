let io = null;

/**
 * Called once from server.js with the Socket.IO server instance.
 */
function initSocket(socketIoInstance) {
  io = socketIoInstance;

  io.on("connection", (socket) => {
    console.log(`[socket] Dashboard client connected: ${socket.id}`);
    socket.on("disconnect", () => {
      console.log(`[socket] Dashboard client disconnected: ${socket.id}`);
    });
  });
}

/** Emit a device status change (online/offline, last_seen) */
function emitDeviceUpdate(device) {
  if (io) io.emit("device:update", device);
}

/** Emit a new sensor classification result (used for the Live Monitoring page) */
function emitSensorLog(log) {
  if (io) io.emit("sensor:log", log);
}

/** Emit a brand-new alert (distress sound confirmed + image stored) */
function emitNewAlert(alert) {
  if (io) io.emit("alert:new", alert);
}

/** Emit an alert status change (New -> Investigating -> Resolved) */
function emitAlertStatusChange(alert) {
  if (io) io.emit("alert:status", alert);
}

module.exports = {
  initSocket,
  emitDeviceUpdate,
  emitSensorLog,
  emitNewAlert,
  emitAlertStatusChange,
};
