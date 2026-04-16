-- ============================================
-- Stream Avatar System - Initial Migration
-- ============================================

-- Users table (internal identity)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name VARCHAR(255) NOT NULL,
    points_balance INTEGER NOT NULL DEFAULT 0,
    watch_time_minutes INTEGER NOT NULL DEFAULT 0,
    streak_days INTEGER NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    last_stream_date DATE,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Linked platform accounts
CREATE TABLE IF NOT EXISTS linked_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL, -- 'twitch', 'youtube', 'streamelements'
    platform_user_id VARCHAR(255) NOT NULL,
    platform_username VARCHAR(255),
    platform_email VARCHAR(255),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(platform, platform_user_id)
);
CREATE INDEX idx_linked_accounts_lookup ON linked_accounts(platform, platform_user_id);
CREATE INDEX idx_linked_accounts_user ON linked_accounts(user_id);
CREATE INDEX idx_linked_accounts_username ON linked_accounts(platform, platform_username);

-- Cosmetic items catalog
CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    layer_type VARCHAR(50) NOT NULL, -- 'background', 'back_accessory', 'body', 'pants', 'torso', 'face', 'hair', 'hat', 'hand_item', 'effect', 'border'
    layer_order INTEGER NOT NULL DEFAULT 0,
    rarity VARCHAR(50) NOT NULL DEFAULT 'common', -- 'common', 'uncommon', 'rare', 'epic', 'legendary'
    image_filename VARCHAR(255) NOT NULL,
    thumbnail_filename VARCHAR(255),
    unlock_type VARCHAR(50) NOT NULL DEFAULT 'points', -- 'points', 'watch_time', 'sub_only', 'donation', 'event', 'free', 'level'
    unlock_cost INTEGER NOT NULL DEFAULT 0,
    unlock_threshold INTEGER, -- for watch_time: minutes required; for level: level required
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_limited BOOLEAN NOT NULL DEFAULT FALSE,
    available_from TIMESTAMP WITH TIME ZONE,
    available_until TIMESTAMP WITH TIME ZONE,
    category VARCHAR(100),
    tags TEXT[], -- for filtering/searching
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_items_layer ON items(layer_type);
CREATE INDEX idx_items_rarity ON items(rarity);
CREATE INDEX idx_items_active ON items(is_active);

-- User inventory (owned items)
CREATE TABLE IF NOT EXISTS user_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    equipped BOOLEAN NOT NULL DEFAULT FALSE,
    acquired_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, item_id)
);
CREATE INDEX idx_inventory_user ON user_inventory(user_id);
CREATE INDEX idx_inventory_equipped ON user_inventory(user_id, equipped) WHERE equipped = TRUE;

-- Point transaction log
CREATE TABLE IF NOT EXISTS point_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- positive = earn, negative = spend
    reason VARCHAR(100) NOT NULL, -- 'watch_time', 'chat', 'sub', 'donation', 'purchase', 'admin_grant', etc.
    platform VARCHAR(50), -- which platform triggered this
    metadata JSONB, -- extra data (item_id for purchases, donation amount, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_transactions_user ON point_transactions(user_id);
CREATE INDEX idx_transactions_time ON point_transactions(created_at);

-- Pending events (for unlinked accounts)
CREATE TABLE IF NOT EXISTS pending_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(50) NOT NULL,
    platform_user_id VARCHAR(255),
    platform_username VARCHAR(255),
    platform_email VARCHAR(255),
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_user_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_pending_unresolved ON pending_events(resolved) WHERE resolved = FALSE;

-- Active viewer sessions (for watch time tracking)
-- NOTE: This table is currently unused. Watch time is tracked via periodic
-- batch webhook calls from Streamer.bot, not via session tracking.
-- Kept for possible future use.
CREATE TABLE IF NOT EXISTS viewer_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    platform_user_id VARCHAR(255) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_ping_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    minutes_credited INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_active ON viewer_sessions(platform, platform_user_id) WHERE ended_at IS NULL;

-- Economy settings (admin configurable)
CREATE TABLE IF NOT EXISTS economy_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default economy settings
INSERT INTO economy_settings (key, value) VALUES
    ('points_multiplier', '1'::jsonb),
    ('double_points_active', 'false'::jsonb),
    ('daily_spin_enabled', 'true'::jsonb),
    ('daily_spin_rewards', '[10, 25, 50, 100, 250, 500]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Default layer ordering reference
COMMENT ON TABLE items IS 'Layer order guide: 0=background, 1=back_accessory, 2=body, 3=pants, 4=torso, 5=face, 6=hair, 7=hat, 8=hand_item, 9=effect, 10=border';
