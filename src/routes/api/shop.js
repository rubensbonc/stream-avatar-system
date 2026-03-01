const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const inventoryService = require('../../services/inventory');
const { db } = require('../../config/database');

const router = express.Router();

// Get shop catalog
router.get('/', async (req, res) => {
  const userId = req.session?.userId;
  const items = await inventoryService.getShopItems(userId);

  // Group by layer type
  const grouped = {};
  for (const item of items) {
    if (!grouped[item.layer_type]) grouped[item.layer_type] = [];
    grouped[item.layer_type].push(item);
  }

  res.json({ items, grouped });
});

// Get single item details
router.get('/:itemId', async (req, res) => {
  const item = await db.getOne('SELECT * FROM items WHERE id = $1 AND is_active = TRUE', [req.params.itemId]);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  // Check if current user owns it
  let owned = false;
  if (req.session?.userId) {
    const inv = await db.getOne(
      'SELECT id FROM user_inventory WHERE user_id = $1 AND item_id = $2',
      [req.session.userId, req.params.itemId]
    );
    owned = !!inv;
  }

  res.json({ ...item, owned });
});

// Purchase an item
router.post('/:itemId/purchase', requireAuth, async (req, res) => {
  const result = await inventoryService.purchaseItem(req.session.userId, req.params.itemId);
  res.json(result);
});

// Get available layer types
router.get('/meta/layers', (req, res) => {
  res.json({
    layers: [
      { type: 'background', label: 'Background', order: 0 },
      { type: 'back_accessory', label: 'Back Accessory', order: 1 },
      { type: 'body', label: 'Body', order: 2 },
      { type: 'pants', label: 'Pants / Legs', order: 3 },
      { type: 'torso', label: 'Shirt / Torso', order: 4 },
      { type: 'face', label: 'Face / Eyes', order: 5 },
      { type: 'hair', label: 'Hair', order: 6 },
      { type: 'hat', label: 'Hat / Headwear', order: 7 },
      { type: 'hand_item', label: 'Hand Item', order: 8 },
      { type: 'effect', label: 'Effect / Aura', order: 9 },
      { type: 'border', label: 'Border / Frame', order: 10 },
    ],
    rarities: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
    unlock_types: ['free', 'points', 'watch_time', 'sub_only', 'donation', 'event'],
  });
});

module.exports = router;
