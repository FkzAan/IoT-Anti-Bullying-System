/**
 * Protects API routes that require a logged-in admin.
 * Relies on express-session — req.session.adminId is set on successful login.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  return res.status(401).json({ error: "Not authenticated. Please log in." });
}

module.exports = { requireAuth };
