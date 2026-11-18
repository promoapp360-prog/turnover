'use strict';
// Backup del database con pg_dump (disponibile su Replit col modulo postgresql).
// Uso: npm run backup  ->  crea backups/backup-AAAAMMGG-HHMM.sql.gz
// Ripristino: gunzip -c backups/FILE.sql.gz | psql "$DATABASE_URL"
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL non impostata'); process.exit(1); }
const dir = path.join(__dirname, '..', 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
const file = path.join(dir, `backup-${stamp}.sql.gz`);
const dump = spawn('pg_dump', ['--no-owner', '--no-privileges', process.env.DATABASE_URL], { stdio: ['ignore', 'pipe', 'inherit'] });
dump.on('error', e => { console.error('pg_dump non disponibile:', e.message); process.exit(1); });
dump.stdout.pipe(zlib.createGzip()).pipe(fs.createWriteStream(file)).on('finish', () => {
  console.log(`Backup creato: ${file}`);
  // conserva solo gli ultimi 14 backup
  const old = fs.readdirSync(dir).filter(f => f.startsWith('backup-')).sort().slice(0, -14);
  old.forEach(f => fs.unlinkSync(path.join(dir, f)));
});
dump.on('close', code => { if (code) { console.error(`pg_dump terminato con codice ${code}`); process.exit(code); } });
