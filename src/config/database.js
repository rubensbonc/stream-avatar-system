const { Pool } = require('pg');
const Redis = require('ioredis');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

const redis = new Redis(process.env.REDIS_URL, {
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('Redis error:', err);
});

// Helper for common queries
const db = {
  query: (text, params) => pool.query(text, params),

  getOne: async (text, params) => {
    const { rows } = await pool.query(text, params);
    return rows[0] || null;
  },

  getMany: async (text, params) => {
    const { rows } = await pool.query(text, params);
    return rows;
  },

  transaction: async (callback) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
};

module.exports = { pool, redis, db };
