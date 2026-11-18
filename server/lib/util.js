'use strict';
const crypto = require('crypto');
const { bad } = require('./http');

const TZ = process.env.APP_TIMEZONE || 'Europe/Rome';

// ---------- Date / fuso orario ----------
function tzOffsetMin(date, tz = TZ) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}
// 'YYYY-MM-DD' + 'HH:MM' locali -> Date UTC
function localToUtc(dateStr, timeStr, tz = TZ) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMin(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = tzOffsetMin(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}
function localParts(date, tz = TZ) {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: wd };
}
function todayLocal(tz = TZ) { return localParts(new Date(), tz).date; }
function weekdayOf(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function minToHHMM(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function fmtDateIt(date, tz = TZ) {
  return new Intl.DateTimeFormat('it-IT', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}
function fmtTimeIt(date, tz = TZ) {
  return new Intl.DateTimeFormat('it-IT', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(date);
}
function euro(cents) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);
}

// ---------- Validazione ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(v, { max = 500, min = 0, required = false, name = 'campo' } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} obbligatorio`);
    return null;
  }
  const s = String(v).trim();
  if (required && !s) throw bad(`${name} obbligatorio`);
  if (s.length > max) throw bad(`${name}: massimo ${max} caratteri`);
  if (s.length < min) throw bad(`${name}: minimo ${min} caratteri`);
  return s || null;
}
function int(v, { min = -2147483648, max = 2147483647, required = false, name = 'valore' } = {}) {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${name} obbligatorio`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} non valido`);
  return n;
}
function num(v, { min = -1e12, max = 1e12, required = false, name = 'valore' } = {}) {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${name} obbligatorio`); return null; }
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} non valido`);
  return n;
}
function date(v, { required = false, name = 'data' } = {}) {
  if (!v) { if (required) throw bad(`${name} obbligatoria`); return null; }
  if (!DATE_RE.test(v) || isNaN(Date.parse(v + 'T00:00:00Z'))) throw bad(`${name} non valida`);
  return v;
}
function email(v, { required = false } = {}) {
  const s = str(v, { max: 200, required, name: 'Email' });
  if (s && !EMAIL_RE.test(s)) throw bad('Email non valida');
  return s ? s.toLowerCase() : null;
}
function phone(v, { required = false } = {}) {
  const s = str(v, { max: 30, required, name: 'Telefono' });
  if (s && normPhone(s).replace(/\D/g, '').length < 6) throw bad('Telefono non valido');
  return s;
}
function normPhone(p) {
  if (!p) return null;
  let d = String(p).replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (!d.startsWith('+')) d = '+39' + d.replace(/^0+(?=3)/, '');
  return d;
}
function bool(v) { return v === true || v === 'true' || v === 1 || v === '1' || v === 'on'; }
function oneOf(v, list, name = 'valore') { if (!list.includes(v)) throw bad(`${name} non valido`); return v; }
function cents(v, opts = {}) { const n = num(v, { min: 0, max: 1e7, ...opts }); return n === null ? null : Math.round(n * 100); }

// ---------- Varie ----------
function token(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function giftCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const b = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) s += alphabet[b[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? ''));
}
function deepMerge(base, over) {
  if (Array.isArray(over) || typeof over !== 'object' || over === null) return over === undefined ? base : over;
  const out = { ...(base || {}) };
  for (const k of Object.keys(over)) out[k] = deepMerge(base ? base[k] : undefined, over[k]);
  return out;
}

module.exports = {
  TZ, tzOffsetMin, localToUtc, localParts, todayLocal, weekdayOf, addDays, toMin, minToHHMM, fmtDateIt, fmtTimeIt, euro,
  str, int, num, date, email, phone, normPhone, bool, oneOf, cents, DATE_RE, TIME_RE,
  token, sha256, giftCode, escapeHtml, renderTemplate, deepMerge,
};
