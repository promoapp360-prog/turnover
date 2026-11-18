'use strict';
const http = require('http');
const path = require('path');
const db = require('./lib/db');
const log = require('./lib/log');
const H = require('./lib/http');
const auth = require('./lib/auth');
const tenants = require('./lib/tenant');
const scheduler = require('./lib/scheduler');

const router = new H.Router();
require('./routes/auth')(router);
require('./routes/public-api')(router);
require('./routes/admin-core')(router);
require('./routes/admin-agenda')(router);
require('./routes/admin-clients')(router);
require('./routes/admin-cash')(router);
require('./routes/admin-reports')(router);
const site = require('./routes/site');

const staticPublic = H.serveStatic(path.join(__dirname, '..', 'public'));

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-src https://www.google.com https://maps.google.com",
    "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
  ].join('; '),
};
if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000';

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function handle(req, res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  req.query = Object.fromEntries(url.searchParams);
  req.ip = H.clientIp(req);

  if (pathname === '/healthz') return H.json(res, 200, { ok: true });

  // file statici
  if ((req.method === 'GET' || req.method === 'HEAD') && /^\/(assets|admin\/assets)\//.test(pathname) && staticPublic(req, res, pathname)) return;
  if ((req.method === 'GET' || req.method === 'HEAD') && ['/sw.js', '/manifest.webmanifest', '/robots.txt', '/favicon.svg'].includes(pathname)) {
    if (pathname === '/manifest.webmanifest' || pathname === '/robots.txt') { /* generati dinamicamente sotto */ }
    else if (staticPublic(req, res, pathname)) return;
  }

  req.tenant = await tenants.resolve(req.headers.host);
  if (!req.tenant) return H.html(res, 503, '<h1>Configurazione iniziale in corso</h1><p>Esegui <code>npm run seed</code>.</p>');

  if (pathname.startsWith('/api/')) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!sameOrigin(req)) throw H.forbidden('Origine non valida');
      if (!pathname.startsWith('/api/cron/') && req.headers['x-requested-with'] !== 'PromoApp') throw H.forbidden('Richiesta non valida');
    }
    req.user = await auth.loadUser(req);
    const m = router.match(req.method, pathname);
    if (!m) throw H.notFound('Endpoint inesistente');
    req.params = m.params;
    for (const h of m.handlers) {
      const out = await h(req, res);
      if (res.writableEnded || res.headersSent) return;
      if (out !== undefined) return H.json(res, 200, out);
    }
    return;
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return staticPublic(req, res, '/admin/index.html') || H.send(res, 404, 'Not found');
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    req.user = await auth.loadUser(req);
    return site.render(req, res, pathname);
  }
  throw H.notFound();
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    const status = err.status || 500;
    if (status >= 500) log.error(`${req.method} ${req.url}`, err);
    if (res.headersSent) { try { res.end(); } catch (_) { /* ignore */ } return; }
    const isApi = (req.url || '').startsWith('/api/');
    if (isApi) return H.json(res, status, { error: status >= 500 ? 'Errore interno. Riprova tra poco.' : err.message, details: err.details });
    return site.errorPage(req, res, status, status >= 500 ? 'Si è verificato un errore. Riprova tra poco.' : err.message);
  });
});
server.requestTimeout = 60000;
server.headersTimeout = 65000;

async function main() {
  await db.migrate();
  const count = await db.one('SELECT count(*)::int AS n FROM tenants');
  if (!count.n) {
    log.info('Database vuoto: eseguo il seed iniziale');
    await require('./seed').run();
  }
  const port = parseInt(process.env.PORT || '3000', 10);
  server.listen(port, '0.0.0.0', () => log.info(`PromoApp Salon Suite in ascolto su :${port}`));
  if (process.env.DISABLE_SCHEDULER !== '1') scheduler.start();
}

if (require.main === module) {
  main().catch(e => { log.error('Avvio fallito', e); process.exit(1); });
}
module.exports = { server, main };
