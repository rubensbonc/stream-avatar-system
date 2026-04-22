const express = require('express');
const path = require('path');
const { db } = require('../config/database');
const inventoryService = require('../services/inventory');
const websocketService = require('../services/websocket');

const router = express.Router();
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Serve the single overlay page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/overlays/avatar-overlay.html'));
});

// API: trigger avatar display (called by Streamer.bot)
router.post('/trigger', asyncHandler(async (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.body.api_key;
  if (apiKey !== process.env.API_SECRET) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const { username, platform } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'username is required' });
  }

  let user;
  if (platform) {
    user = await db.getOne(`
      SELECT u.* FROM users u
      JOIN linked_accounts la ON u.id = la.user_id
      WHERE la.platform = $1 AND (la.platform_username ILIKE $2 OR la.platform_user_id = $2)
    `, [platform, username]);
  } else {
    user = await db.getOne(`
      SELECT u.* FROM users u
      JOIN linked_accounts la ON u.id = la.user_id
      WHERE la.platform_username ILIKE $1
    `, [username]);
  }

  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }

  const equipped = await inventoryService.getEquippedItems(user.id);

  const payload = {
    user: {
      id: user.id,
      display_name: user.display_name,
    },
    items: equipped.map(item => ({
      name: item.name,
      layer_type: item.layer_type,
      layer_order: item.layer_order,
      image_url: `/assets/cosmetics/${inventoryService.resolveImage(item)}`,
    })),
  };

  websocketService.broadcast('overlay', 'show_avatar', payload);
  res.json({ success: true, display_name: user.display_name, item_count: equipped.length });
}));

// API: hide avatar (optional, for manual clear)
router.post('/hide', asyncHandler(async (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.body.api_key;
  if (apiKey !== process.env.API_SECRET) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  websocketService.broadcast('overlay', 'hide_avatar', {});
  res.json({ success: true });
}));

// Avatar data endpoint (for direct lookups)
router.get('/avatar/:identifier', asyncHandler(async (req, res) => {
  const { identifier } = req.params;
  const { platform } = req.query;

  let user;

  if (platform) {
    user = await db.getOne(`
      SELECT u.* FROM users u
      JOIN linked_accounts la ON u.id = la.user_id
      WHERE la.platform = $1 AND (la.platform_username ILIKE $2 OR la.platform_user_id = $2)
    `, [platform, identifier]);
  } else {
    user = await db.getOne('SELECT * FROM users WHERE id = $1', [identifier]);
    if (!user) {
      user = await db.getOne(`
        SELECT u.* FROM users u
        JOIN linked_accounts la ON u.id = la.user_id
        WHERE la.platform_username ILIKE $1
      `, [identifier]);
    }
  }

  if (!user) {
    return res.json({ found: false, items: [] });
  }

  const equipped = await inventoryService.getEquippedItems(user.id);

  res.json({
    found: true,
    user: {
      id: user.id,
      display_name: user.display_name,
      points: user.points_balance,
      watch_time: user.watch_time_minutes,
      streak: user.streak_days,
    },
    items: equipped.map(item => ({
      name: item.name,
      layer_type: item.layer_type,
      layer_order: item.layer_order,
      rarity: item.rarity,
      image_url: `/assets/cosmetics/${inventoryService.resolveImage(item)}`,
    })),
  });
}));

module.exports = router;
