const { db } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class IdentityService {
  /**
   * Resolve a platform identity to an internal user.
   * Creates a new user if none found and autoCreate is true.
   */
  async resolveUser(platform, platformUserId, platformUsername, { autoCreate = true } = {}) {
    // 1. Try exact platform ID match
    let user = await db.getOne(`
      SELECT u.* FROM users u
      JOIN linked_accounts la ON u.id = la.user_id
      WHERE la.platform = $1 AND la.platform_user_id = $2
    `, [platform, platformUserId]);

    if (user) {
      // Check admin list on every login (in case ADMIN_TWITCH_IDS was updated)
      await this.syncAdminStatus(user.id, platform, platformUserId);
      return user;
    }

    // 2. Try username match on same platform (fallback)
    if (platformUsername) {
      user = await db.getOne(`
        SELECT u.* FROM users u
        JOIN linked_accounts la ON u.id = la.user_id
        WHERE la.platform = $1 AND LOWER(la.platform_username) = LOWER($2)
      `, [platform, platformUsername]);

      if (user) {
        // Update their platform_user_id since we now know it
        await db.query(`
          UPDATE linked_accounts SET platform_user_id = $1
          WHERE user_id = $2 AND platform = $3
        `, [platformUserId, user.id, platform]);
        await this.syncAdminStatus(user.id, platform, platformUserId);
        return user;
      }
    }

    // 3. Auto-create new user
    if (autoCreate) {
      return this.createUser(platform, platformUserId, platformUsername);
    }

    return null;
  }

  /**
   * Create a new user with an initial platform link.
   */
  async createUser(platform, platformUserId, platformUsername) {
    const userId = uuidv4();
    const displayName = platformUsername || `${platform}_${platformUserId}`;

    await db.transaction(async (client) => {
      await client.query(`
        INSERT INTO users (id, display_name)
        VALUES ($1, $2)
      `, [userId, displayName]);

      await client.query(`
        INSERT INTO linked_accounts (user_id, platform, platform_user_id, platform_username, is_primary)
        VALUES ($1, $2, $3, $4, TRUE)
      `, [userId, platform, platformUserId, platformUsername]);

      // Grant default/free items
      await client.query(`
        INSERT INTO user_inventory (user_id, item_id, equipped)
        SELECT $1, id, is_default
        FROM items
        WHERE unlock_type = 'free' AND is_active = TRUE
      `, [userId]);
    });

    // Check admin list
    await this.syncAdminStatus(userId, platform, platformUserId);

    return db.getOne('SELECT * FROM users WHERE id = $1', [userId]);
  }

  /**
   * Sync admin status based on ADMIN_TWITCH_IDS env variable.
   * Runs on every login so changes to the env take effect without recreating accounts.
   */
  async syncAdminStatus(userId, platform, platformUserId) {
    if (platform !== 'twitch') return;
    const adminIds = (process.env.ADMIN_TWITCH_IDS || '').split(',').map(s => s.trim());
    const shouldBeAdmin = adminIds.includes(platformUserId);
    await db.query('UPDATE users SET is_admin = $1 WHERE id = $2', [shouldBeAdmin, userId]);
  }

  /**
   * Link an additional platform account to an existing user.
   */
  async linkAccount(userId, platform, platformUserId, platformUsername, platformEmail) {
    // Check if this platform account is already linked to someone else
    const existing = await db.getOne(`
      SELECT user_id FROM linked_accounts
      WHERE platform = $1 AND platform_user_id = $2
    `, [platform, platformUserId]);

    if (existing) {
      if (existing.user_id === userId) return { success: true, message: 'Already linked' };
      return { success: false, message: 'This account is linked to another user' };
    }

    await db.query(`
      INSERT INTO linked_accounts (user_id, platform, platform_user_id, platform_username, platform_email)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, platform, platformUserId, platformUsername, platformEmail]);

    // Resolve any pending events for this platform identity
    await this.resolvePendingEvents(userId, platform, platformUserId, platformUsername);

    return { success: true, message: 'Account linked successfully' };
  }

  /**
   * Store an event that can't be matched to a user yet.
   */
  async storePendingEvent(platform, platformUserId, platformUsername, eventType, eventData) {
    await db.query(`
      INSERT INTO pending_events (platform, platform_user_id, platform_username, event_type, event_data)
      VALUES ($1, $2, $3, $4, $5)
    `, [platform, platformUserId, platformUsername, eventType, eventData]);
  }

  /**
   * When an account is linked, resolve any pending events.
   */
  async resolvePendingEvents(userId, platform, platformUserId, platformUsername) {
    const pending = await db.getMany(`
      SELECT * FROM pending_events
      WHERE resolved = FALSE
        AND platform = $1
        AND (platform_user_id = $2 OR LOWER(platform_username) = LOWER($3))
    `, [platform, platformUserId, platformUsername]);

    for (const event of pending) {
      const pointsService = require('./points');

      const points = pointsService.calculatePoints(event.event_type, event.platform, event.event_data);
      if (points > 0) {
        await pointsService.awardPoints(userId, points, event.event_type, event.platform, event.event_data);
      }

      await db.query(`
        UPDATE pending_events SET resolved = TRUE, resolved_user_id = $1 WHERE id = $2
      `, [userId, event.id]);
    }

    return pending.length;
  }

  /**
   * Try to match a StreamElements event by email or username.
   */
  async resolveByEmailOrUsername(email, username) {
    if (email) {
      const byEmail = await db.getOne(`
        SELECT u.* FROM users u
        JOIN linked_accounts la ON u.id = la.user_id
        WHERE la.platform_email = $1
      `, [email]);
      if (byEmail) return byEmail;
    }

    if (username) {
      // Try matching username across all platforms
      const byName = await db.getOne(`
        SELECT u.* FROM users u
        JOIN linked_accounts la ON u.id = la.user_id
        WHERE LOWER(la.platform_username) = LOWER($1)
      `, [username]);
      if (byName) return byName;
    }

    return null;
  }
}

module.exports = new IdentityService();
