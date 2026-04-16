const express = require('express');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { requireAdmin } = require('../../middleware/auth');
const { db, redis } = require('../../config/database');
const pointsService = require('../../services/points');
const inventoryService = require('../../services/inventory');
const websocketService = require('../../services/websocket');
const errorLogger = require('../../services/errorLogger');

const router = express.Router();

// ── File Upload Config ──
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../../public/assets/cosmetics'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB (for 1080x1080 assets)
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// ── Item Management ──

// Create a new cosmetic item
router.post('/items', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const {
      name, description, layer_type, rarity = 'common',
      unlock_type = 'points', unlock_cost = 0, unlock_threshold,
      is_default = false, is_limited = false,
      available_from, available_until, category, tags
    } = req.body;

    if (!req.file) return res.status(400).json({ error: 'Image file required' });
    if (!name || !layer_type) return res.status(400).json({ error: 'name and layer_type required' });

    // Generate thumbnail
    const thumbFilename = `thumb_${req.file.filename}`;
    await sharp(req.file.path)
      .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(req.file.destination, thumbFilename));

    // Layer order mapping
    const layerOrders = {
      background: 0, back_accessory: 1, body: 2, pants: 3, torso: 4,
      face: 5, hair: 6, hat: 7, hand_item: 8, effect: 9, border: 10
    };

    const item = await db.getOne(`
      INSERT INTO items (name, description, layer_type, layer_order, rarity, image_filename, thumbnail_filename,
        unlock_type, unlock_cost, unlock_threshold, is_default, is_limited,
        available_from, available_until, category, tags)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [
      name, description, layer_type, layerOrders[layer_type] || 0, rarity,
      req.file.filename, thumbFilename,
      unlock_type, parseInt(unlock_cost) || 0, unlock_threshold ? parseInt(unlock_threshold) : null,
      is_default === 'true' || is_default === 'on' || is_default === true, is_limited === 'true' || is_limited === 'on' || is_limited === true,
      available_from || null, available_until || null,
      category || null, tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : null
    ]);

    res.json({ success: true, item });
  } catch (err) {
    const errorId = await errorLogger.logError(err, { req, source: 'admin.items.create' });
    res.status(500).json({ error: 'Failed to create item', error_id: errorId });
  }
});

// Update an item
router.put('/items/:itemId', requireAdmin, upload.single('image'), async (req, res) => {
  const { name, description, rarity, unlock_type, unlock_cost, unlock_threshold, is_active, is_limited, available_from, available_until, category, tags } = req.body;
  const updates = [];
  const values = [];
  let idx = 1;

  const addUpdate = (field, value) => {
    if (value !== undefined) {
      updates.push(`${field} = $${idx++}`);
      values.push(value);
    }
  };

  addUpdate('name', name);
  addUpdate('description', description);
  addUpdate('rarity', rarity);
  addUpdate('unlock_type', unlock_type);
  addUpdate('unlock_cost', unlock_cost ? parseInt(unlock_cost) : undefined);
  addUpdate('unlock_threshold', unlock_threshold ? parseInt(unlock_threshold) : undefined);
  addUpdate('is_active', is_active !== undefined ? (is_active === 'true' || is_active === 'on' || is_active === true) : undefined);
  addUpdate('is_limited', is_limited !== undefined ? (is_limited === 'true' || is_limited === 'on' || is_limited === true) : undefined);
  addUpdate('available_from', available_from || undefined);
  addUpdate('available_until', available_until || undefined);
  addUpdate('category', category);
  if (tags) addUpdate('tags', Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()));

  if (req.file) {
    addUpdate('image_filename', req.file.filename);
    const thumbFilename = `thumb_${req.file.filename}`;
    await sharp(req.file.path)
      .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(req.file.destination, thumbFilename));
    addUpdate('thumbnail_filename', thumbFilename);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No updates provided' });

  values.push(req.params.itemId);
  const item = await db.getOne(
    `UPDATE items SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  res.json({ success: true, item });
});

// Delete an item (soft delete)
router.delete('/items/:itemId', requireAdmin, async (req, res) => {
  await db.query('UPDATE items SET is_active = FALSE WHERE id = $1', [req.params.itemId]);
  res.json({ success: true });
});

// List all items (admin view, including inactive)
router.get('/items', requireAdmin, async (req, res) => {
  const items = await db.getMany('SELECT * FROM items ORDER BY layer_type, name');
  res.json(items);
});

// ── Economy Controls ──

// Set points multiplier
router.post('/economy/multiplier', requireAdmin, async (req, res) => {
  const { multiplier } = req.body;
  await db.query("UPDATE economy_settings SET value = $1, updated_at = NOW() WHERE key = 'points_multiplier'", [JSON.stringify(multiplier)]);
  await redis.del('economy:multiplier');
  res.json({ success: true, multiplier });
});

// Toggle double points
router.post('/economy/double-points', requireAdmin, async (req, res) => {
  const { active } = req.body;
  await db.query("UPDATE economy_settings SET value = $1, updated_at = NOW() WHERE key = 'double_points_active'", [JSON.stringify(active)]);
  await redis.del('economy:multiplier');
  if (active) {
    websocketService.broadcastAll('announcement', { message: 'Double Points activated!' });
  }
  res.json({ success: true, active });
});

// Grant points to a user (admin)
router.post('/grant-points', requireAdmin, async (req, res) => {
  const { user_id, amount, reason = 'admin_grant' } = req.body;
  const result = await pointsService.awardPoints(user_id, parseInt(amount), reason, 'admin');
  res.json(result);
});

// Grant item to a user (admin)
router.post('/grant-item', requireAdmin, async (req, res) => {
  const { user_id, item_id } = req.body;
  const result = await inventoryService.grantItem(user_id, item_id);
  res.json(result);
});

// ── Analytics ──

router.get('/stats', requireAdmin, async (req, res) => {
  const [users, items, transactions, active] = await Promise.all([
    db.getOne('SELECT COUNT(*) as count, SUM(points_balance) as total_points FROM users'),
    db.getOne('SELECT COUNT(*) as count FROM items WHERE is_active = TRUE'),
    db.getOne("SELECT COUNT(*) as count FROM point_transactions WHERE created_at > NOW() - INTERVAL '24 hours'"),
    db.getOne("SELECT COUNT(*) as count FROM users WHERE last_seen_at > NOW() - INTERVAL '1 hour'"),
  ]);

  const topItems = await db.getMany(`
    SELECT i.name, i.rarity, COUNT(ui.id) as owned_count
    FROM items i
    LEFT JOIN user_inventory ui ON ui.item_id = i.id
    WHERE i.is_active = TRUE
    GROUP BY i.id
    ORDER BY owned_count DESC
    LIMIT 10
  `);

  res.json({
    total_users: parseInt(users.count),
    total_points_circulation: parseInt(users.total_points) || 0,
    total_items: parseInt(items.count),
    transactions_24h: parseInt(transactions.count),
    active_users_1h: parseInt(active.count),
    top_items: topItems,
  });
});

// Get all economy settings
router.get('/economy', requireAdmin, async (req, res) => {
  const settings = await db.getMany('SELECT * FROM economy_settings');
  const obj = {};
  settings.forEach(s => { obj[s.key] = s.value; });
  res.json(obj);
});

// ── Item Detail Management ──

// Search users (for granting items)
router.get('/users/search', requireAdmin, async (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 2) return res.json([]);

  const users = await db.getMany(`
    SELECT DISTINCT u.id, u.display_name, u.points_balance
    FROM users u
    LEFT JOIN linked_accounts la ON u.id = la.user_id
    WHERE LOWER(u.display_name) LIKE LOWER($1)
       OR LOWER(la.platform_username) LIKE LOWER($1)
    LIMIT 10
  `, [`%${q}%`]);

  res.json(users);
});

// Get item detail with owner list
router.get('/items/:itemId/detail', requireAdmin, async (req, res) => {
  const item = await db.getOne('SELECT * FROM items WHERE id = $1', [req.params.itemId]);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const owners = await db.getMany(`
    SELECT u.id, u.display_name, u.points_balance, ui.equipped, ui.acquired_at
    FROM user_inventory ui
    JOIN users u ON u.id = ui.user_id
    WHERE ui.item_id = $1
    ORDER BY ui.acquired_at DESC
  `, [req.params.itemId]);

  const totalUsers = await db.getOne('SELECT COUNT(*) as count FROM users');

  res.json({ item, owners, total_users: parseInt(totalUsers.count) });
});

// Grant item to a user (from item detail)
router.post('/items/:itemId/owners', requireAdmin, async (req, res) => {
  const { user_id } = req.body;
  const result = await inventoryService.grantItem(user_id, req.params.itemId);
  res.json(result);
});

// Revoke item from a user
router.delete('/items/:itemId/owners/:userId', requireAdmin, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM user_inventory WHERE user_id = $1 AND item_id = $2',
      [req.params.userId, req.params.itemId]
    );
    res.json({ success: true });
  } catch (err) {
    const errorId = await errorLogger.logError(err, { req, source: 'admin.items.revoke' });
    res.status(500).json({ error: 'Failed to revoke item', error_id: errorId });
  }
});

// Toggle item active/inactive
router.put('/items/:itemId/toggle', requireAdmin, async (req, res) => {
  const item = await db.getOne(
    'UPDATE items SET is_active = NOT is_active WHERE id = $1 RETURNING *',
    [req.params.itemId]
  );
  res.json({ success: true, item });
});

// Re-enable an expired limited item (resets available_until)
router.put('/items/:itemId/reactivate', requireAdmin, async (req, res) => {
  const { available_until } = req.body;
  const item = await db.getOne(`
    UPDATE items SET is_active = TRUE, available_until = $1
    WHERE id = $2 RETURNING *
  `, [available_until || null, req.params.itemId]);
  res.json({ success: true, item });
});

// ── Error Log Management ──

router.get('/errors', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const resolved = req.query.resolved !== undefined ? req.query.resolved === 'true' : undefined;
    const severity = req.query.severity || undefined;

    const errors = await errorLogger.getErrors({ limit, offset, resolved, severity });
    res.json(errors);
  } catch (err) {
    const errorId = await errorLogger.logError(err, { req, source: 'admin.errors.list' });
    res.status(500).json({ error: 'Failed to fetch errors', error_id: errorId });
  }
});

router.get('/errors/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await errorLogger.getErrorStats();
    res.json(stats);
  } catch (err) {
    const errorId = await errorLogger.logError(err, { req, source: 'admin.errors.stats' });
    res.status(500).json({ error: 'Failed to fetch error stats', error_id: errorId });
  }
});

router.put('/errors/:errorId/resolve', requireAdmin, async (req, res) => {
  try {
    const result = await errorLogger.resolveError(req.params.errorId);
    res.json(result);
  } catch (err) {
    const errorId = await errorLogger.logError(err, { req, source: 'admin.errors.resolve' });
    res.status(500).json({ error: 'Failed to resolve error', error_id: errorId });
  }
});

router.delete('/errors/resolved', requireAdmin, async (req, res) => {
  try {
    const result = await errorLogger.clearResolved();
    res.json(result);
  } catch (err) {
    const errorId = await errorLogger.logError(err, { req, source: 'admin.errors.clear' });
    res.status(500).json({ error: 'Failed to clear errors', error_id: errorId });
  }
});

module.exports = router;
