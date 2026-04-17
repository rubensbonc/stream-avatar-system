const { db } = require('../config/database');

// Middleware: Verify API secret for Streamer.bot / SE webhooks
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey || apiKey !== process.env.API_SECRET) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

// Middleware: Require logged-in user session
function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Middleware: Require admin privileges
async function requireAdmin(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = await db.getOne('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
  if (!user?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Helper: Get current user from session
async function getCurrentUser(req) {
  if (!req.session?.userId) return null;
  return db.getOne(`
    SELECT u.*, COALESCE(
      json_agg(
        json_build_object('platform', la.platform, 'username', la.platform_username)
      ) FILTER (WHERE la.id IS NOT NULL),
      '[]'::json
    ) as linked_accounts
    FROM users u
    LEFT JOIN linked_accounts la ON la.user_id = u.id
    WHERE u.id = $1
    GROUP BY u.id
  `, [req.session.userId]);
}

module.exports = { requireApiKey, requireAuth, requireAdmin, getCurrentUser };
