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
const { generalApiRateLimiter } = require('./middleware/rateLimiter');
const { sendCommunityWelcomeEmail } = require('./email');

// Seed admin account and SQLite catalog
seedAdminAndCatalog().catch(err => console.error('[STARTUP SEED ERROR]', err));

const app = express();
const PORT = process.env.PORT || 3000;

// Trust reverse proxies (Render, Railway, Cloudflare, Nginx) for accurate client IP
app.set('trust proxy', 1);

// Security & Parsing Middlewares
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
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

const corsOptions = {
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
};
const corsMiddleware = cors(corsOptions);
app.use(corsMiddleware);
// Handle preflight for all routes with matching cors options
app.options('*', corsMiddleware);
app.use(cookieParser(process.env.SESSION_SECRET || 'audioking_secret'));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// General Public API Rate Limiter (Protection against scraping & flood attacks)
app.use('/api', generalApiRateLimiter);

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

// Health Check Endpoint (/health and /api/health)
const healthHandler = (req, res) => {
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
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

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

// Public Categories Endpoint
app.get('/api/categories', (req, res) => {
  try {
    const categories = db.prepare(`
      SELECT c.id, c.name, c.slug, COALESCE(c.section, 'pro-audio') AS section, COUNT(p.id) AS product_count
      FROM categories c
      LEFT JOIN products p ON LOWER(TRIM(p.category)) = LOWER(TRIM(c.name))
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE ASC
    `).all();
    res.json({ success: true, count: categories.length, categories });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
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

app.get('/api/popular-categories', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM popular_categories ORDER BY sort_order ASC').all();
    res.json({ success: true, popularCategories: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Public Legal Policies Endpoint
app.get('/api/policies', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM legal_policies').all();
    const policies = {};
    for (const r of rows) {
      let sections = [];
      try { sections = JSON.parse(r.sections_json); } catch (e) {}
      policies[r.id] = {
        id: r.id,
        title: r.title,
        subtitle: r.subtitle,
        badge: r.badge,
        intro: r.intro,
        sections,
        updated_at: r.updated_at,
        updated_by: r.updated_by
      };
    }
    res.json({ success: true, policies });
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

// Public WhatsApp Support Hotline API
app.get('/api/settings/whatsapp', (req, res) => {
  try {
    const row = db.prepare("SELECT value FROM site_settings WHERE key = 'whatsapp_number'").get();
    const rawNumber = row ? row.value : '+91 88793 93743';
    const cleanDigits = rawNumber.replace(/[^0-9]/g, '');
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({
      success: true,
      whatsappNumber: rawNumber,
      cleanDigits,
      waLink: `https://wa.me/${cleanDigits}`
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Static uploads serving with fast image caching & ETag
const uploadsDir = path.resolve(__dirname, '..', 'uploads');
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '7d',
  etag: true,
  setHeaders: (res, filePath) => {
    if (/\.(jpg|jpeg|png|webp|avif|svg|gif|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    }
  }
}));

// Newsletter Community Subscription API
app.post('/api/newsletter/subscribe', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const subId = 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    try {
      db.prepare(`
        INSERT OR IGNORE INTO newsletter_subscribers (id, email, created_at)
        VALUES (?, ?, ?)
      `).run(subId, cleanEmail, new Date().toISOString());
      console.log(`[NEWSLETTER] Saved subscriber: ${cleanEmail}`);
    } catch (dbErr) {
      console.warn('[NEWSLETTER DB NOTICE]', dbErr.message);
    }

    let emailSent = false;
    try {
      const emailResult = await sendCommunityWelcomeEmail({ email: cleanEmail });
      emailSent = !!(emailResult && emailResult.success);
      console.log(`[NEWSLETTER] Welcome email sent to ${cleanEmail}:`, emailResult?.messageId || 'ok');
    } catch (emailErr) {
      console.error('[NEWSLETTER] Error dispatching welcome email:', emailErr.message);
    }

    return res.json({
      success: true,
      emailSent,
      message: 'You are officially part of the AudioKing community! Check your email for your welcome perk & voucher.'
    });
  } catch (err) {
    console.error('[NEWSLETTER ERROR]:', err);
    res.status(500).json({ success: false, message: 'Internal server error. Please try again.' });
  }
});

const rootDir = path.resolve(__dirname, '..');

// Dedicated Admin Login Route
app.get('/admin/login', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(rootDir, 'admin', 'login.html'));
});

// Dedicated Master Admin Portal
app.get(['/admin', '/admin/'], (req, res, next) => {
  if (req.originalUrl === '/admin') {
    return res.redirect(301, '/admin/');
  }
  next();
}, requireAdminWeb, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(rootDir, 'admin', 'index.html'));
});

// Unified Store & Catalog Redirect: routes directly to the storefront catalog
app.get(['/store', '/store/*', '/catalog', '/catalog/*'], (req, res) => {
  res.redirect('/#store');
});

// Static Asset Serving (Frontend & Storefront) with no-cache for code assets and long-term caching for media
app.use(express.static(rootDir, {
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (/\.(jpg|jpeg|png|webp|avif|svg|gif|ico|woff2|woff|ttf|mp4|webm)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    }
  }
}));

// SPA Fallback (Serve index.html for all non-API and non-admin GET requests)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin')) return next();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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

// Process-level error protection
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`\n===========================================================`);
    console.log(`  🎵 AUDIOKING PRODUCTION SERVER ONLINE`);
    console.log(`  🌐 Website URL : http://localhost:${PORT}`);
    console.log(`  📦 Environment : ${process.env.NODE_ENV || 'development'}`);
    console.log(`  🗄️  Database    : ${path.resolve(process.env.DATABASE_PATH || './server/data/audioking.db')}`);
    console.log(`===========================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[PORT CONFLICT] Port ${PORT} is already in use by another application.`);
      console.error(`If running another project on port ${PORT}, you can specify a different port via PORT environment variable (e.g. set PORT=3005).\n`);
    } else {
      console.error('[SERVER LISTEN ERROR]', err);
    }
  });
}

module.exports = app;
module.exports.app = app;

