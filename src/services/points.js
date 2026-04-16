const { db, redis } = require('../config/database');

class PointsService {
  constructor() {
    // Default point values (overridden by env vars)
    this.pointValues = {
      watch_time: parseInt(process.env.POINTS_PER_WATCH_INTERVAL) || 10,
      chat_activity: parseInt(process.env.POINTS_PER_CHAT) || 2,
      follow: parseInt(process.env.POINTS_PER_FOLLOW) || 50,
      subscribe: parseInt(process.env.POINTS_PER_SUB) || 500,
      gift_sub: parseInt(process.env.POINTS_PER_GIFT_SUB) || 300,
      bits: parseInt(process.env.POINTS_PER_100_BITS) || 200,
      donation: parseInt(process.env.POINTS_PER_DOLLAR_DONATION) || 200,
      raid: parseInt(process.env.POINTS_PER_RAID) || 100,
      superchat: parseInt(process.env.POINTS_PER_SUPERCHAT_DOLLAR) || 200,
      youtube_membership: parseInt(process.env.POINTS_PER_YT_MEMBERSHIP) || 500,
    };
  }

  /**
   * Calculate points for an event type.
   */
  calculatePoints(eventType, platform, eventData = {}) {
    let base = 0;

    switch (eventType) {
      case 'watch_time':
        base = this.pointValues.watch_time;
        break;
      case 'chat_activity':
        base = this.pointValues.chat_activity;
        break;
      case 'follow':
        base = this.pointValues.follow;
        break;
      case 'subscribe':
      case 'membership':
        base = this.pointValues.subscribe;
        // Tier multiplier
        const tier = parseInt(eventData?.tier) || 1;
        if (tier === 2) base = Math.floor(base * 2);
        if (tier === 3) base = Math.floor(base * 5);
        break;
      case 'gift_sub':
        base = this.pointValues.gift_sub;
        const giftCount = parseInt(eventData?.count) || 1;
        base *= giftCount;
        break;
      case 'bits':
      case 'cheer':
        const bitAmount = parseInt(eventData?.amount) || 100;
        base = Math.floor((bitAmount / 100) * this.pointValues.bits);
        break;
      case 'donation':
      case 'tip':
        const dollarAmount = parseFloat(eventData?.amount) || 1;
        base = Math.floor(dollarAmount * this.pointValues.donation);
        break;
      case 'superchat':
        const scAmount = parseFloat(eventData?.amount) || 1;
        base = Math.floor(scAmount * this.pointValues.superchat);
        break;
      case 'raid':
        base = this.pointValues.raid;
        break;
      case 'youtube_membership':
        base = this.pointValues.youtube_membership;
        break;
      default:
        base = 0;
    }

    return base;
  }

  /**
   * Award points to a user and log the transaction.
   */
  async awardPoints(userId, amount, reason, platform, metadata = {}) {
    if (amount <= 0) return { success: false, balance: 0 };

    const multiplier = await this.getMultiplier();
    const finalAmount = Math.floor(amount * multiplier);

    const result = await db.transaction(async (client) => {
      const { rows: [updated] } = await client.query(`
        UPDATE users
        SET points_balance = points_balance + $1, updated_at = NOW()
        WHERE id = $2
        RETURNING points_balance
      `, [finalAmount, userId]);

      if (!updated) return null;

      await client.query(`
        INSERT INTO point_transactions (user_id, amount, reason, platform, metadata)
        VALUES ($1, $2, $3, $4, $5)
      `, [userId, finalAmount, reason, platform, JSON.stringify(metadata)]);

      return updated;
    });

    if (!result) return { success: false, balance: 0 };

    return { success: true, balance: result.points_balance, awarded: finalAmount };
  }

  /**
   * Spend points (for shop purchases).
   */
  async spendPoints(userId, amount, reason, metadata = {}) {
    if (amount <= 0) return { success: false, error: 'Invalid amount' };

    const result = await db.transaction(async (client) => {
      const { rows: [updated] } = await client.query(`
        UPDATE users
        SET points_balance = points_balance - $1, updated_at = NOW()
        WHERE id = $2 AND points_balance >= $1
        RETURNING points_balance
      `, [amount, userId]);

      if (!updated) return null;

      await client.query(`
        INSERT INTO point_transactions (user_id, amount, reason, platform, metadata)
        VALUES ($1, $2, $3, 'system', $4)
      `, [userId, -amount, reason, JSON.stringify(metadata)]);

      return updated;
    });

    if (!result) return { success: false, error: 'Insufficient points' };

    return { success: true, balance: result.points_balance };
  }

  /**
   * Get the current global point multiplier.
   */
  async getMultiplier() {
    const cached = await redis.get('economy:multiplier').catch(() => null);
    if (cached) return parseFloat(cached);

    const setting = await db.getOne("SELECT value FROM economy_settings WHERE key = 'points_multiplier'");
    const multiplier = setting ? parseFloat(setting.value) : 1;

    const doubleSetting = await db.getOne("SELECT value FROM economy_settings WHERE key = 'double_points_active'");
    const isDouble = doubleSetting?.value === true || doubleSetting?.value === 'true';

    const finalMultiplier = isDouble ? multiplier * 2 : multiplier;
    await redis.set('economy:multiplier', finalMultiplier, 'EX', 60).catch(err => console.error('Redis error:', err.message));
    return finalMultiplier;
  }

  /**
   * Update watch time and check for streak.
   */
  async creditWatchTime(userId, minutes) {
    const user = await db.getOne('SELECT * FROM users WHERE id = $1', [userId]);
    if (!user) return 1;

    const today = new Date().toISOString().split('T')[0];
    let newStreakDays = user.streak_days;

    if (user.last_stream_date) {
      const lastDateStr = new Date(user.last_stream_date).toISOString().split('T')[0];

      if (lastDateStr === today) {
        // Same day -- no streak change
      } else {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (lastDateStr === yesterdayStr) {
          // Consecutive day -- increment streak
          newStreakDays = user.streak_days + 1;
          await db.query(
            'UPDATE users SET streak_days = $1, last_stream_date = $2 WHERE id = $3 AND last_stream_date != $2',
            [newStreakDays, today, userId]
          );
        } else {
          // Streak broken
          newStreakDays = 1;
          await db.query(
            'UPDATE users SET streak_days = 1, last_stream_date = $1 WHERE id = $2',
            [today, userId]
          );
        }
      }
    } else {
      // First ever watch
      newStreakDays = 1;
      await db.query(
        'UPDATE users SET streak_days = 1, last_stream_date = $1 WHERE id = $2',
        [today, userId]
      );
    }

    await db.query(
      'UPDATE users SET watch_time_minutes = watch_time_minutes + $1, last_seen_at = NOW() WHERE id = $2',
      [minutes, userId]
    );

    // Bonus computed from NEW streak value: day 1 = 1x, day 2 = 1.1x, ... day 11+ = 2x
    const streakBonus = 1 + Math.min((newStreakDays - 1) * 0.1, 1);
    return streakBonus;
  }

  /**
   * Daily spin reward.
   */
  async dailySpin(userId) {
    const cacheKey = `daily_spin:${userId}:${new Date().toISOString().split('T')[0]}`;

    // Atomic set-if-not-exists to prevent double-spin
    const setResult = await redis.set(cacheKey, '1', 'EX', 86400, 'NX').catch(() => null);
    if (!setResult) return { success: false, error: 'Already spun today' };

    const setting = await db.getOne("SELECT value FROM economy_settings WHERE key = 'daily_spin_rewards'");
    const rewards = setting ? JSON.parse(JSON.stringify(setting.value)) : [10, 25, 50, 100, 250, 500];
    const reward = rewards[Math.floor(Math.random() * rewards.length)];

    const result = await this.awardPoints(userId, reward, 'daily_spin', 'system');

    return { success: true, reward, balance: result.balance };
  }
}

module.exports = new PointsService();
