'use strict';
const crypto = require('crypto');
const db = require('./db');
const { HttpError, forbidden, parseCookies, setCookie } = require('./http');
const { sha256, token } = require('./util');

const SESSION_DAYS = parseInt(process.env.SESSION_DAYS || '14', 10);
const COOKIE = 'pa_sid';
const SECURE = process.env.NODE_ENV === 'production' || !!process.env.REPLIT_DEPLOYMENT;

// ---------- Password: scrypt con salt casuale ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const key = crypto.scryptSync(pw, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, salt, key] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(key, 'base64');
    const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(expected, got);
  } catch { return false; }
}

// ---------- Ruoli e permessi ----------
const PERMS = {
  admin: ['*'],
  manager: ['dashboard.view', 'dashboard.finance', 'agenda.view', 'agenda.edit', 'clients.view', 'clients.edit', 'clients.export',
    'staff.manage', 'services.manage', 'cash.use', 'cash.reports', 'inventory.manage', 'marketing.manage', 'site.manage',
    'notifications.manage', 'waitlist.manage', 'settings.hours'],
  receptionist: ['dashboard.view', 'agenda.view', 'agenda.edit', 'clients.view', 'clients.edit', 'cash.use', 'waitlist.manage', 'inventory.view'],
  operator: ['dashboard.view', 'agenda.view', 'agenda.own', 'clients.view', 'clients.notes'],
};
const ROLE_LABELS = { admin: 'Amministratore', manager: 'Responsabile salone', receptionist: 'Receptionist', operator: 'Operatore' };

function can(user, perm) {
  if (!user) return false;
  const list = PERMS[user.role] || [];
  return list.includes('*') || list.includes(perm);
}
function require_(user, ...perms) {
  if (!user) throw new HttpError(401, 'Accesso richiesto');
  if (!perms.some(p => can(user, p))) throw forbidden();
}

// ---------- Sessioni ----------
async function createSession(res, user, req) {
  const raw = token(32);
  await db.query(
    `INSERT INTO sessions(token_hash, user_id, tenant_id, expires_at, ip, user_agent)
     VALUES ($1,$2,$3, now() + ($4 || ' days')::interval, $5, $6)`,
    [sha256(raw), user.id, user.tenant_id, String(SESSION_DAYS), req.ip, (req.headers['user-agent'] || '').slice(0, 300)]);
  setCookie(res, COOKIE, raw, { maxAge: SESSION_DAYS * 86400, secure: SECURE });
}
async function destroySession(req, res) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (raw) await db.query('DELETE FROM sessions WHERE token_hash=$1', [sha256(raw)]);
  setCookie(res, COOKIE, '', { maxAge: 0, secure: SECURE });
}
async function loadUser(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (!raw) return null;
  const u = await db.one(
    `SELECT u.id, u.tenant_id, u.username, u.email, u.display_name, u.role, u.staff_id, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash=$1 AND s.expires_at > now()`, [sha256(raw)]);
  if (!u || !u.active) return null;
  // La sessione vale solo per il tenant con cui è stata creata
  if (req.tenant && u.tenant_id !== req.tenant.id) return null;
  return u;
}
async function cleanupSessions() { await db.query('DELETE FROM sessions WHERE expires_at < now()'); }

module.exports = { hashPassword, verifyPassword, PERMS, ROLE_LABELS, can, require: require_, createSession, destroySession, loadUser, cleanupSessions };
