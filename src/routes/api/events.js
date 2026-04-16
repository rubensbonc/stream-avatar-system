const express = require('express');
const { requireApiKey } = require('../../middleware/auth');
const identityService = require('../../services/identity');
const pointsService = require('../../services/points');
const inventoryService = require('../../services/inventory');
const websocketService = require('../../services/websocket');
const errorLogger = require('../../services/errorLogger');
const { db, redis } = require('../../config/database');

const router = express.Router();

/**
 * POST /api/events
 * Main webhook endpoint for Streamer.bot and StreamElements events.
 *
 * Body: {
 *   platform: "twitch" | "youtube" | "streamelements",
 *   platform_user_id: "12345",
 *   username: "CoolGuy99",
 *   event: "subscribe" | "chat_activity" | "watch_time" | "bits" | "donation" | ...,
 *   data: { amount, tier, count, minutes, message, email, ... }
 * }
 */
router.post('/', requireApiKey, async (req, res) => {
  try {
    const { platform, platform_user_id, username, event, data = {} } = req.body;

    if (!platform || !event) {
      return res.status(400).json({ error: 'platform and event are required' });
    }

    // ── Chat cooldown check ──
    if (event === 'chat_activity') {
      const cooldownKey = `chat_cd:${platform}:${platform_user_id}`;
      const onCooldown = await redis.get(cooldownKey).catch(() => null);
      if (onCooldown) {
        return res.json({ status: 'cooldown', points_awarded: 0 });
      }
      await redis.set(cooldownKey, '1', 'EX', 60).catch(err => console.error('Redis error:', err.message)); // 60s cooldown
    }

    // ── Resolve identity ──
    let user;

    if (platform === 'streamelements') {
      // SE events might come with email instead of platform ID
      user = await identityService.resolveByEmailOrUsername(data?.email, username);
      if (!user) {
        await identityService.storePendingEvent(platform, platform_user_id || '', username, event, data);
        return res.json({ status: 'pending', reason: 'unlinked_account' });
      }
    } else {
      // Twitch/YouTube — auto-create if new
      if (!platform_user_id && !username) {
        return res.status(400).json({ error: 'platform_user_id or username required' });
      }
      user = await identityService.resolveUser(platform, platform_user_id, username);
    }

    // ── Calculate and award points ──
    const points = pointsService.calculatePoints(event, platform, data);
    let awarded = 0;
    let newBalance = user.points_balance;

    if (points > 0) {
      const result = await pointsService.awardPoints(user.id, points, event, platform, data);
      if (result.success) {
        awarded = result.awarded;
        newBalance = result.balance;
      }
    }

    // ── Handle watch time ──
    if (event === 'watch_time') {
      const minutes = parseInt(data?.minutes) || parseInt(process.env.WATCH_INTERVAL_MINUTES) || 10;
      await pointsService.creditWatchTime(user.id, minutes);

      // Check for auto-unlocks based on watch time
      const newUnlocks = await inventoryService.checkAutoUnlocks(user.id);
      if (newUnlocks.length > 0) {
        websocketService.broadcast('alerts', 'new_unlock', {
          user: { id: user.id, display_name: user.display_name },
          items: newUnlocks.map(i => ({ name: i.name, rarity: i.rarity, image: i.image_filename })),
          platform,
        });
      }
    }

    // ── Broadcast notable events to overlays ──
    if (['subscribe', 'bits', 'donation', 'gift_sub', 'superchat', 'membership', 'raid'].includes(event)) {
      websocketService.broadcast('alerts', 'point_event', {
        user: { id: user.id, display_name: user.display_name },
        event,
        platform,
        points_awarded: awarded,
        data,
      });
    }

    // ── Update last seen ──
    await db.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [user.id]);

    res.json({
      status: 'ok',
      user_id: user.id,
      display_name: user.display_name,
      points_awarded: awarded,
      new_balance: newBalance,
    });

  } catch (err) {
    const errorId = await errorLogger.logError(err, { req, source: 'events.post' });
    res.status(500).json({ error: 'Internal server error', error_id: errorId });
  }
});

/**
 * POST /api/events/batch
 * Batch endpoint for watch time pings (all present viewers at once).
 *
 * Body: {
 *   platform: "twitch" | "youtube",
 *   event: "watch_time",
 *   viewers: [
 *     { platform_user_id: "123", username: "user1" },
 *     { platform_user_id: "456", username: "user2" },
 *   ],
 *   data: { minutes: 10 }
 * }
 */
router.post('/batch', requireApiKey, async (req, res) => {
  try {
    const { platform, event, viewers = [], data = {} } = req.body;

    if (!platform || !event || !Array.isArray(viewers)) {
      return res.status(400).json({ error: 'platform, event, and viewers[] required' });
    }

    let processed = 0;
    let errors = 0;
    const CHUNK_SIZE = 10;

    for (let i = 0; i < viewers.length; i += CHUNK_SIZE) {
      const chunk = viewers.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(chunk.map(async (viewer) => {
        const user = await identityService.resolveUser(
          platform,
          viewer.platform_user_id,
          viewer.username
        );

        const points = pointsService.calculatePoints(event, platform, data);
        if (points > 0) {
          await pointsService.awardPoints(user.id, points, event, platform, data);
        }

        if (event === 'watch_time') {
          const minutes = parseInt(data?.minutes) || 10;
          await pointsService.creditWatchTime(user.id, minutes);
          await inventoryService.checkAutoUnlocks(user.id);
        }

        await db.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [user.id]);
      }));

      results.forEach(r => {
        if (r.status === 'fulfilled') processed++;
        else {
          errors++;
          console.error('Batch viewer error:', r.reason?.message);
        }
      });
    }

    res.json({ status: 'ok', processed, errors, total: viewers.length });

  } catch (err) {
    const errorId = await errorLogger.logError(err, { req, source: 'events.batch' });
    res.status(500).json({ error: 'Internal server error', error_id: errorId });
  }
});

/**
 * POST /api/events/streamelements
 * Dedicated endpoint for StreamElements webhooks.
 */
router.post('/streamelements', requireApiKey, async (req, res) => {
  try {
    const event = req.body;
    // SE sends different event structures
    const eventType = event.type; // 'tip', 'subscriber', 'cheer', etc.
    const username = event.data?.username || event.data?.displayName;
    const email = event.data?.email;
    const amount = event.data?.amount;

    if (!eventType) {
      return res.status(400).json({ error: 'Invalid StreamElements event' });
    }

    // Map SE event types to our event types
    const eventMap = {
      'tip': 'donation',
      'subscriber': 'subscribe',
      'cheer': 'bits',
      'host': 'raid',
      'raid': 'raid',
    };

    const mappedEvent = eventMap[eventType] || eventType;

    // Try to resolve user
    let user = await identityService.resolveByEmailOrUsername(email, username);

    if (!user) {
      await identityService.storePendingEvent(
        'streamelements', '', username, mappedEvent,
        { amount, email, original_type: eventType }
      );
      return res.json({ status: 'pending', reason: 'unlinked_account' });
    }

    const points = pointsService.calculatePoints(mappedEvent, 'streamelements', { amount });
    if (points > 0) {
      await pointsService.awardPoints(user.id, points, mappedEvent, 'streamelements', { amount });
    }

    websocketService.broadcast('alerts', 'point_event', {
      user: { id: user.id, display_name: user.display_name },
      event: mappedEvent,
      platform: 'streamelements',
      points_awarded: points,
      data: { amount },
    });

    res.json({ status: 'ok' });

  } catch (err) {
    const errorId = await errorLogger.logError(err, { req, source: 'events.streamelements' });
    res.status(500).json({ error: 'Internal server error', error_id: errorId });
  }
});

module.exports = router;
