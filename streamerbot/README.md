# Streamer.bot Integration Guide

This folder contains C# code actions for Streamer.bot to integrate with your Stream Avatar System.

## Setup

1. In Streamer.bot, go to **Settings** and note your Twitch and YouTube connection status
2. Set your API URL and API key in the `_config` action (first action below)
3. Import each action below by creating a new **Action** → add a **Sub-Action** → **Execute C# Code**
4. Assign the appropriate triggers to each action

## Configuration

Before importing actions, you need to set two variables in Streamer.bot:

1. Go to **Actions** → Create a new action called `Avatar System Config`
2. Add a **Set Global Variable** sub-action:
   - Variable: `avatar_api_url` → Value: `http://localhost:3000` (or your server URL)
   - Variable: `avatar_api_key` → Value: (your API_SECRET from .env)

---

## Actions Overview

| Action File | Trigger | Purpose |
|---|---|---|
| `01_on_chat_message.cs` | Twitch Chat Message, YouTube Chat Message | Award points for chatting |
| `02_on_follow.cs` | Twitch Follow | Award follow points |
| `03_on_subscribe.cs` | Twitch Sub, Twitch Re-Sub, YouTube Membership | Award sub points |
| `04_on_gift_sub.cs` | Twitch Gift Sub, Twitch Gift Bomb | Award gift sub points |
| `05_on_cheer.cs` | Twitch Cheer | Award bits points |
| `06_on_raid.cs` | Twitch Raid | Award raid points |
| `07_on_superchat.cs` | YouTube Super Chat | Award superchat points |
| `08_watch_time_ping.cs` | Timed Action (every 10 min) | Batch award watch time for all present viewers |
| `09_chat_commands.cs` | Twitch/YT Chat Command `!points`, `!avatar` | Show points and avatar link |
| `10_on_donation.cs` | StreamElements Tip (if SE integrated in SB) | Award donation points |

---

## How to Import

For each `.cs` file:

1. Create a new **Action** in Streamer.bot
2. Give it the name from the table above
3. Add a **Sub-Action** → **Core** → **Execute C# Code**
4. Paste the contents of the `.cs` file
5. Click **Compile** to verify it works
6. Assign the appropriate **Trigger** to the action

### Trigger Assignments:

- **01_on_chat_message.cs**: 
  - Platform → Twitch → Chat Message
  - Platform → YouTube → Chat Message

- **02_on_follow.cs**:
  - Platform → Twitch → Follow

- **03_on_subscribe.cs**:
  - Platform → Twitch → Subscription, Re-Subscription
  - Platform → YouTube → New Member

- **04_on_gift_sub.cs**:
  - Platform → Twitch → Gift Subscription, Gift Bomb

- **05_on_cheer.cs**:
  - Platform → Twitch → Cheer

- **06_on_raid.cs**:
  - Platform → Twitch → Raid

- **07_on_superchat.cs**:
  - Platform → YouTube → Super Chat

- **08_watch_time_ping.cs**:
  - General → Timed Action → Every 600 seconds (10 minutes)
  - Only run while stream is live

- **09_chat_commands.cs**:
  - Create command triggers for `!points` and `!avatar`

- **10_on_donation.cs**:
  - StreamElements → Tip (if you have SE connected in Streamer.bot)
