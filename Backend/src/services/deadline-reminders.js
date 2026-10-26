const db = require('../config/database');

async function sendDeadlineReminders() {
  const [targets] = await db.execute(
    `SELECT DISTINCT rp.id AS periodId, dm.department_id AS departmentId,
            dm.user_id AS userId
       FROM reporting_periods rp
       JOIN department_members dm ON dm.membership_role IN ('member', 'assistant')
       JOIN users u ON u.id = dm.user_id AND u.is_active = 1
       JOIN roles r ON r.id = u.role_id AND r.name = 'member'
      WHERE rp.is_closed = 0
        AND rp.closes_at BETWEEN CURRENT_DATE AND DATE_ADD(CURRENT_DATE, INTERVAL 3 DAY)
        AND NOT EXISTS (
          SELECT 1 FROM reports report
           WHERE report.reporting_period_id = rp.id
             AND report.department_id = dm.department_id
             AND report.submitted_by = dm.user_id
             AND report.status NOT IN ('draft', 'returned')
        )`
  );
  for (const target of targets) {
    await db.execute(
      `INSERT IGNORE INTO notifications
        (user_id, reporting_period_id, event_key, notification_type, message_key)
       VALUES (?, ?, ?, 'deadline_reminder', 'deadline_reminder')`,
      [
        target.userId,
        target.periodId,
        `deadline:${target.periodId}:${target.departmentId}:${target.userId}`
      ]
    );
  }
}

function startDeadlineReminderScheduler(intervalMs = 6 * 60 * 60 * 1000) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await sendDeadlineReminders();
    } catch (error) {
      console.error('Deadline reminder job failed:', error.code || error.message);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { sendDeadlineReminders, startDeadlineReminderScheduler };
