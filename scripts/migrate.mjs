// Applies migrations/*.sql in order, once each, recording them in schema_migrations.
// Uses the direct (unpooled) connection, as Neon recommends for schema changes.
//   node --env-file=.env.local scripts/migrate.mjs
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set. Run `neon env pull` first.');
  process.exit(1);
}
const dir = new URL('../migrations/', import.meta.url);
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) { console.log(`skip    ${file}`); continue; }
    const sql = await readFile(new URL(file, dir), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
} finally {
  await client.end();
}
