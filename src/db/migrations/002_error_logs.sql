-- ============================================
-- Error Logging System
-- ============================================

CREATE TABLE IF NOT EXISTS error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    error_id VARCHAR(20) NOT NULL UNIQUE,
    severity VARCHAR(10) NOT NULL DEFAULT 'error',
    source VARCHAR(100),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    method VARCHAR(10),
    path VARCHAR(500),
    message TEXT NOT NULL,
    stack TEXT,
    metadata JSONB,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_error_logs_created ON error_logs(created_at DESC);
CREATE INDEX idx_error_logs_resolved ON error_logs(resolved);
CREATE INDEX idx_error_logs_error_id ON error_logs(error_id);
CREATE INDEX idx_error_logs_severity ON error_logs(severity);
