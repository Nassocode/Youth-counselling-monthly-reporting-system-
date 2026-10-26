const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { body, param, validationResult } = require('express-validator');
const db = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();
const roles = ['admin', 'chairperson', 'vice_chairperson', 'secretary', 'department_head', 'member'];

router.use(requireAuth, requireRole('admin'));

function validationError(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'validation_failed',
      details: errors.array().map(({ path }) => ({ field: path }))
    });
  }
  next();
}

async function audit(req, action, entityType, entityId, details = {}, connection = db) {
  await connection.execute(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user.id, action, entityType, String(entityId), JSON.stringify(details), req.ip]
  );
}

router.get('/', async (req, res, next) => {
  try {
    const [users] = await db.execute(
      `SELECT u.id, u.email, u.display_name AS displayName, u.is_active AS isActive,
              u.preferred_language AS language, r.name AS role
         FROM users u JOIN roles r ON r.id = u.role_id
        ORDER BY u.display_name`
    );
    const [departmentRows] = await db.execute(
      `SELECT d.id, d.name, d.description, d.is_active AS isActive,
              dm.user_id AS userId, u.display_name AS userName,
              dm.membership_role AS membershipRole
         FROM departments d
         LEFT JOIN department_members dm ON dm.department_id = d.id
         LEFT JOIN users u ON u.id = dm.user_id
        ORDER BY d.name, u.display_name`
    );
    const departmentsById = new Map();
    departmentRows.forEach((row) => {
      if (!departmentsById.has(row.id)) {
        departmentsById.set(row.id, {
          id: row.id,
          name: row.name,
          description: row.description,
          isActive: row.isActive,
          members: []
        });
      }
      if (row.userId) {
        departmentsById.get(row.id).members.push({
          userId: row.userId,
          userName: row.userName,
          membershipRole: row.membershipRole
        });
      }
    });
    const departments = [...departmentsById.values()];
    res.json({ users, departments, roles });
  } catch (error) {
    next(error);
  }
});

router.post('/users',
  body('displayName').isString().trim().isLength({ min: 1, max: 150 }),
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 8, max: 200 }),
  body('role').isIn(roles),
  validationError,
  async (req, res, next) => {
    try {
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      const [result] = await db.execute(
        `INSERT INTO users (role_id, email, password_hash, display_name)
         SELECT id, ?, ?, ? FROM roles WHERE name = ?`,
        [req.body.email, passwordHash, req.body.displayName, req.body.role]
      );
      if (!result.affectedRows) return res.status(400).json({ error: 'invalid_role' });
      await audit(req, 'users.created', 'user', result.insertId, { role: req.body.role });
      res.status(201).json({ id: result.insertId });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'email_already_registered' });
      next(error);
    }
  }
);

router.patch('/users/:id',
  param('id').isInt({ min: 1 }).toInt(),
  body('isActive').optional().isBoolean().toBoolean(),
  body('role').optional().isIn(roles),
  validationError,
  async (req, res, next) => {
    if (req.body.isActive === undefined && req.body.role === undefined) {
      return res.status(400).json({ error: 'validation_failed' });
    }
    if (Number(req.params.id) === req.user.id && req.body.isActive === false) {
      return res.status(409).json({ error: 'cannot_deactivate_own_account' });
    }
    let connection;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      const [activeAdmins] = await connection.execute(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
          WHERE r.name = 'admin' AND u.is_active = 1 FOR UPDATE`
      );
      const [users] = await connection.execute(
        `SELECT u.id, u.is_active AS isActive, r.name AS role
           FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.id = ? FOR UPDATE`,
        [req.params.id]
      );
      if (!users.length) {
        await connection.rollback();
        return res.status(404).json({ error: 'user_not_found' });
      }
      const updatedRole = req.body.role || users[0].role;
      const removesActiveAdmin = users[0].isActive && users[0].role === 'admin'
        && (updatedRole !== 'admin' || req.body.isActive === false);
      if (removesActiveAdmin && activeAdmins.length <= 1) {
        await connection.rollback();
        return res.status(409).json({
          error: updatedRole !== 'admin' ? 'cannot_remove_last_admin' : 'cannot_deactivate_last_admin'
        });
      }
      if (req.body.role !== undefined) {
        await connection.execute(
          'UPDATE users SET role_id = (SELECT id FROM roles WHERE name = ?) WHERE id = ?',
          [req.body.role, req.params.id]
        );
      }
      if (req.body.isActive !== undefined) {
        await connection.execute('UPDATE users SET is_active = ? WHERE id = ?', [req.body.isActive, req.params.id]);
      }
      await audit(req, 'users.updated', 'user', req.params.id, req.body, connection);
      await connection.commit();
      res.json({ id: Number(req.params.id) });
    } catch (error) {
      if (connection) await connection.rollback();
      next(error);
    } finally {
      connection?.release();
    }
  }
);

router.post('/departments',
  body('name').isString().trim().isLength({ min: 1, max: 150 }),
  body('description').optional({ values: 'null' }).isString().trim().isLength({ max: 5000 }),
  validationError,
  async (req, res, next) => {
    try {
      const [result] = await db.execute(
        'INSERT INTO departments (name, description) VALUES (?, ?)',
        [req.body.name, req.body.description || null]
      );
      await audit(req, 'departments.created', 'department', result.insertId);
      res.status(201).json({ id: result.insertId });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'department_already_exists' });
      next(error);
    }
  }
);

router.patch('/departments/:id',
  param('id').isInt({ min: 1 }).toInt(),
  body('isActive').isBoolean().toBoolean(),
  validationError,
  async (req, res, next) => {
    try {
      const [departments] = await db.execute(
        'SELECT id FROM departments WHERE id = ?',
        [req.params.id]
      );
      if (!departments.length) return res.status(404).json({ error: 'department_not_found' });
      await db.execute(
        'UPDATE departments SET is_active = ? WHERE id = ?',
        [req.body.isActive, req.params.id]
      );
      await audit(req, 'departments.updated', 'department', req.params.id, { isActive: req.body.isActive });
      res.json({ id: Number(req.params.id), isActive: req.body.isActive });
    } catch (error) {
      next(error);
    }
  }
);

router.put('/departments/:id/members/:userId',
  param('id').isInt({ min: 1 }).toInt(),
  param('userId').isInt({ min: 1 }).toInt(),
  body('membershipRole').isIn(['head', 'assistant', 'member']),
  validationError,
  async (req, res, next) => {
    try {
      const [matches] = await db.execute(
        `SELECT d.id, r.name AS role FROM departments d
         JOIN users u ON u.id = ?
         JOIN roles r ON r.id = u.role_id
         WHERE d.id = ? AND u.is_active = 1`,
        [req.params.userId, req.params.id]
      );
      if (!matches.length) return res.status(404).json({ error: 'department_or_user_not_found' });
      if ((req.body.membershipRole === 'head') !== (matches[0].role === 'department_head')) {
        return res.status(400).json({ error: 'invalid_department_assignment' });
      }
      await db.execute(
        `INSERT INTO department_members (department_id, user_id, membership_role)
         SELECT d.id, u.id, ? FROM departments d JOIN users u ON u.id = ?
          WHERE d.id = ?
         ON DUPLICATE KEY UPDATE membership_role = VALUES(membership_role)`,
        [req.body.membershipRole, req.params.userId, req.params.id]
      );
      await audit(req, 'departments.member_assigned', 'department', req.params.id, {
        userId: Number(req.params.userId),
        membershipRole: req.body.membershipRole
      });
      res.json({ departmentId: Number(req.params.id), userId: Number(req.params.userId) });
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/departments/:id/members/:userId',
  param('id').isInt({ min: 1 }).toInt(),
  param('userId').isInt({ min: 1 }).toInt(),
  validationError,
  async (req, res, next) => {
    try {
      await db.execute(
        'DELETE FROM department_members WHERE department_id = ? AND user_id = ?',
        [req.params.id, req.params.userId]
      );
      await audit(req, 'departments.member_removed', 'department', req.params.id, {
        userId: Number(req.params.userId)
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
