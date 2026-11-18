'use strict';
const db = require('../lib/db');
const H = require('../lib/http');
const auth = require('../lib/auth');
const U = require('../lib/util');
const notifications = require('../lib/notifications');

const loginLimiter = H.rateLimiter({ windowMs: 15 * 60000, max: 20 });

module.exports = function (r) {
  r.post('/api/auth/login', async (req, res) => {
    loginLimiter(req.ip);
    const b = await H.parseJson(req);
    const username = U.str(b.username, { required: true, max: 100, name: 'Utente' });
    const password = U.str(b.password, { required: true, max: 200, name: 'Password' });
    const u = await db.one('SELECT * FROM users WHERE tenant_id=$1 AND (lower(username)=lower($2) OR lower(email)=lower($2))', [req.tenant.id, username]);
    if (u && u.locked_until && new Date(u.locked_until) > new Date()) throw new H.HttpError(429, 'Account temporaneamente bloccato per troppi tentativi. Riprova tra 15 minuti.');
    if (!u || !u.active || !auth.verifyPassword(password, u.password_hash)) {
      if (u) await db.query(`UPDATE users SET failed_logins=failed_logins+1,
                               locked_until = CASE WHEN failed_logins+1 >= 8 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id=$1`, [u.id]);
      await db.query('INSERT INTO audit_log(tenant_id, action, data, ip) VALUES ($1,$2,$3,$4)', [req.tenant.id, 'login_failed', { username }, req.ip]);
      throw new H.HttpError(401, 'Credenziali non valide');
    }
    await db.query('UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=now() WHERE id=$1', [u.id]);
    await auth.createSession(res, u, req);
    await db.query('INSERT INTO audit_log(tenant_id, user_id, action, ip) VALUES ($1,$2,$3,$4)', [req.tenant.id, u.id, 'login', req.ip]);
    return { ok: true };
  });

  r.post('/api/auth/logout', async (req, res) => {
    await auth.destroySession(req, res);
    return { ok: true };
  });

  r.get('/api/auth/me', async req => {
    if (!req.user) throw new H.HttpError(401, 'Accesso richiesto');
    const perms = auth.PERMS[req.user.role];
    return {
      user: { ...req.user, role_label: auth.ROLE_LABELS[req.user.role] },
      permissions: perms,
      tenant: { id: req.tenant.id, name: req.tenant.name, slug: req.tenant.slug, brand: req.tenant.settings.brand, modules: req.tenant.modules, is_demo: req.tenant.is_demo },
      providers: notifications.providers(),
    };
  });

  r.post('/api/auth/password', async req => {
    auth.require(req.user, 'dashboard.view');
    const b = await H.parseJson(req);
    const u = await db.one('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!auth.verifyPassword(String(b.current || ''), u.password_hash)) throw H.bad('Password attuale errata');
    const np = U.str(b.password, { required: true, min: 5, max: 200, name: 'Nuova password' });
    await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [u.id, auth.hashPassword(np)]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
    return { ok: true, relogin: true };
  });
};
