-- ============================================
-- Add hide_from_leaderboard flag to users
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_from_leaderboard BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_hide_leaderboard ON users(hide_from_leaderboard) WHERE hide_from_leaderboard = FALSE;
