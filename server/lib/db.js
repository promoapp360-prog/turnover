'use strict';
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');
const log = require('./log');

// int8 -> number, numeric -> number, date -> stringa 'YYYY-MM-DD' (nessuna conversione di fuso)
types.setTypeParser(20, v => parseInt(v, 10));
types.setTypeParser(1700, v => parseFloat(v));
types.setTypeParser(1082, v => v);

if (!process.env.DATABASE_URL) {
  log.error('DATABASE_URL non impostata. Su Replit apri il pannello "Database" e crea un database PostgreSQL.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
});
pool.on && pool.on('error', e => log.error('Errore pool database', e));

async function query(text, params) {
  return pool.query(text, params);
}
async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}
async function many(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

// Esegue fn(client) in una transazione; client espone query/one/many.
async function tx(fn) {
  const client = await pool.connect();
  const c = {
    query: (t, p) => client.query(t, p),
    one: async (t, p) => (await client.query(t, p)).rows[0] || null,
    many: async (t, p) => (await client.query(t, p)).rows,
  };
  try {
    await client.query('BEGIN');
    const res = await fn(c);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

async function migrate() {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), skipped BOOLEAN NOT NULL DEFAULT false)`);
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const done = new Set((await many('SELECT name FROM schema_migrations')).map(r => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const optional = sql.startsWith('-- @optional');
    try {
      await tx(async c => {
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      });
      log.info(`Migrazione applicata: ${f}`);
    } catch (e) {
      if (!optional) throw e;
      log.warn(`Migrazione opzionale ${f} non applicata: ${e.message}`);
      await query('INSERT INTO schema_migrations(name, skipped) VALUES ($1, true)', [f]);
    }
  }
}

module.exports = { pool, query, one, many, tx, migrate };
