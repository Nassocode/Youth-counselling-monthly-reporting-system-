CREATE DATABASE IF NOT EXISTS youth_counselling_reports
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE youth_counselling_reports;

CREATE TABLE IF NOT EXISTS roles (
  id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(40) NOT NULL UNIQUE,
  display_name VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
  id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id SMALLINT UNSIGNED NOT NULL,
  permission_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS departments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id SMALLINT UNSIGNED NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  preferred_language ENUM('sw', 'en') NOT NULL DEFAULT 'sw',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id),
  INDEX idx_users_role_active (role_id, is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS department_members (
  department_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  membership_role ENUM('head', 'assistant', 'member') NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (department_id, user_id),
  CONSTRAINT fk_department_members_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  CONSTRAINT fk_department_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_department_members_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reporting_periods (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  year SMALLINT UNSIGNED NOT NULL,
  month TINYINT UNSIGNED NOT NULL,
  opens_at DATE NOT NULL,
  closes_at DATE NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_reporting_periods_creator FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uq_reporting_period (year, month),
  CONSTRAINT chk_reporting_period_month CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT chk_reporting_period_dates CHECK (closes_at >= opens_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reporting_period_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  submitted_by INT UNSIGNED NOT NULL,
  status ENUM('draft', 'submitted', 'returned', 'secretary_review', 'vice_review', 'chair_review', 'approved', 'rejected', 'overdue') NOT NULL DEFAULT 'draft',
  title VARCHAR(200) NOT NULL DEFAULT 'Monthly report',
  main_objectives TEXT NULL,
  summary TEXT NULL,
  activities TEXT NULL,
  achievements TEXT NULL,
  challenges TEXT NULL,
  solutions TEXT NULL,
  referrals TEXT NULL,
  recommendations TEXT NULL,
  next_month_plan TEXT NULL,
  remarks TEXT NULL,
  beneficiaries_reached INT UNSIGNED NOT NULL DEFAULT 0,
  sessions_held INT UNSIGNED NOT NULL DEFAULT 0,
  individual_sessions INT UNSIGNED NOT NULL DEFAULT 0,
  group_sessions INT UNSIGNED NOT NULL DEFAULT 0,
  outreach_activities INT UNSIGNED NOT NULL DEFAULT 0,
  report_version INT UNSIGNED NOT NULL DEFAULT 1,
  submitted_at DATETIME NULL,
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  review_comment TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_reports_period FOREIGN KEY (reporting_period_id) REFERENCES reporting_periods(id),
  CONSTRAINT fk_reports_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_reports_submitter FOREIGN KEY (submitted_by) REFERENCES users(id),
  CONSTRAINT fk_reports_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_report_author_period (reporting_period_id, department_id, submitted_by),
  INDEX idx_reports_status_period (status, reporting_period_id),
  INDEX idx_reports_department (department_id, reporting_period_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_revisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  changed_by INT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  main_objectives TEXT NULL,
  summary TEXT NULL,
  activities TEXT NULL,
  achievements TEXT NULL,
  challenges TEXT NULL,
  solutions TEXT NULL,
  referrals TEXT NULL,
  recommendations TEXT NULL,
  next_month_plan TEXT NULL,
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_approvals (
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_comments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_comments_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  CONSTRAINT fk_report_comments_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_report_comments_report_date (report_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS login_sessions (
  id CHAR(36) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_login_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_login_sessions_user_expiry (user_id, expires_at),
  INDEX idx_login_sessions_active (id, revoked_at, expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80) NULL,
  details JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_logs_actor_date (actor_user_id, created_at),
  INDEX idx_audit_logs_entity (entity_type, entity_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS organization_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT IGNORE INTO organization_settings (setting_key, setting_value) VALUES
  ('organization_name', 'Youth Counselling'),
  ('logo_url', '');

INSERT IGNORE INTO roles (name, display_name) VALUES
  ('admin', 'Administrator'),
  ('chairperson', 'Chairperson'),
  ('vice_chairperson', 'Vice Chairperson'),
  ('secretary', 'Secretary'),
  ('department_head', 'Department Head'),
  ('member', 'Department Member');

INSERT IGNORE INTO permissions (code, description) VALUES
  ('system.manage', 'Manage system configuration and user accounts'),
  ('reports.view_all', 'View organization-wide reports'),
  ('reports.review', 'Review and approve or return reports'),
  ('reports.final_approval', 'Make final decisions on organization reports'),
  ('reports.secretary_review', 'Perform the secretary report review'),
  ('reports.manage_department', 'Prepare and submit department reports'),
  ('announcements.manage', 'Create and publish announcements');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE (r.name = 'admin' AND p.code IN ('system.manage', 'reports.view_all', 'announcements.manage'))
   OR (r.name = 'chairperson' AND p.code IN ('reports.view_all', 'reports.final_approval', 'announcements.manage'))
   OR (r.name = 'vice_chairperson' AND p.code IN ('reports.view_all', 'reports.review'))
   OR (r.name = 'secretary' AND p.code = 'reports.secretary_review')
   OR (r.name = 'department_head' AND p.code = 'reports.review')
   OR (r.name = 'member' AND p.code = 'reports.manage_department');
