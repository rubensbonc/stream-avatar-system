const express = require('express');
const passport = require('passport');
const TwitchStrategy = require('passport-twitch-new').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const identityService = require('../services/identity');
const { db } = require('../config/database');
const { requireAuth, getCurrentUser } = require('../middleware/auth');

const router = express.Router();

// ── Passport Setup ──────────────────────────────────

passport.serializeUser((user, done) => {
  // Link mode passes raw profile data, not a real user
  if (user._linkProfile) return done(null, JSON.stringify(user));
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    // Check if this is a link profile (JSON string)
    if (typeof id === 'string' && id.startsWith('{')) {
      return done(null, JSON.parse(id));
    }
    const user = await db.getOne('SELECT * FROM users WHERE id = $1', [id]);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// Twitch OAuth Strategy
if (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) {
  passport.use('twitch', new TwitchStrategy({
    clientID: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    callbackURL: `${process.env.BASE_URL}/auth/twitch/callback`,
    scope: 'user_read',
    passReqToCallback: true,
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      // If linking, don't resolve/create — just pass profile data through
      if (req.session.linkMode && req.session.userId) {
        return done(null, {
          _linkProfile: true,
          platform: 'twitch',
          platformUserId: profile.id,
          platformUsername: profile.display_name || profile.login,
        });
      }
      const user = await identityService.resolveUser(
        'twitch',
        profile.id,
        profile.display_name || profile.login
      );
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  }));
}

// Google/YouTube OAuth Strategy
if (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) {
  passport.use('google', new GoogleStrategy({
    clientID: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    callbackURL: `${process.env.BASE_URL}/auth/youtube/callback`,
    scope: ['profile', 'https://www.googleapis.com/auth/youtube.readonly'],
    passReqToCallback: true,
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      // Fetch the actual YouTube channel name using the access token
      let channelName = profile.displayName;
      let channelId = profile.id;
      try {
        const fetch = require('node-fetch');
        const ytRes = await fetch(
          'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const ytData = await ytRes.json();
        if (ytData.items && ytData.items.length > 0) {
          channelName = ytData.items[0].snippet.title;
          channelId = ytData.items[0].id;
        }
      } catch (ytErr) {
        console.warn('[Auth] Could not fetch YouTube channel name, using Google profile name:', ytErr.message);
      }

      // If linking, don't resolve/create — just pass profile data through
      if (req.session.linkMode && req.session.userId) {
        return done(null, {
          _linkProfile: true,
          platform: 'youtube',
          platformUserId: channelId,
          platformUsername: channelName,
        });
      }
      const user = await identityService.resolveUser(
        'youtube',
        channelId,
        channelName
      );
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  }));
}

// ── Routes ──────────────────────────────────────────

// Twitch login
router.get('/twitch', passport.authenticate('twitch'));

router.get('/twitch/callback', (req, res, next) => {
  // Capture session values BEFORE passport regenerates the session
  const linkMode = req.session.linkMode;
  const linkUserId = req.session.userId;

  passport.authenticate('twitch', async (err, user, info) => {
    if (err || !user) return res.redirect('/?error=auth_failed');

    if (user._linkProfile && linkMode && linkUserId) {
      // Link flow — don't log in as new user, just link the account
      try {
        await identityService.linkAccount(
          linkUserId,
          user.platform,
          user.platformUserId,
          user.platformUsername
        );
        req.session.linkMode = false;
        req.session.userId = linkUserId;
        res.redirect('/?linked=twitch');
      } catch (e) {
        res.redirect('/?error=link_failed');
      }
      return;
    }

    // Normal login flow
    req.logIn(user, (err) => {
      if (err) return res.redirect('/?error=auth_failed');
      req.session.userId = user.id;
      res.redirect('/');
    });
  })(req, res, next);
});

// YouTube login
router.get('/youtube', passport.authenticate('google'));

router.get('/youtube/callback', (req, res, next) => {
  // Capture session values BEFORE passport regenerates the session
  const linkMode = req.session.linkMode;
  const linkUserId = req.session.userId;

  passport.authenticate('google', async (err, user, info) => {
    if (err || !user) return res.redirect('/?error=auth_failed');

    if (user._linkProfile && linkMode && linkUserId) {
      // Link flow — don't log in as new user, just link the account
      try {
        await identityService.linkAccount(
          linkUserId,
          user.platform,
          user.platformUserId,
          user.platformUsername
        );
        req.session.linkMode = false;
        req.session.userId = linkUserId;
        res.redirect('/?linked=youtube');
      } catch (e) {
        res.redirect('/?error=link_failed');
      }
      return;
    }

    // Normal login flow
    req.logIn(user, (err) => {
      if (err) return res.redirect('/?error=auth_failed');
      req.session.userId = user.id;
      res.redirect('/');
    });
  })(req, res, next);
});

// ── OAuth Account Linking (sets link mode then redirects to OAuth) ──

router.get('/link/twitch/oauth', requireAuth, (req, res, next) => {
  req.session.linkMode = true;
  req.session.save(() => {
    passport.authenticate('twitch')(req, res, next);
  });
});

router.get('/link/youtube/oauth', requireAuth, (req, res, next) => {
  req.session.linkMode = true;
  req.session.save(() => {
    passport.authenticate('google')(req, res, next);
  });
});

// YouTube account linking (manual token exchange)
router.post('/link/youtube', requireAuth, async (req, res) => {
  const { youtube_channel_id, youtube_username } = req.body;
  if (!youtube_channel_id) {
    return res.status(400).json({ error: 'YouTube channel ID required' });
  }

  const result = await identityService.linkAccount(
    req.session.userId,
    'youtube',
    youtube_channel_id,
    youtube_username
  );

  res.json(result);
});

// StreamElements account linking (by email)
router.post('/link/streamelements', requireAuth, async (req, res) => {
  const { email, username } = req.body;
  if (!email && !username) {
    return res.status(400).json({ error: 'Email or username required' });
  }

  const result = await identityService.linkAccount(
    req.session.userId,
    'streamelements',
    email || username,
    username,
    email
  );

  res.json(result);
});

// Get current user
router.get('/me', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.json({ authenticated: false });
  res.json({ authenticated: true, user });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

module.exports = router;
