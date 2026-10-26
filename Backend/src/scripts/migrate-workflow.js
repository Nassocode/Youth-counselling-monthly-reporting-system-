require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const db = require('../config/database');

const columns = {
  title: "VARCHAR(200) NOT NULL DEFAULT 'Monthly report'",
  main_objectives: 'TEXT NULL',
  solutions: 'TEXT NULL',
  referrals: 'TEXT NULL',
  recommendations: 'TEXT NULL',
  remarks: 'TEXT NULL',
  individual_sessions: 'INT UNSIGNED NOT NULL DEFAULT 0',
  group_sessions: 'INT UNSIGNED NOT NULL DEFAULT 0',
  outreach_activities: 'INT UNSIGNED NOT NULL DEFAULT 0',
  report_version: 'INT UNSIGNED NOT NULL DEFAULT 1'
};

const supportTables = [
  `CREATE TABLE IF NOT EXISTS report_revisions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    report_id BIGINT UNSIGNED NOT NULL,
    version INT UNSIGNED NOT NULL,
    changed_by INT UNSIGNED NOT NULL,
    title VARCHAR(200) NOT NULL,
    main_objectives TEXT NULL, summary TEXT NULL, activities TEXT NULL,
    achievements TEXT NULL, challenges TEXT NULL, solutions TEXT NULL,
    referrals TEXT NULL, recommendations TEXT NULL, next_month_plan TEXT NULL,
    remarks TEXT NULL,
    beneficiaries_reached INT UNSIGNED NOT NULL DEFAULT 0,
    sessions_held INT UNSIGNED NOT NULL DEFAULT 0,
    individual_sessions INT UNSIGNED NOT NULL DEFAULT 0,
    group_sessions INT UNSIGNED NOT NULL DEFAULT 0,
    outreach_activities INT UNSIGNED NOT NULL DEFAULT 0,
    status VARCHAR(40) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_report_revisions_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
    CONSTRAINT fk_report_revisions_user FOREIGN KEY (changed_by) REFERENCES users(id),
    UNIQUE KEY uq_report_revision (report_id, version)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS report_approvals (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    report_id BIGINT UNSIGNED NOT NULL,
    reviewer_id INT UNSIGNED NOT NULL,
    stage ENUM('department', 'secretary', 'vice', 'chair') NOT NULL,
    decision ENUM('submitted', 'forwarded', 'returned', 'approved', 'rejected') NOT NULL,
    comment TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_report_approvals_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
    CONSTRAINT fk_report_approvals_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id),
    INDEX idx_report_approvals_report_date (report_id, created_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS report_comments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    report_id BIGINT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    comment TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_report_comments_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
    CONSTRAINT fk_report_comments_user FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_report_comments_report_date (report_id, created_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    report_id BIGINT UNSIGNED NULL,
    reporting_period_id INT UNSIGNED NULL,
    event_key VARCHAR(190) NOT NULL,
    notification_type VARCHAR(50) NOT NULL,
    message_key VARCHAR(100) NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_period FOREIGN KEY (reporting_period_id) REFERENCES reporting_periods(id) ON DELETE CASCADE,
    UNIQUE KEY uq_notification_user_event (user_id, event_key),
    INDEX idx_notifications_user_unread (user_id, is_read, created_at)
  ) ENGINE=InnoDB`
];

async function hasColumn(connection, table, column) {
  const [rows] = await connection.execute(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function hasIndex(connection, table, index) {
  const [rows] = await connection.execute(
    `SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, index]
  );
  return rows.length > 0;
}

async function migrate() {
  const connection = await db.getConnection();
  try {
    await connection.execute(
      `INSERT IGNORE INTO roles (name, display_name) VALUES ('secretary', 'Secretary')`
    );
    await connection.execute(
      `INSERT IGNORE INTO permissions (code, description) VALUES
       ('reports.final_approval', 'Make final decisions on organization reports'),
       ('reports.secretary_review', 'Perform the secretary report review')`
    );
    const [admin] = await connection.execute("SELECT id FROM roles WHERE name = 'admin'");
    const [chair] = await connection.execute("SELECT id FROM roles WHERE name = 'chairperson'");
    const [vice] = await connection.execute("SELECT id FROM roles WHERE name = 'vice_chairperson'");
    const [secretary] = await connection.execute("SELECT id FROM roles WHERE name = 'secretary'");
    const [permissions] = await connection.execute(
      `SELECT id, code FROM permissions WHERE code IN
       ('system.manage', 'reports.view_all', 'reports.review', 'reports.final_approval', 'reports.secretary_review')`
    );
    const permissionIds = Object.fromEntries(permissions.map((item) => [item.code, item.id]));
    const rolePermissions = [
      [admin[0].id, permissionIds['system.manage']],
      [chair[0].id, permissionIds['reports.view_all']],
      [chair[0].id, permissionIds['reports.final_approval']],
      [vice[0].id, permissionIds['reports.view_all']],
      [vice[0].id, permissionIds['reports.review']],
      [secretary[0].id, permissionIds['reports.secretary_review']]
    ];
    for (const [roleId, permissionId] of rolePermissions) {
      await connection.execute(
        'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
        [roleId, permissionId]
      );
    }
    await connection.execute(
      `ALTER TABLE reports MODIFY status
       ENUM('draft','submitted','returned','secretary_review','vice_review','chair_review','approved','rejected','overdue')
       NOT NULL DEFAULT 'draft'`
    );
    for (const [column, definition] of Object.entries(columns)) {
      if (!(await hasColumn(connection, 'reports', column))) {
        await connection.execute(`ALTER TABLE reports ADD COLUMN ${column} ${definition}`);
      }
    }
    if (!(await hasIndex(connection, 'reports', 'idx_reports_period'))) {
      await connection.execute('ALTER TABLE reports ADD KEY idx_reports_period (reporting_period_id)');
    }
    if (await hasIndex(connection, 'reports', 'uq_report_department_period')) {
      await connection.execute('ALTER TABLE reports DROP INDEX uq_report_department_period');
    }
    if (!(await hasIndex(connection, 'reports', 'uq_report_author_period'))) {
      await connection.execute(
        'ALTER TABLE reports ADD UNIQUE KEY uq_report_author_period (reporting_period_id, department_id, submitted_by)'
      );
    }
    for (const statement of supportTables) await connection.execute(statement);
    await connection.execute(
      `INSERT INTO report_approvals (report_id, reviewer_id, stage, decision, comment, created_at)
       SELECT r.id, r.submitted_by, 'department', 'submitted', NULL, COALESCE(r.submitted_at, r.created_at)
         FROM reports r
        WHERE r.status != 'draft'
          AND NOT EXISTS (
            SELECT 1 FROM report_approvals a WHERE a.report_id = r.id AND a.decision = 'submitted'
          )`
    );
    await connection.execute(
      `INSERT INTO report_approvals (report_id, reviewer_id, stage, decision, comment, created_at)
       SELECT r.id, r.reviewed_by, 'vice',
              CASE WHEN r.status = 'approved' THEN 'approved' ELSE 'returned' END,
              r.review_comment, COALESCE(r.reviewed_at, r.updated_at)
         FROM reports r
        WHERE r.reviewed_by IS NOT NULL
          AND r.status IN ('approved','returned')
          AND NOT EXISTS (SELECT 1 FROM report_approvals a WHERE a.report_id = r.id AND a.reviewer_id = r.reviewed_by)`
    );
    console.log('Staged report workflow migration completed.');
  } catch (error) {
    throw error;
  } finally {
    connection.release();
  }
}

migrate().catch((error) => {
  console.error('Workflow migration failed:', error.code || error.message);
  process.exitCode = 1;
}).finally(() => db.end());
