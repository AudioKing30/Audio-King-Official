/**
 * AudioKing Analytics Routes
 * Lightweight page-view logging (public) and admin analytics summary (protected).
 */

const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAdminApi } = require('../middleware/adminMiddleware');

const router = express.Router();

// Simple in-memory rate limiter for pageview logging (per IP, 1 per second)
const pvRateMap = new Map();
const PV_RATE_WINDOW = 1000; // 1 second

/**
 * POST /api/analytics/pageview  (Public — no auth required)
 * Logs a lightweight page view. Fire-and-forget from frontend.
 */
router.post('/pageview', (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();

    // Rate limit: max 1 pageview per IP per second
    const lastHit = pvRateMap.get(ip);
    if (lastHit && (now - lastHit) < PV_RATE_WINDOW) {
      return res.status(200).json({ ok: true }); // silently ignore
    }
    pvRateMap.set(ip, now);

    // Clean rate map every 60 seconds
    if (pvRateMap.size > 10000) {
      const cutoff = now - 60000;
      for (const [key, ts] of pvRateMap) {
        if (ts < cutoff) pvRateMap.delete(key);
      }
    }

    const { path: pagePath, productId, referrer } = req.body || {};
    if (!pagePath || typeof pagePath !== 'string') {
      return res.status(200).json({ ok: true });
    }

    const ipHash = crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
    const userAgent = (req.headers['user-agent'] || '').substring(0, 255);
    const ref = (referrer || req.headers['referer'] || '').substring(0, 500);

    db.prepare(`
      INSERT INTO page_views (path, product_id, referrer, user_agent, ip_hash, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      pagePath.substring(0, 200),
      productId || null,
      ref || null,
      userAgent || null,
      ipHash
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    // Never fail the storefront — silently accept
    res.status(200).json({ ok: true });
  }
});

/**
 * POST /api/analytics/click (Public — no auth required)
 * Logs a product click beacon from frontend.
 */
router.post('/click', (req, res) => {
  try {
    let productId = null;
    if (typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body);
        productId = parsed.productId;
      } catch (e) {}
    } else if (req.body && req.body.productId) {
      productId = req.body.productId;
    }

    if (productId) {
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      const ipHash = crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
      const userAgent = (req.headers['user-agent'] || '').substring(0, 255);
      const ref = (req.headers['referer'] || '').substring(0, 500);

      db.prepare(`
        INSERT INTO page_views (path, product_id, referrer, user_agent, ip_hash, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(
        `/product?id=${productId}`,
        productId,
        ref || null,
        userAgent || null,
        ipHash
      );
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: true });
  }
});


/**
 * GET /api/admin/analytics/summary  (Admin-only)
 * Returns dashboard analytics: views, top products, traffic sources.
 */
router.get('/summary', requireAdminApi, (req, res) => {
  try {
    const range = req.query.range || '7'; // days
    const days = Math.min(Math.max(parseInt(range) || 7, 1), 365);

    // Today's views
    const todayViews = db.prepare(`
      SELECT COUNT(*) AS count FROM page_views
      WHERE date(created_at) = date('now')
    `).get().count;

    // Total cumulative views
    const totalViews = db.prepare(`
      SELECT COUNT(*) AS count FROM page_views
    `).get().count;

    // Daily trend (last N days)
    const dailyTrend = db.prepare(`
      SELECT date(created_at) AS day, COUNT(*) AS views
      FROM page_views
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY date(created_at)
      ORDER BY day ASC
    `).all();

    // Top 10 most-viewed products
    const topProducts = db.prepare(`
      SELECT pv.product_id, p.name, p.image, COUNT(*) AS views
      FROM page_views pv
      LEFT JOIN products p ON pv.product_id = p.id
      WHERE pv.product_id IS NOT NULL
        AND pv.created_at >= datetime('now', '-${days} days')
      GROUP BY pv.product_id
      ORDER BY views DESC
      LIMIT 10
    `).all();

    // Total registered users
    const totalUsers = db.prepare(`
      SELECT COUNT(*) AS count FROM users WHERE role != 'admin'
    `).get().count;

    // Traffic sources breakdown
    const rawSources = db.prepare(`
      SELECT referrer, COUNT(*) AS count
      FROM page_views
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY referrer
    `).all();

    // Categorize traffic sources
    const sources = { Direct: 0, Google: 0, Social: 0, Other: 0 };
    for (const row of rawSources) {
      const ref = (row.referrer || '').toLowerCase();
      if (!ref || ref === 'null' || ref.includes('localhost') || ref.includes('127.0.0.1')) {
        sources.Direct += row.count;
      } else if (ref.includes('google')) {
        sources.Google += row.count;
      } else if (ref.includes('facebook') || ref.includes('instagram') || ref.includes('twitter') || ref.includes('youtube') || ref.includes('linkedin') || ref.includes('tiktok')) {
        sources.Social += row.count;
      } else {
        sources.Other += row.count;
      }
    }

    // Unique visitors (by ip_hash) today
    const todayUnique = db.prepare(`
      SELECT COUNT(DISTINCT ip_hash) AS count FROM page_views
      WHERE date(created_at) = date('now')
    `).get().count;

    // Top pages
    const topPages = db.prepare(`
      SELECT path, COUNT(*) AS views
      FROM page_views
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY path
      ORDER BY views DESC
      LIMIT 10
    `).all();

    res.json({
      success: true,
      analytics: {
        todayViews,
        todayUnique,
        totalViews,
        totalUsers,
        dailyTrend,
        topProducts,
        topPages,
        trafficSources: sources,
        range: days
      }
    });
  } catch (err) {
    console.error('[ANALYTICS ERROR]', err);
    res.status(500).json({ error: 'Failed to load analytics data.' });
  }
});

module.exports = router;
