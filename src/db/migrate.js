const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const localPool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function migrate(externalPool) {
  const p = externalPool || localPool;
  const client = await p.connect();
  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Get already-run migrations
    const { rows: executed } = await client.query('SELECT filename FROM _migrations ORDER BY id');
    const executedFiles = new Set(executed.map(r => r.filename));

    // Read migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (executedFiles.has(file)) {
        console.log(`Skipping ${file} (already executed)`);
        continue;
      }

      console.log(`Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Completed: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Failed: ${file}`, err.message);
        throw err;
      }
    }

    console.log('All migrations complete.');
  } finally {
    client.release();
    if (!externalPool) await localPool.end();
  }
}

module.exports = migrate;

if (require.main === module) {
  migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
