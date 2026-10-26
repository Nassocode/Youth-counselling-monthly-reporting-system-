const { Router } = require('express');
const { body, param, query, validationResult } = require('express-validator');
const db = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { REPORT_TEXT_LIMITS, isCompleteReport } = require('../reports/validation');
const { validateTransition } = require('../reports/workflow');

const router = Router();
router.use(requireAuth);

const textColumns = {
  title: 'title',
  mainObjectives: 'main_objectives',
  summary: 'summary',
  activities: 'activities',
  achievements: 'achievements',
  challenges: 'challenges',
  solutions: 'solutions',
  referrals: 'referrals',
  recommendations: 'recommendations',
  nextMonthPlan: 'next_month_plan',
  remarks: 'remarks'
};
const numericColumns = {
  beneficiariesReached: 'beneficiaries_reached',
  sessionsHeld: 'sessions_held',
  individualSessions: 'individual_sessions',
  groupSessions: 'group_sessions',
  outreachActivities: 'outreach_activities'
};

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

function reportValidators() {
  return [
    ...Object.entries(REPORT_TEXT_LIMITS).map(([field, maxLength]) => body(field)
      .optional({ values: 'undefined' })
      .isString()
      .trim()
      .isLength({ max: maxLength })),
    ...Object.keys(numericColumns).map((field) => body(field)
      .optional({ values: 'undefined' })
      .isInt({ min: 0, max: 10000000 })
      .toInt())
  ];
}

function completePayload(payload) {
  const normalized = {};
  Object.keys(textColumns).forEach((field) => {
    normalized[field] = typeof payload[field] === 'string' ? payload[field].trim() : '';
  });
  Object.keys(numericColumns).forEach((field) => {
    normalized[field] = Number(payload[field] || 0);
  });
  return normalized;
}

function valuesFor(payload) {
  return [
    ...Object.keys(textColumns).map((field) => payload[field]),
    ...Object.keys(numericColumns).map((field) => payload[field])
  ];
}

async function inTransaction(work) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function audit(connection, req, action, entityId, details = {}) {
  await connection.execute(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details, ip_address)
     VALUES (?, ?, 'report', ?, ?, ?)`,
    [req.user.id, action, String(entityId), JSON.stringify(details), req.ip]
  );
}

async function notifyUsers(connection, userIds, eventKey, type, reportId, periodId) {
  for (const userId of new Set(userIds)) {
    await connection.execute(
      `INSERT IGNORE INTO notifications
        (user_id, report_id, reporting_period_id, event_key, notification_type, message_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, reportId || null, periodId || null, eventKey, type, type]
    );
  }
}

async function roleUserIds(connection, role, departmentId) {
  const [rows] = await connection.execute(
    `SELECT DISTINCT u.id FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN department_members dm ON dm.user_id = u.id
     WHERE u.is_active = 1 AND r.name = ?
       AND (? IS NULL OR dm.department_id = ?)`,
    [role, departmentId || null, departmentId || null]
  );
  return rows.map((row) => row.id);
}

async function reportAccess(req, reportId, connection = db, lock = false) {
  const role = req.user.role;
  let condition = '1 = 1';
  let params = [reportId];
  if (role === 'chairperson') {
    condition = "r.status IN ('chair_review','approved')";
  } else if (role === 'vice_chairperson') {
    condition = "r.status = 'vice_review'";
  } else if (role === 'secretary') {
    condition = "r.status = 'secretary_review'";
  } else if (role === 'department_head') {
    condition = `r.department_id IN (
      SELECT dm.department_id FROM department_members dm
       WHERE dm.user_id = ? AND dm.membership_role = 'head'
    ) AND r.status IN ('submitted','returned','secretary_review','vice_review','chair_review','approved','rejected')`;
    params = [reportId, req.user.id];
  } else if (role === 'member') {
    condition = `(r.submitted_by = ? OR (
      r.status = 'approved' AND r.department_id IN (
        SELECT dm.department_id FROM department_members dm WHERE dm.user_id = ?
      )
    ))`;
    params = [reportId, req.user.id, req.user.id];
  }
  const [rows] = await connection.execute(
    `SELECT r.*, rp.year AS period_year, rp.month AS period_month,
            rp.is_closed, rp.opens_at, rp.closes_at,
            d.name AS department_name, author.display_name AS author_name,
            head.display_name AS department_head_name,
            (rp.is_closed = 0 AND CURRENT_DATE BETWEEN rp.opens_at AND rp.closes_at) AS is_open
       FROM reports r
       JOIN reporting_periods rp ON rp.id = r.reporting_period_id
       JOIN departments d ON d.id = r.department_id
       JOIN users author ON author.id = r.submitted_by
       LEFT JOIN department_members dmhead
         ON dmhead.department_id = r.department_id AND dmhead.membership_role = 'head'
       LEFT JOIN users head ON head.id = dmhead.user_id
      WHERE r.id = ? AND ${condition}
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    params
  );
  return rows[0] || null;
}

function jsonReport(row) {
  const report = {
    id: row.id,
    reportingPeriodId: row.reporting_period_id,
    periodYear: row.period_year,
    periodMonth: row.period_month,
    departmentId: row.department_id,
    departmentName: row.department_name,
    submittedBy: row.author_name,
    authorId: row.submitted_by,
    departmentHead: row.department_head_name,
    status: row.status,
    version: row.report_version,
    submittedAt: row.submitted_at,
    reviewComment: row.review_comment
  };
  Object.entries(textColumns).forEach(([field, column]) => { report[field] = row[column]; });
  Object.entries(numericColumns).forEach(([field, column]) => { report[field] = row[column]; });
  return report;
}

async function canReviewDepartment(req, report, connection = db) {
  if (req.user.role !== 'department_head') return false;
  const [rows] = await connection.execute(
    `SELECT 1 FROM department_members
      WHERE department_id = ? AND user_id = ? AND membership_role = 'head'`,
    [report.department_id, req.user.id]
  );
  return rows.length > 0;
}

router.get('/',
  query('status').optional().isIn([
    'draft', 'submitted', 'returned', 'secretary_review', 'vice_review',
    'chair_review', 'approved', 'rejected', 'overdue'
  ]),
  query('periodId').optional().isInt({ min: 1 }).toInt(),
  query('departmentId').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
  validationError,
  async (req, res, next) => {
    try {
      const role = req.user.role;
      const access = [];
      const params = [];
      if (role === 'chairperson') access.push("r.status IN ('chair_review','approved')");
      else if (role === 'vice_chairperson') access.push("r.status = 'vice_review'");
      else if (role === 'secretary') access.push("r.status = 'secretary_review'");
      else if (role === 'department_head') {
        access.push(`r.department_id IN (
          SELECT department_id FROM department_members
           WHERE user_id = ? AND membership_role = 'head'
        )`);
        params.push(req.user.id);
      } else if (role === 'member') {
        access.push(`(r.submitted_by = ? OR (
          r.status = 'approved' AND r.department_id IN (
            SELECT department_id FROM department_members WHERE user_id = ?
          )
        ))`);
        params.push(req.user.id, req.user.id);
      }
      if (req.query.status) {
        access.push('r.status = ?');
        params.push(req.query.status);
      }
      if (req.query.periodId) {
        access.push('r.reporting_period_id = ?');
        params.push(req.query.periodId);
      }
      if (req.query.departmentId) {
        access.push('r.department_id = ?');
        params.push(req.query.departmentId);
      }
      const where = access.length ? `WHERE ${access.join(' AND ')}` : '';
      const limit = req.query.limit || 100;
      const offset = req.query.offset || 0;
      const [reportRows] = await db.execute(
        `SELECT r.*, rp.year AS period_year, rp.month AS period_month,
                d.name AS department_name, author.display_name AS author_name,
                head.display_name AS department_head_name
           FROM reports r
           JOIN reporting_periods rp ON rp.id = r.reporting_period_id
           JOIN departments d ON d.id = r.department_id
           JOIN users author ON author.id = r.submitted_by
           LEFT JOIN department_members dmhead
             ON dmhead.department_id = r.department_id AND dmhead.membership_role = 'head'
           LEFT JOIN users head ON head.id = dmhead.user_id
          ${where}
          ORDER BY rp.year DESC, rp.month DESC, d.name, author.display_name
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const [periodRows] = await db.execute(
        `SELECT id, year, month,
                DATE_FORMAT(opens_at, '%Y-%m-%d') AS opensAt,
                DATE_FORMAT(closes_at, '%Y-%m-%d') AS closesAt,
                is_closed AS isClosed,
                (is_closed = 0 AND CURRENT_DATE BETWEEN opens_at AND closes_at) AS isOpen
           FROM reporting_periods ORDER BY year DESC, month DESC`
      );
      let departments = [];
      if (['department_head', 'member'].includes(role)) {
        const [departmentRows] = await db.execute(
          `SELECT d.id, d.name, dm.membership_role AS membershipRole
             FROM departments d JOIN department_members dm ON dm.department_id = d.id
            WHERE dm.user_id = ? AND d.is_active = 1 ORDER BY d.name`,
          [req.user.id]
        );
        departments = departmentRows;
      }
      res.json({
        reports: reportRows.map(jsonReport),
        periods: periodRows,
        departments,
        pagination: { limit, offset, hasMore: reportRows.length === limit }
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/dashboard', async (req, res, next) => {
  try {
    const [users] = await db.execute('SELECT COUNT(*) AS count FROM users WHERE is_active = 1');
    const [departments] = await db.execute('SELECT COUNT(*) AS count FROM departments WHERE is_active = 1');
    const [currentPeriod] = await db.execute(
      `SELECT id FROM reporting_periods WHERE is_closed = 0
        AND CURRENT_DATE BETWEEN opens_at AND closes_at ORDER BY year DESC, month DESC LIMIT 1`
    );
    const periodId = currentPeriod[0]?.id || null;
    const [counts] = await db.execute(
      `SELECT COUNT(*) AS total,
              SUM(status <> 'draft') AS submitted,
              SUM(status = 'approved') AS approved,
              SUM(status IN ('submitted','secretary_review','vice_review','chair_review')) AS pending,
              SUM(status = 'returned') AS returned
         FROM reports WHERE (? IS NULL OR reporting_period_id = ?)`,
      [periodId, periodId]
    );
    let expected = 0;
    if (periodId) {
      const [expectedRows] = await db.execute(
        `SELECT COUNT(*) AS count
           FROM department_members dm
           JOIN departments d ON d.id = dm.department_id AND d.is_active = 1
           JOIN users u ON u.id = dm.user_id AND u.is_active = 1
           JOIN roles r ON r.id = u.role_id AND r.name = 'member'
          WHERE dm.membership_role IN ('member', 'assistant')`
      );
      expected = Number(expectedRows[0].count);
    }
    const [overdue] = await db.execute(
      `SELECT COUNT(*) AS count FROM reports r
       JOIN reporting_periods rp ON rp.id = r.reporting_period_id
       WHERE rp.closes_at < CURRENT_DATE AND r.status NOT IN ('approved','rejected')`
    );
    const [monthly] = await db.execute(
      `SELECT rp.year, rp.month, COUNT(r.id) AS reports,
              COALESCE(SUM(r.status = 'approved'), 0) AS approved
         FROM reporting_periods rp LEFT JOIN reports r ON r.reporting_period_id = rp.id
        GROUP BY rp.id ORDER BY rp.year DESC, rp.month DESC LIMIT 12`
    );
    const c = counts[0];
    res.json({
      activeUsers: Number(users[0].count),
      activeDepartments: Number(departments[0].count),
      reportingPeriodId: periodId,
      expectedReports: expected,
      reportsSubmitted: Number(c.submitted || 0),
      reportsApproved: Number(c.approved || 0),
      reportsPending: Number(c.pending || 0),
      reportsReturned: Number(c.returned || 0),
      reportsOverdue: Number(overdue[0].count || 0),
      submissionRate: expected
        ? Math.min(100, Math.round((Number(c.submitted || 0) / expected) * 100)) : 0,
      approvalRate: Number(c.submitted || 0)
        ? Math.round((Number(c.approved || 0) / Number(c.submitted)) * 100) : 0,
      monthly: monthly.reverse()
    });
  } catch (error) {
    next(error);
  }
});

router.post('/periods',
  requireRole('admin'),
  body('year').isInt({ min: 2000, max: 2100 }).toInt(),
  body('month').isInt({ min: 1, max: 12 }).toInt(),
  body('opensAt').isISO8601({ strict: true, strictSeparator: true }),
  body('closesAt').isISO8601({ strict: true, strictSeparator: true }),
  validationError,
  async (req, res, next) => {
    if (req.body.closesAt < req.body.opensAt) {
      return res.status(400).json({ error: 'validation_failed' });
    }
    try {
      const [result] = await db.execute(
        `INSERT INTO reporting_periods (year, month, opens_at, closes_at, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [req.body.year, req.body.month, req.body.opensAt, req.body.closesAt, req.user.id]
      );
      await db.execute(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'reports.period_created', 'reporting_period', ?, ?, ?)`,
        [req.user.id, String(result.insertId), JSON.stringify({ year: req.body.year, month: req.body.month }), req.ip]
      );
      res.status(201).json({ id: result.insertId });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'reporting_period_already_exists' });
      next(error);
    }
  }
);

router.post('/periods/:id/close',
  requireRole('admin'),
  param('id').isInt({ min: 1 }).toInt(),
  validationError,
  async (req, res, next) => {
    try {
      const result = await inTransaction(async (connection) => {
        const [periods] = await connection.execute(
          'SELECT id, is_closed FROM reporting_periods WHERE id = ? FOR UPDATE',
          [req.params.id]
        );
        if (!periods.length) return { error: 'reporting_period_not_found', status: 404 };
        await connection.execute('UPDATE reporting_periods SET is_closed = 1 WHERE id = ?', [req.params.id]);
        await connection.execute(
          `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, ip_address)
           VALUES (?, 'reports.period_closed', 'reporting_period', ?, ?)`,
          [req.user.id, String(req.params.id), req.ip]
        );
        return { id: periods[0].id };
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.json({ id: result.id, isClosed: true });
    } catch (error) {
      next(error);
    }
  }
);

router.post('/',
  requireRole('member'),
  body('periodId').isInt({ min: 1 }).toInt(),
  body('departmentId').isInt({ min: 1 }).toInt(),
  ...reportValidators(),
  validationError,
  async (req, res, next) => {
    const payload = completePayload(req.body);
    try {
      const result = await inTransaction(async (connection) => {
        const [memberships] = await connection.execute(
          `SELECT d.id FROM departments d JOIN department_members dm ON dm.department_id = d.id
            WHERE d.id = ? AND d.is_active = 1 AND dm.user_id = ?
              AND dm.membership_role IN ('member','assistant')`,
          [req.body.departmentId, req.user.id]
        );
        if (!memberships.length) return { error: 'forbidden', status: 403 };
        const [periods] = await connection.execute(
          `SELECT id FROM reporting_periods WHERE id = ? AND is_closed = 0
            AND CURRENT_DATE BETWEEN opens_at AND closes_at FOR UPDATE`,
          [req.body.periodId]
        );
        if (!periods.length) return { error: 'reporting_period_closed', status: 409 };
        const columns = Object.values(textColumns).concat(Object.values(numericColumns));
        const placeholders = columns.map(() => '?').join(', ');
        const [inserted] = await connection.execute(
          `INSERT INTO reports (reporting_period_id, department_id, submitted_by, status, ${columns.join(', ')})
           VALUES (?, ?, ?, 'draft', ${placeholders})`,
          [req.body.periodId, req.body.departmentId, req.user.id, ...valuesFor(payload)]
        );
        await audit(connection, req, 'reports.draft_saved', inserted.insertId, { version: 1 });
        return { id: inserted.insertId };
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.status(201).json(result);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'report_already_exists' });
      next(error);
    }
  }
);

router.put('/:id',
  requireRole('member'),
  param('id').isInt({ min: 1 }).toInt(),
  ...reportValidators(),
  validationError,
  async (req, res, next) => {
    const payload = completePayload(req.body);
    try {
      const result = await inTransaction(async (connection) => {
        const report = await reportAccess(req, req.params.id, connection, true);
        if (!report || Number(report.submitted_by) !== req.user.id) {
          return { error: 'report_not_editable', status: 404 };
        }
        if (!['draft', 'returned'].includes(report.status)) {
          return { error: 'report_not_editable', status: 409 };
        }
        if (!report.is_open) return { error: 'reporting_period_closed', status: 409 };
        const nextVersion = Number(report.report_version) + 1;
        const revisionColumns = [
          'title', 'main_objectives', 'summary', 'activities', 'achievements', 'challenges',
          'solutions', 'referrals', 'recommendations', 'next_month_plan', 'remarks',
          'beneficiaries_reached', 'sessions_held', 'individual_sessions', 'group_sessions',
          'outreach_activities'
        ];
        await connection.execute(
          `INSERT INTO report_revisions (report_id, version, changed_by, ${revisionColumns.join(', ')}, status)
           VALUES (?, ?, ?, ${revisionColumns.map(() => '?').join(', ')}, ?)`,
          [report.id, report.report_version, req.user.id, ...revisionColumns.map((column) => report[column]), report.status]
        );
        const assignments = [
          ...Object.values(textColumns).map((column) => `${column} = ?`),
          ...Object.values(numericColumns).map((column) => `${column} = ?`),
          'report_version = ?'
        ];
        await connection.execute(
          `UPDATE reports SET ${assignments.join(', ')} WHERE id = ?`,
          [...valuesFor(payload), nextVersion, report.id]
        );
        await audit(connection, req, 'reports.draft_saved', report.id, { version: nextVersion });
        return { id: report.id, version: nextVersion };
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post('/:id/submit',
  requireRole('member'),
  param('id').isInt({ min: 1 }).toInt(),
  validationError,
  async (req, res, next) => {
    try {
      const result = await inTransaction(async (connection) => {
        const report = await reportAccess(req, req.params.id, connection, true);
        if (!report || Number(report.submitted_by) !== req.user.id) {
          return { error: 'report_not_found', status: 404 };
        }
        const check = validateTransition('submit', report.status, req.user.role);
        if (!check.ok) return check;
        if (!report.is_open) return { error: 'reporting_period_closed', status: 409 };
        if (!isCompleteReport({
          ...Object.fromEntries(Object.keys(textColumns).map((field) => [field, report[textColumns[field]]])),
          ...Object.fromEntries(Object.keys(numericColumns).map((field) => [field, Number(report[numericColumns[field]])]))
        })) return { error: 'report_incomplete', status: 422 };
        const [heads] = await connection.execute(
          `SELECT u.id FROM department_members dm JOIN users u ON u.id = dm.user_id
           WHERE dm.department_id = ? AND dm.membership_role = 'head' AND u.is_active = 1`,
          [report.department_id]
        );
        if (!heads.length) return { error: 'department_head_not_assigned', status: 409 };
        await connection.execute(
          `UPDATE reports SET status = 'submitted', submitted_at = NOW(),
            reviewed_by = NULL, reviewed_at = NULL, review_comment = NULL WHERE id = ?`,
          [report.id]
        );
        const [approval] = await connection.execute(
          `INSERT INTO report_approvals (report_id, reviewer_id, stage, decision)
           VALUES (?, ?, 'department', 'submitted')`,
          [report.id, req.user.id]
        );
        await notifyUsers(connection, heads.map((item) => item.id),
          `report:${report.id}:submission:${approval.insertId}`, 'report_submitted', report.id, report.reporting_period_id);
        await audit(connection, req, 'reports.submitted', report.id, { version: report.report_version });
        return { id: report.id, status: 'submitted' };
      });
      if (!result.ok && result.error) return res.status(result.status).json({ error: result.error });
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

async function transitionReport(req, res, next, role, actions) {
  const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() : '';
  const action = req.body.action;
  if (!actions.includes(action)) return res.status(400).json({ error: 'invalid_workflow_action' });
  try {
    const result = await inTransaction(async (connection) => {
      const report = await reportAccess(req, req.params.id, connection, true);
      if (!report) return { error: 'report_not_found', status: 404 };
      if (role === 'department_head' && !(await canReviewDepartment(req, report, connection))) {
        return { error: 'forbidden', status: 403 };
      }
      const transition = validateTransition(action, report.status, req.user.role, comment);
      if (!transition.ok) return transition;
      const { to, stage, decision } = transition.transition;
      await connection.execute(
        `UPDATE reports SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_comment = ?
          WHERE id = ?`,
        [to, req.user.id, comment || null, report.id]
      );
      const [approval] = await connection.execute(
        `INSERT INTO report_approvals (report_id, reviewer_id, stage, decision, comment)
         VALUES (?, ?, ?, ?, ?)`,
        [report.id, req.user.id, stage, decision, comment || null]
      );
      if (comment) {
        await connection.execute(
          'INSERT INTO report_comments (report_id, user_id, comment) VALUES (?, ?, ?)',
          [report.id, req.user.id, comment]
        );
      }
      const eventKey = `report:${report.id}:approval:${approval.insertId}`;
      await notifyUsers(connection, [report.submitted_by], eventKey, `report_${action}`, report.id, report.reporting_period_id);
      const destinationRole = {
        department_forward: 'secretary',
        secretary_forward: 'vice_chairperson',
        vice_forward: 'chairperson'
      }[action];
      if (destinationRole) {
        const recipients = await roleUserIds(connection, destinationRole);
        await notifyUsers(connection, recipients, eventKey, `report_${action}`, report.id, report.reporting_period_id);
      }
      await audit(connection, req, `reports.${action}`, report.id, {
        from: report.status,
        to,
        version: report.report_version
      });
      return { id: report.id, status: to };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

router.post('/:id/department-review',
  requireRole('department_head'),
  param('id').isInt({ min: 1 }).toInt(),
  body('action').isIn(['department_forward', 'department_return']),
  body('comment').optional().isString().trim().isLength({ max: 4000 }),
  validationError,
  (req, res, next) => transitionReport(req, res, next, 'department_head', ['department_forward', 'department_return'])
);

router.post('/:id/secretary-review',
  requireRole('secretary'),
  param('id').isInt({ min: 1 }).toInt(),
  body('action').isIn(['secretary_forward', 'secretary_return']),
  body('comment').optional().isString().trim().isLength({ max: 4000 }),
  validationError,
  (req, res, next) => transitionReport(req, res, next, 'secretary', ['secretary_forward', 'secretary_return'])
);

router.post('/:id/vice-review',
  requireRole('vice_chairperson'),
  param('id').isInt({ min: 1 }).toInt(),
  body('action').isIn(['vice_forward', 'vice_return', 'vice_reject']),
  body('comment').optional().isString().trim().isLength({ max: 4000 }),
  validationError,
  (req, res, next) => transitionReport(req, res, next, 'vice_chairperson', ['vice_forward', 'vice_return', 'vice_reject'])
);

router.post('/:id/chair-review',
  requireRole('chairperson'),
  param('id').isInt({ min: 1 }).toInt(),
  body('action').isIn(['chair_approve', 'chair_return', 'chair_reject']),
  body('comment').optional().isString().trim().isLength({ max: 4000 }),
  validationError,
  (req, res, next) => transitionReport(req, res, next, 'chairperson', ['chair_approve', 'chair_return', 'chair_reject'])
);

router.get('/:id/history',
  requireRole('admin', 'chairperson', 'vice_chairperson', 'secretary', 'department_head', 'member'),
  param('id').isInt({ min: 1 }).toInt(),
  validationError,
  async (req, res, next) => {
    try {
      const report = await reportAccess(req, req.params.id);
      if (!report) return res.status(404).json({ error: 'report_not_found' });
      const [approvals] = await db.execute(
        `SELECT a.id, a.stage, a.decision, a.comment, a.created_at AS createdAt,
                u.display_name AS reviewer
           FROM report_approvals a JOIN users u ON u.id = a.reviewer_id
          WHERE a.report_id = ? ORDER BY a.created_at, a.id`,
        [report.id]
      );
      const [comments] = await db.execute(
        `SELECT c.id, c.comment, c.created_at AS createdAt, u.display_name AS author
           FROM report_comments c JOIN users u ON u.id = c.user_id
          WHERE c.report_id = ? ORDER BY c.created_at, c.id`,
        [report.id]
      );
      const [revisions] = await db.execute(
        `SELECT rv.version, rv.status, rv.created_at AS createdAt, u.display_name AS author
           FROM report_revisions rv JOIN users u ON u.id = rv.changed_by
          WHERE rv.report_id = ? ORDER BY rv.created_at, rv.version`,
        [report.id]
      );
      res.json({ approvals, comments, revisions });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/:id/revisions',
  requireRole('admin', 'department_head', 'member'),
  param('id').isInt({ min: 1 }).toInt(),
  validationError,
  async (req, res, next) => {
    try {
      const report = await reportAccess(req, req.params.id);
      if (!report) return res.status(404).json({ error: 'report_not_found' });
      const [rows] = await db.execute(
        `SELECT version, changed_by AS changedBy, title, main_objectives AS mainObjectives,
                summary, activities, achievements, challenges, solutions, referrals,
                recommendations, next_month_plan AS nextMonthPlan, remarks,
                beneficiaries_reached AS beneficiariesReached, sessions_held AS sessionsHeld,
                individual_sessions AS individualSessions, group_sessions AS groupSessions,
                outreach_activities AS outreachActivities, status, created_at AS createdAt
           FROM report_revisions WHERE report_id = ? ORDER BY version DESC`,
        [report.id]
      );
      res.json({ revisions: rows });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/export.csv',
  requireRole('admin', 'chairperson', 'vice_chairperson', 'secretary', 'department_head'),
  async (req, res, next) => {
    try {
      const role = req.user.role;
      const params = [];
      let restriction = '';
      if (role === 'chairperson') restriction = "WHERE r.status IN ('chair_review','approved')";
      else if (role === 'vice_chairperson') restriction = "WHERE r.status = 'vice_review'";
      else if (role === 'secretary') restriction = "WHERE r.status = 'secretary_review'";
      else if (role === 'department_head') {
        restriction = `WHERE r.department_id IN (
          SELECT department_id FROM department_members WHERE user_id = ? AND membership_role = 'head'
        )`;
        params.push(req.user.id);
      }
      const [rows] = await db.execute(
        `SELECT d.name AS department, rp.year, rp.month, u.display_name AS author, r.title,
                r.status, r.beneficiaries_reached AS beneficiaries, r.sessions_held AS sessions,
                r.summary
           FROM reports r JOIN departments d ON d.id = r.department_id
           JOIN reporting_periods rp ON rp.id = r.reporting_period_id
           JOIN users u ON u.id = r.submitted_by ${restriction}
          ORDER BY rp.year DESC, rp.month DESC, d.name`,
        params
      );
      const fields = ['department', 'year', 'month', 'author', 'title', 'status', 'beneficiaries', 'sessions', 'summary'];
      const csv = [
        fields.join(','),
        ...rows.map((row) => fields.map((field) => {
          let value = String(row[field] ?? '');
          if (/^[\s]*[=+\-@]/.test(value)) value = `'${value}`;
          return `"${value.replace(/"/g, '""')}"`;
        }).join(','))
      ].join('\r\n');
      res.type('text/csv').set('Content-Disposition', 'attachment; filename="monthly-reports.csv"').send(`\uFEFF${csv}`);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
