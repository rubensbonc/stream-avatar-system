const { db, redis } = require('../config/database');
const pointsService = require('./points');

class InventoryService {
  /**
   * Get all items a user owns with equip status.
   */
  async getUserInventory(userId) {
    return db.getMany(`
      SELECT i.*, ui.equipped, ui.acquired_at, ui.selected_variant_id
      FROM user_inventory ui
      JOIN items i ON i.id = ui.item_id
      WHERE ui.user_id = $1
      ORDER BY i.layer_type, i.name
    `, [userId]);
  }

  /**
   * Get the user's currently equipped items (their avatar).
   */
  async getEquippedItems(userId) {
    return db.getMany(`
      SELECT i.*, ui.selected_variant_id
      FROM user_inventory ui
      JOIN items i ON i.id = ui.item_id
      WHERE ui.user_id = $1 AND ui.equipped = TRUE
      ORDER BY i.layer_order ASC
    `, [userId]);
  }

  /**
   * Resolve the effective image filename for an item based on its selected variant.
   * Falls back to the item's main image if no variants or no valid selection.
   */
  resolveImage(item) {
    if (item.variants && Array.isArray(item.variants) && item.variants.length > 0) {
      const selected = item.selected_variant_id
        ? item.variants.find(v => v.id === item.selected_variant_id)
        : null;
      return (selected || item.variants[0]).image_filename;
    }
    return item.image_filename;
  }

  /**
   * Set the selected variant for a user's inventory entry.
   */
  async setVariant(userId, itemId, variantId) {
    const item = await db.getOne('SELECT variants FROM items WHERE id = $1', [itemId]);
    if (!item) return { success: false, error: 'Item not found' };
    if (!item.variants || !Array.isArray(item.variants) || item.variants.length === 0) {
      return { success: false, error: 'Item has no variants' };
    }
    const valid = item.variants.some(v => v.id === variantId);
    if (!valid) return { success: false, error: 'Invalid variant' };

    const result = await db.getOne(
      'UPDATE user_inventory SET selected_variant_id = $1 WHERE user_id = $2 AND item_id = $3 RETURNING id',
      [variantId, userId, itemId]
    );
    if (!result) return { success: false, error: 'Item not owned' };

    return { success: true };
  }

  /**
   * Get the shop catalog (items available for purchase).
   */
  async getShopItems(userId) {
    const now = new Date().toISOString();
    const items = await db.getMany(`
      SELECT i.*,
        CASE WHEN ui.id IS NOT NULL THEN TRUE ELSE FALSE END as owned
      FROM items i
      LEFT JOIN user_inventory ui ON ui.item_id = i.id AND ui.user_id = $1
      WHERE i.is_active = TRUE
        AND (i.available_from IS NULL OR i.available_from <= $2)
        AND (i.available_until IS NULL OR i.available_until >= $2)
      ORDER BY i.layer_type, i.rarity, i.name
    `, [userId, now]);

    return items;
  }

  /**
   * Purchase an item from the shop.
   */
  async purchaseItem(userId, itemId) {
    const result = await db.transaction(async (client) => {
      // Check if already owned
      const { rows: [owned] } = await client.query(
        'SELECT id FROM user_inventory WHERE user_id = $1 AND item_id = $2',
        [userId, itemId]
      );
      if (owned) return { success: false, error: 'Already owned' };

      // Get item details
      const { rows: [item] } = await client.query(
        'SELECT * FROM items WHERE id = $1 AND is_active = TRUE', [itemId]
      );
      if (!item) return { success: false, error: 'Item not found' };

      // Check availability window
      const now = new Date();
      if (item.available_from && new Date(item.available_from) > now) {
        return { success: false, error: 'Item not yet available' };
      }
      if (item.available_until && new Date(item.available_until) < now) {
        return { success: false, error: 'Item no longer available' };
      }

      // Check unlock requirements
      const { rows: [user] } = await client.query(
        'SELECT * FROM users WHERE id = $1', [userId]
      );

      switch (item.unlock_type) {
        case 'points':
          const { rows: [spendResult] } = await client.query(
            `UPDATE users SET points_balance = points_balance - $1, updated_at = NOW()
             WHERE id = $2 AND points_balance >= $1
             RETURNING points_balance`,
            [item.unlock_cost, userId]
          );
          if (!spendResult) return { success: false, error: 'Insufficient points' };

          await client.query(
            `INSERT INTO point_transactions (user_id, amount, reason, platform, metadata)
             VALUES ($1, $2, $3, 'system', $4)`,
            [userId, -item.unlock_cost, 'purchase', JSON.stringify({ item_id: itemId, item_name: item.name })]
          );
          break;

        case 'watch_time':
          if (user.watch_time_minutes < (item.unlock_threshold || 0)) {
            return { success: false, error: `Requires ${item.unlock_threshold} minutes watch time` };
          }
          break;

        case 'sub_only':
          break;

        case 'free':
          break;

        default:
          return { success: false, error: 'Unknown unlock type' };
      }

      // Add to inventory
      await client.query(
        'INSERT INTO user_inventory (user_id, item_id) VALUES ($1, $2)',
        [userId, itemId]
      );

      return { success: true, item };
    });

    return result;
  }

  /**
   * Equip/unequip an item.
   */
  async equipItem(userId, itemId, equip = true) {
    // Verify ownership
    const owned = await db.getOne(
      'SELECT id FROM user_inventory WHERE user_id = $1 AND item_id = $2',
      [userId, itemId]
    );
    if (!owned) return { success: false, error: 'Item not owned' };

    // Get item layer type
    const item = await db.getOne('SELECT layer_type FROM items WHERE id = $1', [itemId]);

    if (equip) {
      // Unequip any current item in the same layer
      await db.query(`
        UPDATE user_inventory ui
        SET equipped = FALSE
        FROM items i
        WHERE ui.item_id = i.id
          AND ui.user_id = $1
          AND i.layer_type = $2
          AND ui.equipped = TRUE
      `, [userId, item.layer_type]);
    }

    // Equip/unequip the target item
    await db.query(
      'UPDATE user_inventory SET equipped = $1 WHERE user_id = $2 AND item_id = $3',
      [equip, userId, itemId]
    );

    return { success: true };
  }

  /**
   * Grant an item directly (admin or event reward).
   */
  async grantItem(userId, itemId) {
    const owned = await db.getOne(
      'SELECT id FROM user_inventory WHERE user_id = $1 AND item_id = $2',
      [userId, itemId]
    );
    if (owned) return { success: true, message: 'Already owned' };

    await db.query(
      'INSERT INTO user_inventory (user_id, item_id) VALUES ($1, $2)',
      [userId, itemId]
    );

    return { success: true };
  }

  /**
   * Check if user qualifies for any new unlocks based on watch time / level.
   */
  async checkAutoUnlocks(userId) {
    const user = await db.getOne('SELECT * FROM users WHERE id = $1', [userId]);
    if (!user) return [];

    const newItems = await db.getMany(`
      SELECT i.* FROM items i
      WHERE i.is_active = TRUE
        AND i.unlock_type = 'watch_time'
        AND i.unlock_threshold <= $1
        AND i.id NOT IN (
          SELECT item_id FROM user_inventory WHERE user_id = $2
        )
    `, [user.watch_time_minutes, userId]);

    for (const item of newItems) {
      await db.query(
        'INSERT INTO user_inventory (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, item.id]
      );
    }

    return newItems;
  }
}

module.exports = new InventoryService();
