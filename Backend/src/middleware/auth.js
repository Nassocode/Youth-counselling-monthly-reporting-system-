const jwt = require('jsonwebtoken');
const db = require('../config/database');

function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: 'authentication_required' });

  let claims;
  try {
    claims = jwt.verify(token, process.env.SESSION_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'invalid_session' });
  }

  db.execute(
    `SELECT u.id, u.email, u.display_name, u.preferred_language, u.role_id,
            r.name AS role, ls.id AS session_id
       FROM login_sessions ls
       JOIN users u ON u.id = ls.user_id
       JOIN roles r ON r.id = u.role_id
      WHERE ls.id = ? AND ls.revoked_at IS NULL AND ls.expires_at > NOW()
        AND u.is_active = 1`,
    [claims.sid]
  ).then(async ([rows]) => {
    if (!rows.length || rows[0].id !== claims.sub) {
      return res.status(401).json({ error: 'invalid_session' });
    }
    await db.execute('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [rows[0].id]);
    req.user = rows[0];
    next();
  }).catch(next);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
