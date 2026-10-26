# Youth Counselling Monthly Report System

Bilingual monthly reporting and review system with a secure Express application, MySQL-backed accounts, role-based authorization, session tracking, audit records, and Kiswahili/English interfaces.

## Requirements

- Node.js 20 or newer
- MySQL 8.0 or newer (or a compatible MariaDB release)

## Quick start on Windows

1. Start MySQL in XAMPP, then open PowerShell in this project folder.
2. Install dependencies:

   ```powershell
   npm install
   ```

3. Copy the example environment file and set a unique secret:

   ```powershell
   Copy-Item .env.example .env
   $bytes = New-Object byte[] 48
   $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
   $rng.GetBytes($bytes)
   $secret = [Convert]::ToBase64String($bytes)
   $lines = (Get-Content .env) -replace '^SESSION_SECRET=.*$', "SESSION_SECRET=$secret"
   Set-Content -Path .env -Value $lines -Encoding ASCII
   ```

4. Import the database schema (for this workspace, XAMPP's MySQL client is under `C:\xampp1\mysql\bin`):

   ```powershell
   Get-Content Database\schema.sql | & 'C:\xampp1\mysql\bin\mysql.exe' -u root
   ```

   If your MySQL root account has a password, use `mysql.exe -u root -p` interactively instead.

5. Create the first administrator interactively. The password is not echoed or stored in the command history:

   ```powershell
   npm run create-admin
   ```

   For an existing installation, apply the staged approval workflow migration:

   ```powershell
   npm run migrate:workflow
   ```

6. Start the application:

   ```powershell
   npm start
   ```

7. Open <http://localhost:3000>.

Configure the database host, name, username, and password in the ignored `.env` file. Do not use development secrets or a root database account in production.

## Available commands

- `npm run dev` starts the server with Node's watch mode.
- `npm test` runs the automated tests.
- `npm run create-admin` creates an administrator after the schema has been imported.
- `npm run reset-admin-password` interactively sets a new password for an active administrator and revokes their existing sessions.

## Available workflows

- **Administrator:** create and deactivate accounts, change roles, create and deactivate departments, assign department heads/assistants/members, and open or close reporting periods.
- **Department member:** create, edit, and submit complete monthly reports for an assigned department.
- **Department head:** review submitted reports for assigned departments, then forward or return them with feedback.
- **Secretary:** review forwarded reports, then send them to the vice chairperson or return them with feedback.
- **Vice chairperson:** review reports, forward them to the chairperson, return them, or reject them with feedback.
- **Chairperson:** give final approval, return a report with feedback, or reject it with feedback.
- **Administrator:** manage accounts, roles, departments, memberships, and reporting periods.
- **All signed-in users:** change their own password after confirming the current password; changing it revokes all active sessions and requires signing in again.
- Report edits are versioned; approval decisions and review comments are retained and visible in each report's history.
- Each assigned member may submit one report per department and reporting period; other members in the same department may submit their own reports independently.
- In-app notifications are generated for workflow events, with a deduplicated reminder during the final three days of an open period.
- All roles receive role-appropriate report visibility, dashboard metrics, and bilingual Kiswahili/English labels.
- Role dashboards summarize each user's relevant queue; the administrator overview also shows active accounts, active departments, open periods, and reports awaiting review. Account management supports searching and filtering by role and status.
- The administrator reporting summary measures expected submissions from active member assignments and excludes saved drafts from submission and approval rates.
- Each signed-in account receives a consistent, distinct accent palette derived from its account ID; it is applied across the dashboard and resets on sign-out.

The database must be initialized with `Database/schema.sql`. After creating the first administrator, use the administrator dashboard to create departments, accounts, and department memberships before members begin reporting.

CSV export and print-friendly report views are available to reviewers. Configure production deployment hardening separately.
