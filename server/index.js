/**
 * AudioKing Production Server Entry Point
 * Express HTTP Server with Database, Session Middleware, Static Asset Serving, and REST APIs.
 */

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { db, initDatabase } = require('./db');
const { seedAdminAndCatalog } = require('./seedAdmin');
const authRoutes = require('./routes/auth');
const addressesRoutes = require('./routes/addresses');
const ordersRoutes = require('./routes/orders');
const cartRoutes = require('./routes/cart');
const wishlistRoutes = require('./routes/wishlist');
const razorpayRoutes = require('./routes/razorpay');
const cashfreeRoutes = require('./routes/cashfree');
const publicProductsRoutes = require('./routes/publicProducts');
const publicCouponsRoutes = require('./routes/publicCoupons');
const adminAuthRoutes = require('./routes/adminAuth');
const adminApiRoutes = require('./routes/adminApi');
const analyticsRoutes = require('./routes/analytics');
const { requireAdminWeb, getAdminUserFromRequest } = require('./middleware/adminMiddleware');
const { sendCommunityWelcomeEmail } = require('./email');

// Seed admin account and SQLite catalog
seedAdminAndCatalog().catch(err => console.error('[STARTUP SEED ERROR]', err));

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing Middlewares
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Explicit CORS: reflect origin for localhost, GitHub Pages, or configured ALLOWED_ORIGIN
const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const githubPagesPattern = /^https:\/\/[a-zA-Z0-9-]+\.github\.io$/;

const customOrigins = (process.env.ALLOWED_ORIGIN || process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server or local file requests
    if (!origin || origin === 'null') {
      return callback(null, true);
    }
    // Allow localhost or GitHub Pages domains
    if (localhostPattern.test(origin) || githubPagesPattern.test(origin)) {
      return callback(null, true);
    }
    // Allow configured custom origins
    if (customOrigins.includes(origin) || origin === 'https://audioking30.github.io') {
      return callback(null, true);
    }
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token', 'X-Admin-Token', 'Accept'],
  exposedHeaders: ['Set-Cookie']
}));
// Handle preflight for all routes
app.options('*', cors());
app.use(cookieParser(process.env.SESSION_SECRET || 'audioking_secret'));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Request Logger (Development)
if (process.env.NODE_ENV !== 'test') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        console.log(`[API] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
      }
    });
    next();
  });
}

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  try {
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    res.json({
      status: 'healthy',
      database: 'connected',
      registeredUsers: userCount,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// Public Customer APIs
app.use('/api/products', publicProductsRoutes);
app.use('/api/coupons', publicCouponsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/user/addresses', addressesRoutes);
app.use('/api/user/orders', ordersRoutes);
app.use('/api/user/cart', cartRoutes);
app.use('/api/user/wishlist', wishlistRoutes);
app.use('/api/payment/razorpay', razorpayRoutes);
app.use('/api/payment/cashfree', cashfreeRoutes);

// Public Hero Slides & Featured Settings
app.get('/api/hero-slides', (req, res) => {
  try {
    const slides = db.prepare('SELECT * FROM hero_slides WHERE is_active = 1 ORDER BY sort_order ASC, created_at ASC').all();
    res.json({ success: true, count: slides.length, slides });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/featured-settings', (req, res) => {
  try {
    const row = db.prepare("SELECT value_json FROM featured_settings WHERE key = 'locked_product_ids'").get();
    let lockedProductIds = [];
    if (row && row.value_json) {
      try { lockedProductIds = JSON.parse(row.value_json); } catch (e) {}
    }
    res.json({ success: true, lockedProductIds });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Admin APIs (Protected by requireAdminApi inside adminApi.js)
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin', adminApiRoutes);

// Analytics (Public pageview logging + Admin analytics summary)
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin/analytics', analyticsRoutes);

// Static uploads serving
const uploadsDir = path.resolve(__dirname, '..', 'uploads');
app.use('/uploads', express.static(uploadsDir));

// Newsletter Community Subscription API
app.post('/api/newsletter/subscribe', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    try {
      await sendCommunityWelcomeEmail({ email: cleanEmail });
    } catch (emailErr) {
      console.error('[NEWSLETTER] Error dispatching welcome email:', emailErr.message);
    }

    return res.json({
      success: true,
      message: 'Welcome to the AudioKing Creator Community! Check your inbox for your 10% discount voucher.'
    });
  } catch (err) {
    console.error('[NEWSLETTER ERROR]:', err);
    res.status(500).json({ success: false, message: 'Internal server error. Please try again.' });
  }
});

const rootDir = path.resolve(__dirname, '..');

// Unified Single-Site Admin Redirect: routes directly to the in-site admin dashboard
app.get(['/admin', '/admin/', '/admin/login'], (req, res) => {
  res.redirect('/#admin');
});

// Static Asset Serving (Frontend & Storefront)
app.use(express.static(rootDir));

// SPA Fallback (Serve index.html for all non-API and non-admin GET requests)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin')) return next();
  res.sendFile(path.join(rootDir, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[SERVER UNCAUGHT ERROR]', err);
  res.status(500).json({
    error: err.message || 'Internal server error. Please contact AudioKing support.',
    code: 'INTERNAL_ERROR'
  });
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`\n===========================================================`);
    console.log(`  🎵 AUDIOKING PRODUCTION SERVER ONLINE`);
    console.log(`  🌐 Website URL : http://localhost:${PORT}`);
    console.log(`  📦 Environment : ${process.env.NODE_ENV || 'development'}`);
    console.log(`  🗄️  Database    : ${path.resolve(process.env.DATABASE_PATH || './server/data/audioking.db')}`);
    console.log(`===========================================================\n`);
  });
}

module.exports = app;
module.exports.app = app;
