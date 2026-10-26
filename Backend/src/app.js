require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const reportRoutes = require('./routes/reports');
const notificationRoutes = require('./routes/notifications');
const db = require('./config/database');
const { notFound, errorHandler } = require('./middleware/error-handler');

const app = express();
const frontendPath = path.resolve(__dirname, '../../Frontend');

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'too_many_login_attempts' }
}));

app.get('/api/health', async (req, res, next) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    next(error);
  }
});
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use(express.static(frontendPath, { index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.use('/api', notFound);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
