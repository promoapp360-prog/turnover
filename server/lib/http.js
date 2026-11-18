'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const bad = (msg, details) => new HttpError(400, msg, details);
const notFound = (msg = 'Non trovato') => new HttpError(404, msg);
const forbidden = (msg = 'Operazione non autorizzata') => new HttpError(403, msg);
const conflict = (msg, details) => new HttpError(409, msg, details);

// Router minimale con parametri (:id) – nessuna dipendenza esterna
class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  put(p, ...h) { this.add('PUT', p, ...h); }
  patch(p, ...h) { this.add('PATCH', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handlers: r.handlers, params };
    }
    return null;
  }
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Contenuto troppo grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw bad('JSON non valido'); }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')]);
}

function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, headers);
  res.end(body);
}
function json(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}
function html(res, status, body, req) {
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
  if (req && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && body.length > 2048) {
    headers['Content-Encoding'] = 'gzip';
    return send(res, status, zlib.gzipSync(body), headers);
  }
  send(res, status, body, headers);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const staticCache = new Map();
function serveStatic(root) {
  const absRoot = path.resolve(root);
  return (req, res, pathname) => {
    const rel = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(absRoot, rel);
    if (!file.startsWith(absRoot)) return false;
    let st;
    try { st = fs.statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    const key = file + ':' + st.mtimeMs;
    let entry = staticCache.get(key);
    if (!entry) {
      const raw = fs.readFileSync(file);
      const compressible = /text|javascript|json|svg|manifest/.test(MIME[ext] || '');
      entry = { raw, gz: compressible && raw.length > 1024 ? zlib.gzipSync(raw) : null, etag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"` };
      staticCache.set(key, entry);
    }
    if (req.headers['if-none-match'] === entry.etag) { send(res, 304, ''); return true; }
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'ETag': entry.etag,
      'Cache-Control': pathname.includes('/sw.js') ? 'no-cache' : 'public, max-age=300',
    };
    if (entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      headers['Content-Encoding'] = 'gzip';
      send(res, 200, req.method === 'HEAD' ? '' : entry.gz, headers);
    } else send(res, 200, req.method === 'HEAD' ? '' : entry.raw, headers);
    return true;
  };
}

// Rate limiting in memoria (per istanza)
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return key => {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
    e.n++;
    if (e.n > max) throw new HttpError(429, 'Troppe richieste, riprova tra qualche minuto');
  };
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (xf ? xf.split(',')[0] : req.socket.remoteAddress || '').trim();
}

module.exports = { Router, HttpError, bad, notFound, forbidden, conflict, parseJson, readBody, parseCookies, setCookie, send, json, html, serveStatic, rateLimiter, clientIp };
