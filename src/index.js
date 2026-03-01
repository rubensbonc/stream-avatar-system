require('dotenv').config();

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const fs = require('fs');

const { pool, redis } = require('./config/database');
const websocketService = require('./services/websocket');

const app = express();
const server = http.createServer(app);

// ── Middleware ──
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for overlays
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: process.env.BASE_URL,
  credentials: true,
}));
app.use(morgan('short'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Sessions ──
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && process.env.BASE_URL?.startsWith('https'),
    sameSite: 'lax',
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// ── Static files ──
app.use(express.static(path.join(__dirname, '../public')));

// ── Routes ──
app.use('/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/api/events'));
app.use('/api/users', require('./routes/api/users'));
app.use('/api/shop', require('./routes/api/shop'));
app.use('/api/admin', require('./routes/api/admin'));
app.use('/overlay', require('./routes/overlay'));

// ── Health check ──
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ── SPA fallback (serve index.html for client routes) ──
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/overlay/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Initialize WebSocket ──
websocketService.init(server);

// ── Run migrations on startup ──
async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    const { rows: executed } = await client.query('SELECT filename FROM _migrations ORDER BY id');
    const executedFiles = new Set(executed.map(r => r.filename));

    const migrationsDir = path.join(__dirname, 'db/migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (executedFiles.has(file)) continue;
      console.log(`🔄 Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✅ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Migration failed: ${file}`, err.message);
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

// ── Start ──
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await redis.connect().catch(() => console.log('Redis connecting...'));
    await runMigrations();
    server.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════════════╗
║      Stream Avatar System Running!           ║
║                                              ║
║  Web UI:     http://localhost:${PORT}            ║
║  API:        http://localhost:${PORT}/api         ║
║  Overlays:   http://localhost:${PORT}/overlay     ║
║  WebSocket:  ws://localhost:${PORT}/ws            ║
╚══════════════════════════════════════════════╝
      `);

      // ── Hourly task: deactivate expired limited-time items ──
      async function expireLimitedItems() {
        try {
          const result = await pool.query(`
            UPDATE items SET is_active = FALSE
            WHERE is_limited = TRUE
              AND available_until IS NOT NULL
              AND available_until < NOW()
              AND is_active = TRUE
            RETURNING id, name, available_until
          `);
          if (result.rowCount > 0) {
            console.log(`⏰ Expired ${result.rowCount} limited-time item(s):`,
              result.rows.map(r => r.name).join(', '));
          }
        } catch (err) {
          console.error('Limited item expiry check failed:', err.message);
        }
      }

      // Run once on startup, then every hour
      expireLimitedItems();
      setInterval(expireLimitedItems, 60 * 60 * 1000);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
