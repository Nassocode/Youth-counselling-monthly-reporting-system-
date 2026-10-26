const { Router } = require('express');
const { param, validationResult } = require('express-validator');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, report_id AS reportId, reporting_period_id AS reportingPeriodId,
              notification_type AS type, message_key AS messageKey,
              is_read AS isRead, created_at AS createdAt
         FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 50`,
      [req.user.id]
    );
    res.json({
      notifications: rows,
      unreadCount: rows.filter((item) => !item.isRead).length
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/read',
  param('id').isInt({ min: 1 }).toInt(),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'validation_failed' });
    next();
  },
  async (req, res, next) => {
    try {
      const [result] = await db.execute(
        'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
        [req.params.id, req.user.id]
      );
      if (!result.affectedRows) {
        const [rows] = await db.execute(
          'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
          [req.params.id, req.user.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'notification_not_found' });
      }
      res.json({ id: Number(req.params.id), isRead: true });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
