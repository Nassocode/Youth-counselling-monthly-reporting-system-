const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = Router();
const SESSION_MS = 12 * 60 * 60 * 1000;
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge: SESSION_MS
};

function validationError(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map(({ path }) => ({ field: path }));
    return res.status(400).json({ error: 'validation_failed', details });
  }
  next();
}

router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 1, max: 200 }),
  validationError,
  async (req, res, next) => {
    let connection;
    try {
      const [users] = await db.execute(
        `SELECT u.id, u.email, u.password_hash, u.display_name, u.preferred_language,
                u.role_id, r.name AS role
           FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.email = ? AND u.is_active = 1 LIMIT 1`,
        [req.body.email]
      );
      const user = users[0];
      const passwordMatches = await bcrypt.compare(req.body.password, user?.password_hash || '$2b$12$C6UzMDM.H6dfI/f/IKcEe.');
      if (!user || !passwordMatches) return res.status(401).json({ error: 'invalid_credentials' });

      const sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_MS);
      connection = await db.getConnection();
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO login_sessions (id, user_id, expires_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?)`,
        [sessionId, user.id, expiresAt, req.ip, req.get('user-agent')?.slice(0, 500) || null]
      );
      await connection.execute('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [user.id]);
      await connection.execute(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, ip_address)
         VALUES (?, 'auth.login', 'user', ?, ?)`,
        [user.id, String(user.id), req.ip]
      );
      await connection.commit();
      const token = jwt.sign({ sub: user.id, sid: sessionId }, process.env.SESSION_SECRET, {
        algorithm: 'HS256', expiresIn: '12h'
      });
      res.cookie('session', token, cookieOptions);
      res.json({ user: publicUser(user) });
    } catch (error) {
      if (connection) await connection.rollback();
      next(error);
    } finally {
      connection?.release();
    }
  }
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.patch('/password',
  requireAuth,
  body('currentPassword').isString().isLength({ min: 1, max: 200 }),
  body('newPassword').isString().isLength({ min: 8, max: 200 }),
  validationError,
  async (req, res, next) => {
    let connection;
    try {
      const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
      connection = await db.getConnection();
      await connection.beginTransaction();
      const [sessions] = await connection.execute(
        `SELECT id FROM login_sessions
          WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
          FOR UPDATE`,
        [req.user.session_id, req.user.id]
      );
      if (!sessions.length) {
        await connection.rollback();
        return res.status(401).json({ error: 'invalid_session' });
      }
      const [users] = await connection.execute(
        'SELECT password_hash FROM users WHERE id = ? AND is_active = 1 FOR UPDATE',
        [req.user.id]
      );
      if (!users.length) {
        await connection.rollback();
        return res.status(401).json({ error: 'invalid_session' });
      }
      if (!(await bcrypt.compare(req.body.currentPassword, users[0].password_hash))) {
        await connection.rollback();
        return res.status(400).json({ error: 'current_password_incorrect' });
      }
      if (await bcrypt.compare(req.body.newPassword, users[0].password_hash)) {
        await connection.rollback();
        return res.status(400).json({ error: 'password_must_be_different' });
      }
      await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);
      await connection.execute(
        'UPDATE login_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
        [req.user.id]
      );
      await connection.execute(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, ip_address)
         VALUES (?, 'auth.password_changed', 'user', ?, ?)`,
        [req.user.id, String(req.user.id), req.ip]
      );
      await connection.commit();
      res.clearCookie('session', { ...cookieOptions, maxAge: undefined });
      res.status(204).end();
    } catch (error) {
      if (connection) await connection.rollback();
      next(error);
    } finally {
      connection?.release();
    }
  }
);

router.patch('/language',
  requireAuth,
  body('language').isIn(['sw', 'en']),
  validationError,
  async (req, res, next) => {
    try {
      await db.execute('UPDATE users SET preferred_language = ? WHERE id = ?', [req.body.language, req.user.id]);
      res.json({ language: req.body.language });
    } catch (error) {
      next(error);
    }
  }
);

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await db.execute('UPDATE login_sessions SET revoked_at = NOW() WHERE id = ?', [req.user.session_id]);
    await db.execute(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, ip_address)
       VALUES (?, 'auth.logout', 'user', ?, ?)`,
      [req.user.id, String(req.user.id), req.ip]
    );
    res.clearCookie('session', { ...cookieOptions, maxAge: undefined });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    language: user.preferred_language,
    role: user.role
  };
}

module.exports = router;
