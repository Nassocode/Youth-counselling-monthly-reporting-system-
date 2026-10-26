require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const app = require('./app');
const db = require('./config/database');
const { startDeadlineReminderScheduler } = require('./services/deadline-reminders');

const required = ['SESSION_SECRET', 'DB_NAME', 'DB_USER'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must contain at least 32 characters.');
  process.exit(1);
}

const port = Number(process.env.PORT || 3000);

db.query('SELECT 1').then(() => {
  const server = app.listen(port, () => console.log(`Youth Counselling Report System listening on http://localhost:${port}`));
  const stopDeadlineReminders = startDeadlineReminderScheduler();
  const shutdown = () => server.close(async () => {
    stopDeadlineReminders();
    await db.end();
    process.exit(0);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}).catch((error) => {
  console.error('Unable to connect to MySQL. Check the database settings in .env.');
  console.error(error.code || error.message);
  process.exit(1);
});
