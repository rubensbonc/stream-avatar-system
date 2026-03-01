# Stream Avatar System

A self-hosted loyalty and avatar customization system for streamers. Viewers earn points by watching your streams across **Twitch**, **YouTube**, and **StreamElements**, then spend them on cosmetics to build a custom layered avatar.

## Features

- **Multi-platform support**: Twitch, YouTube, and StreamElements with unified identity
- **Loyalty point economy**: Watch time, chat, subs, bits, donations, raids, superchats
- **Layered avatar system**: 11 cosmetic layers (background, body, pants, torso, hair, hat, etc.)
- **Web portal**: Viewers customize their avatar, browse the shop, view leaderboards
- **OBS overlays**: Alert overlay, avatar showcase, and leaderboard browser sources
- **Admin panel**: Upload cosmetics, manage economy, grant items, view analytics
- **Streamer.bot integration**: Pre-built C# actions for all events
- **Watch streaks**: Bonus multiplier for consecutive stream attendance
- **Daily spin**: Daily random point reward
- **Self-hosted**: Runs entirely on your homelab via Docker

## Architecture

```
Streamer.bot ──webhooks──▶ Backend API ◀── Web Portal (viewers)
     │                        │
     ▼                        ▼
    OBS ◀── Browser Sources   PostgreSQL + Redis
```

## Quick Start

### 1. Prerequisites
- Docker and Docker Compose
- A Twitch Developer Application ([dev.twitch.tv/console](https://dev.twitch.tv/console))
- Streamer.bot installed and connected to Twitch/YouTube

### 2. Clone & Configure

```bash
git clone <your-repo-url> stream-avatar-system
cd stream-avatar-system
cp .env.example .env
```

Edit `.env` with your values:

```env
# Required
TWITCH_CLIENT_ID=your-client-id
TWITCH_CLIENT_SECRET=your-client-secret
SESSION_SECRET=generate-a-random-string
API_SECRET=generate-another-random-string
BASE_URL=http://your-server-ip:3000
ADMIN_TWITCH_IDS=your-twitch-user-id

# Optional (for YouTube support)
YOUTUBE_CLIENT_ID=your-youtube-client-id
YOUTUBE_CLIENT_SECRET=your-youtube-client-secret
```

**Twitch App Setup:**
1. Go to https://dev.twitch.tv/console/apps
2. Create a new application
3. Set the OAuth Redirect URL to `http://your-server-ip:3000/auth/twitch/callback`
4. Copy the Client ID and Client Secret into `.env`

**Finding your Twitch User ID:**
- Visit https://www.streamweasels.com/tools/convert-twitch-username-to-user-id/

### 3. Launch

```bash
docker compose up -d
```

The system will:
- Start PostgreSQL and Redis
- Run database migrations automatically
- Start the web server on port 3000

Visit `http://your-server-ip:3000` to verify it's running.

### 4. Setup Streamer.bot

See the detailed guide in `streamerbot/README.md`.

**Quick version:**
1. Create a global variable `avatar_api_url` = `http://your-server-ip:3000`
2. Create a global variable `avatar_api_key` = your `API_SECRET` from `.env`
3. Create actions and paste the C# code from `streamerbot/actions/`
4. Assign triggers to each action

### 5. Add OBS Overlays

Add these as **Browser Sources** in OBS:

| Source | URL | Suggested Size |
|---|---|---|
| Alerts | `http://your-server-ip:3000/overlay/alerts` | 450×350 |
| Avatar Showcase | `http://your-server-ip:3000/overlay/showcase` | 350×120 |
| Leaderboard | `http://your-server-ip:3000/overlay/leaderboard` | 280×300 |

### 6. Upload Cosmetics

1. Login to the web portal as the admin
2. Go to the Admin tab
3. Upload PNG images for each cosmetic layer

**Important for cosmetic art:**
- All images for the same avatar should use the **same canvas size** (e.g., 256×256 or 512×512)
- Use **transparent backgrounds** (PNG format)
- Layers stack in order: background → back accessories → body → pants → torso → face → hair → hat → hand items → effects → border

## API Reference

### Webhook Events (from Streamer.bot)

```
POST /api/events
Header: x-api-key: your-api-secret

{
  "platform": "twitch" | "youtube" | "streamelements",
  "platform_user_id": "12345",
  "username": "CoolGuy99",
  "event": "chat_activity" | "watch_time" | "subscribe" | "bits" | "donation" | "raid" | ...,
  "data": { "amount": 100, "tier": 1, "minutes": 10 }
}
```

### Batch Watch Time

```
POST /api/events/batch
Header: x-api-key: your-api-secret

{
  "platform": "twitch",
  "event": "watch_time",
  "viewers": [
    { "platform_user_id": "123", "username": "user1" },
    { "platform_user_id": "456", "username": "user2" }
  ],
  "data": { "minutes": 10 }
}
```

### StreamElements Webhooks

```
POST /api/events/streamelements
(No API key needed — configure in StreamElements dashboard)
```

### Public Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/users/leaderboard?type=points` | Top viewers |
| `GET /overlay/avatar/:username` | Avatar data (for overlays) |
| `GET /api/health` | Health check |

### Authenticated Endpoints (require session)

| Endpoint | Description |
|---|---|
| `GET /api/users/me` | Current user profile |
| `GET /api/users/me/inventory` | User's owned items |
| `GET /api/users/me/avatar` | Equipped items |
| `POST /api/users/me/equip/:itemId` | Equip item |
| `POST /api/users/me/daily-spin` | Daily point spin |
| `GET /api/shop` | Browse shop |
| `POST /api/shop/:itemId/purchase` | Buy item |

### Admin Endpoints (require admin session)

| Endpoint | Description |
|---|---|
| `POST /api/admin/items` | Upload cosmetic (multipart form) |
| `GET /api/admin/stats` | Dashboard statistics |
| `POST /api/admin/economy/multiplier` | Set point multiplier |
| `POST /api/admin/economy/double-points` | Toggle double points |
| `POST /api/admin/grant-points` | Grant points to user |
| `POST /api/admin/grant-item` | Grant item to user |

## Point Economy (Defaults)

| Action | Points |
|---|---|
| Watch 10 minutes | 10 |
| Chat message (1min cooldown) | 2 |
| Follow | 50 |
| Subscribe / Membership | 500 (×2 T2, ×5 T3) |
| Gift sub | 300 per gift |
| 100 bits | 200 |
| $1 donation | 200 |
| Raid | 100 |
| $1 Super Chat | 200 |
| Watch streak bonus | Up to 2× at 10-day streak |

All values configurable in `.env`.

## File Structure

```
stream-avatar-system/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── src/
│   ├── index.js              # Express server
│   ├── config/database.js     # PG + Redis config
│   ├── middleware/auth.js     # Auth middleware
│   ├── routes/
│   │   ├── auth.js            # Twitch OAuth + account linking
│   │   ├── overlay.js         # OBS overlay routes
│   │   └── api/
│   │       ├── events.js      # Webhook receiver
│   │       ├── users.js       # User profiles + leaderboard
│   │       ├── shop.js        # Item shop
│   │       └── admin.js       # Admin panel API
│   ├── services/
│   │   ├── identity.js        # Multi-platform identity resolution
│   │   ├── points.js          # Point economy
│   │   ├── inventory.js       # Item management
│   │   └── websocket.js       # Real-time overlay updates
│   └── db/
│       ├── migrate.js
│       └── migrations/
│           └── 001_initial.sql
├── public/
│   ├── index.html             # Main web app
│   ├── css/app.css
│   ├── js/app.js
│   ├── overlays/
│   │   ├── alerts.html        # OBS alert overlay
│   │   ├── showcase.html      # OBS avatar showcase
│   │   └── leaderboard.html   # OBS leaderboard
│   └── assets/cosmetics/      # Uploaded cosmetic PNGs
└── streamerbot/
    ├── README.md
    └── actions/
        ├── 01_on_chat_message.cs
        ├── 02_on_follow.cs
        ├── 03_on_subscribe.cs
        ├── 04_on_gift_sub.cs
        ├── 05_on_cheer.cs
        ├── 06_on_raid.cs
        ├── 07_on_superchat.cs
        ├── 08_watch_time_ping.cs
        ├── 09_chat_commands.cs
        └── 10_on_donation.cs
```

## Troubleshooting

**"Invalid API key" from Streamer.bot actions:**
Make sure your `avatar_api_key` global variable in Streamer.bot matches the `API_SECRET` in `.env`.

**Twitch login not working:**
Verify your OAuth redirect URL in the Twitch dev console matches `{BASE_URL}/auth/twitch/callback`.

**Points not awarding for lurkers:**
The watch time ping (action 08) must be set as a Timed Action running every 600 seconds, and should only run while your stream is live.

**StreamElements donations not matching:**
Viewers need to link their SE email in the web portal Settings page. Unmatched donations are held in a pending queue and auto-resolved when they link.

**Container won't start:**
Check logs with `docker compose logs app`. Common issues: incorrect DATABASE_URL or missing env vars.

## License

MIT
