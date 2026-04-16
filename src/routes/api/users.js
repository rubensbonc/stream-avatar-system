const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { db } = require('../../config/database');
const pointsService = require('../../services/points');
const inventoryService = require('../../services/inventory');
const errorLogger = require('../../services/errorLogger');

const router = express.Router();
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Get current user's profile
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await db.getOne(`
    SELECT u.*,
      (SELECT COUNT(*) FROM user_inventory WHERE user_id = u.id) as items_owned,
      (SELECT COUNT(*) FROM items WHERE is_active = TRUE) as total_items
    FROM users u WHERE u.id = $1
  `, [req.session.userId]);

  const linkedAccounts = await db.getMany(
    'SELECT platform, platform_username, is_primary, linked_at FROM linked_accounts WHERE user_id = $1',
    [req.session.userId]
  );

  res.json({ ...user, linked_accounts: linkedAccounts });
}));

// Leaderboard
router.get('/leaderboard', asyncHandler(async (req, res) => {
  const type = req.query.type || 'points'; // 'points', 'watch_time', 'items'
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  let orderBy;
  switch (type) {
    case 'watch_time': orderBy = 'watch_time_minutes'; break;
    case 'items': orderBy = '(SELECT COUNT(*) FROM user_inventory WHERE user_id = u.id)'; break;
    default: orderBy = 'points_balance';
  }

  const leaders = await db.getMany(`
    SELECT u.id, u.display_name, u.points_balance, u.watch_time_minutes, u.streak_days,
      (SELECT COUNT(*) FROM user_inventory WHERE user_id = u.id) as items_owned
    FROM users u
    ORDER BY ${orderBy} DESC
    LIMIT $1
  `, [limit]);

  res.json(leaders);
}));

// Get any user's public profile by internal ID
router.get('/:userId', asyncHandler(async (req, res) => {
  const user = await db.getOne(`
    SELECT id, display_name, points_balance, watch_time_minutes, streak_days, created_at,
      (SELECT COUNT(*) FROM user_inventory WHERE user_id = users.id) as items_owned
    FROM users WHERE id = $1
  `, [req.params.userId]);

  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
}));

// Get user points by platform ID (for Streamer.bot chat commands)
router.get('/platform/:platform/:platformId/points', asyncHandler(async (req, res) => {
  const user = await db.getOne(`
    SELECT u.display_name, u.points_balance, u.watch_time_minutes, u.streak_days
    FROM users u
    JOIN linked_accounts la ON u.id = la.user_id
    WHERE la.platform = $1 AND la.platform_user_id = $2
  `, [req.params.platform, req.params.platformId]);

  if (!user) return res.json({ found: false, points: 0 });
  res.json({ found: true, ...user });
}));

// Get user's inventory
router.get('/me/inventory', requireAuth, asyncHandler(async (req, res) => {
  const inventory = await inventoryService.getUserInventory(req.session.userId);
  res.json(inventory);
}));

// Get user's equipped items (avatar)
router.get('/me/avatar', requireAuth, asyncHandler(async (req, res) => {
  const equipped = await inventoryService.getEquippedItems(req.session.userId);
  res.json(equipped);
}));

// Get any user's avatar by platform ID (for overlays)
router.get('/platform/:platform/:platformId/avatar', asyncHandler(async (req, res) => {
  const user = await db.getOne(`
    SELECT u.id FROM users u
    JOIN linked_accounts la ON u.id = la.user_id
    WHERE la.platform = $1 AND la.platform_user_id = $2
  `, [req.params.platform, req.params.platformId]);

  if (!user) return res.json({ found: false, items: [] });

  const equipped = await inventoryService.getEquippedItems(user.id);
  res.json({ found: true, items: equipped });
}));

// Equip an item
router.post('/me/equip/:itemId', requireAuth, asyncHandler(async (req, res) => {
  const result = await inventoryService.equipItem(req.session.userId, req.params.itemId, true);
  res.json(result);
}));

// Unequip an item
router.post('/me/unequip/:itemId', requireAuth, asyncHandler(async (req, res) => {
  const result = await inventoryService.equipItem(req.session.userId, req.params.itemId, false);
  res.json(result);
}));

// Daily spin
router.post('/me/daily-spin', requireAuth, asyncHandler(async (req, res) => {
  const result = await pointsService.dailySpin(req.session.userId);
  res.json(result);
}));

// Point transaction history
router.get('/me/transactions', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  const transactions = await db.getMany(`
    SELECT * FROM point_transactions
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `, [req.session.userId, limit, offset]);

  res.json(transactions);
}));

// Delete own account
router.delete('/me', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id = $1', [req.session.userId]);
    req.session.destroy();
    res.json({ success: true });
  } catch (err) {
    const errorId = await errorLogger.logError(err, { req, source: 'users.delete' });
    res.status(500).json({ error: 'Failed to delete account', error_id: errorId });
  }
});

module.exports = router;
