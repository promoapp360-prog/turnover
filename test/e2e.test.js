'use strict';
// Test end-to-end su database PostgreSQL reale.
// Uso: TEST_DATABASE_URL=postgres://... npm test   (il database viene svuotato!)
const test = require('node:test');
const assert = require('node:assert');

if (!process.env.TEST_DATABASE_URL) {
  test('e2e (saltato: imposta TEST_DATABASE_URL)', { skip: true }, () => {});
  return;
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DISABLE_SCHEDULER = '1';
process.env.PORT = '0';

const db = require('../server/lib/db');
const U = require('../server/lib/util');
let base; let cookie = '';

async function api(method, path, body, { auth = false, raw = false } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'PromoApp' };
  if (auth) headers.Cookie = cookie;
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.includes('pa_sid=')) cookie = sc.split(';')[0];
  if (raw) return r;
  const data = await r.json().catch(() => null);
  return { status: r.status, data };
}

function nextOpenDate(hoursOk = [2, 3, 4, 5]) {
  let d = U.addDays(U.todayLocal(), 2);
  while (!hoursOk.includes(U.weekdayOf(d))) d = U.addDays(d, 1);
  return d;
}

test('flusso completo', async t => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const { server, main } = require('../server/index');
  await main();
  await new Promise(r => setTimeout(r, 200));
  base = `http://127.0.0.1:${server.address().port}`;

  const cat = (await api('GET', '/api/public/catalog')).data;
  const colore = cat.services.find(s => s.name === 'Colore completo');
  const taglioUomo = cat.services.find(s => s.name === 'Taglio uomo');
  const date = nextOpenDate();

  await t.test('disponibilità rispetta gli orari', async () => {
    const av = (await api('GET', `/api/public/availability?date=${date}&services=${colore.id}`)).data;
    assert.ok(av.slots.length > 0);
    assert.strictEqual(av.slots[0].time, '09:00');
    const last = av.slots[av.slots.length - 1].time;
    assert.ok(U.toMin(last) + 90 <= U.toMin('18:00'), 'il servizio deve finire entro la chiusura');
  });

  let token;
  await t.test('prenotazione online e blocco doppia prenotazione simultanea', async () => {
    const body = { date, time: '09:00', services: [colore.id], first_name: 'Anna', last_name: 'Verdi', phone: '3331234567', email: 'anna@example.com', consent_privacy: true };
    const [a, b] = await Promise.all([api('POST', '/api/public/book', body), api('POST', '/api/public/book', { ...body, phone: '3339999999', first_name: 'Bea' })]);
    const ok = [a, b].filter(x => x.status === 200); const ko = [a, b].filter(x => x.status === 409);
    assert.strictEqual(ok.length, 1, 'solo una prenotazione deve riuscire'); assert.strictEqual(ko.length, 1);
    token = ok[0].data.token;
  });

  await t.test('durante la posa l’operatore è prenotabile per un servizio breve', async () => {
    // Colore 09:00: occupato 09:00-09:15, posa 09:15-09:55, occupato 09:55-10:35 (+5 pausa)
    const av = (await api('GET', `/api/public/availability?date=${date}&services=${taglioUomo.id}`)).data;
    const times = av.slots.map(s => s.time);
    assert.ok(times.includes('09:15'), 'slot nella posa disponibile');
    assert.ok(!times.includes('09:00') && !times.includes('09:45'), 'slot sovrapposti non disponibili');
    const r = await api('POST', '/api/public/book', { date, time: '09:15', services: [taglioUomo.id], first_name: 'Carlo', last_name: 'Neri', phone: '3335550000', consent_privacy: true });
    assert.strictEqual(r.status, 200);
  });

  await t.test('privacy obbligatoria', async () => {
    const r = await api('POST', '/api/public/book', { date, time: '14:00', services: [taglioUomo.id], first_name: 'X', last_name: 'Y', phone: '3330000001' });
    assert.strictEqual(r.status, 400);
  });

  await t.test('gestione prenotazione: sposta e annulla', async () => {
    const v = (await api('GET', `/api/public/booking/${token}`)).data;
    assert.strictEqual(v.time, '09:00'); assert.ok(v.editable);
    const av = (await api('GET', `/api/public/booking/${token}/availability?date=${date}`)).data;
    assert.ok(av.slots.some(s => s.time === '11:00'));
    const mv = await api('POST', `/api/public/booking/${token}/reschedule`, { date, time: '11:00' });
    assert.strictEqual(mv.status, 200); assert.strictEqual(mv.data.time, '11:00');
    const free = (await api('GET', `/api/public/availability?date=${date}&services=${colore.id}`)).data.slots.map(s => s.time);
    assert.ok(free.includes('09:00'), 'il vecchio orario torna libero');
    const cancel = await api('POST', `/api/public/booking/${token}/cancel`);
    assert.strictEqual(cancel.data.status, 'cancellato');
  });

  await t.test('login gestionale con password Zaira', async () => {
    assert.strictEqual((await api('POST', '/api/auth/login', { username: 'zaira', password: 'sbagliata' })).status, 401);
    const r = await api('POST', '/api/auth/login', { username: 'zaira', password: 'Zaira' });
    assert.strictEqual(r.status, 200);
    const me = await api('GET', '/api/auth/me', null, { auth: true });
    assert.strictEqual(me.data.user.role, 'admin');
    assert.strictEqual((await api('GET', '/api/admin/customers')).status, 401, 'senza sessione nessun accesso');
  });

  await t.test('CSRF: richieste senza header rifiutate', async () => {
    const r = await fetch(base + '/api/admin/r/services', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(r.status, 403);
  });

  let apptId, staffId;
  await t.test('agenda: appuntamento manuale, conflitto, drag&drop con versione', async () => {
    const ag = (await api('GET', `/api/admin/agenda?from=${date}&to=${date}`, null, { auth: true })).data;
    staffId = ag.staff[0].id;
    const r = await api('POST', '/api/admin/appointments', { date, time: '15:00', staff_id: staffId, service_ids: [taglioUomo.id], customer: { first_name: 'Dario', last_name: 'Blu', phone: '3471112222' } }, { auth: true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    apptId = r.data.appointment.id;
    const clash = await api('POST', '/api/admin/appointments', { date, time: '15:15', staff_id: staffId, service_ids: [taglioUomo.id], customer: { first_name: 'E', phone: '3471113333' } }, { auth: true });
    assert.strictEqual(clash.status, 409);
    const v = r.data.appointment.version;
    const mv = await api('PATCH', `/api/admin/appointments/${apptId}`, { date, time: '16:00', version: v }, { auth: true });
    assert.strictEqual(mv.status, 200);
    const stale = await api('PATCH', `/api/admin/appointments/${apptId}`, { date, time: '16:30', version: v }, { auth: true });
    assert.strictEqual(stale.status, 409, 'versione vecchia: nessuna sovrascrittura');
  });

  await t.test('cassa: conto da appuntamento, prodotto, pagamento misto, magazzino, punti', async () => {
    assert.strictEqual((await api('POST', '/api/admin/cash/open', { opening: '100' }, { auth: true })).status, 200);
    const prod = (await api('POST', '/api/admin/r/products', { name: 'Shampoo ristrutturante', price_cents: '12,50', cost_cents: '6', stock: 10, min_stock: 2 }, { auth: true })).data;
    assert.strictEqual(prod.price_cents, 1250);
    let sale = (await api('POST', '/api/admin/sales', { appointment_id: apptId }, { auth: true })).data;
    assert.strictEqual(sale.items.length, 1);
    sale = (await api('POST', `/api/admin/sales/${sale.id}/items`, { kind: 'prodotto', ref_id: prod.id, qty: 2 }, { auth: true })).data;
    assert.strictEqual(sale.total_cents, 1500 + 2500);
    const bad = await api('POST', `/api/admin/sales/${sale.id}/close`, { payments: [{ method: 'contanti', amount_euro: '10' }] }, { auth: true });
    assert.strictEqual(bad.status, 400, 'i pagamenti devono coprire il totale');
    const closed = await api('POST', `/api/admin/sales/${sale.id}/close`, { payments: [{ method: 'contanti', amount_euro: '15' }, { method: 'carta', amount_euro: '25' }] }, { auth: true });
    assert.strictEqual(closed.status, 200, JSON.stringify(closed.data));
    assert.strictEqual(closed.data.points_earned, 40);
    const p2 = (await api('GET', `/api/admin/r/products/${prod.id}`, null, { auth: true })).data;
    assert.strictEqual(p2.stock, 8);
    const appt = (await api('GET', `/api/admin/appointments/${apptId}`, null, { auth: true })).data;
    assert.strictEqual(appt.status, 'completato');
    const cs = (await api('POST', '/api/admin/cash/close', { counted: '115' }, { auth: true })).data;
    assert.strictEqual(cs.difference_cents, 0);
  });

  await t.test('gift card: vendita e utilizzo', async () => {
    let sale = (await api('POST', '/api/admin/sales', {}, { auth: true })).data;
    sale = (await api('POST', `/api/admin/sales/${sale.id}/items`, { kind: 'giftcard', unit_euro: '50' }, { auth: true })).data;
    const done = (await api('POST', `/api/admin/sales/${sale.id}/close`, { payments: [{ method: 'carta', amount_euro: '50' }] }, { auth: true })).data;
    const code = done.created.giftcards[0].code;
    let s2 = (await api('POST', '/api/admin/sales', {}, { auth: true })).data;
    s2 = (await api('POST', `/api/admin/sales/${s2.id}/items`, { kind: 'servizio', ref_id: colore.id }, { auth: true })).data;
    const pay = await api('POST', `/api/admin/sales/${s2.id}/close`, { payments: [{ method: 'giftcard', amount_euro: '40', ref: code }] }, { auth: true });
    assert.strictEqual(pay.status, 200, JSON.stringify(pay.data));
    const g = (await api('GET', `/api/admin/giftcards/lookup?code=${code}`, null, { auth: true })).data;
    assert.strictEqual(g.balance_cents, 1000);
  });

  await t.test('dashboard e report calcolati dai dati', async () => {
    const d = (await api('GET', `/api/admin/dashboard?from=${U.todayLocal()}&to=${U.todayLocal()}`, null, { auth: true })).data;
    assert.strictEqual(d.finance.today, 4000 + 5000 + 4000);
    const rep = (await api('GET', `/api/admin/reports?from=${U.todayLocal()}&to=${U.todayLocal()}`, null, { auth: true })).data;
    assert.strictEqual(rep.totals.revenue, 13000);
  });

  await t.test('ruoli: operatore senza accesso alla cassa', async () => {
    const u = await api('POST', '/api/admin/users', { username: 'operatore1', password: 'prova123', role: 'operator', staff_id: staffId }, { auth: true });
    assert.strictEqual(u.status, 200);
    const adminCookie = cookie;
    await api('POST', '/api/auth/login', { username: 'operatore1', password: 'prova123' });
    assert.strictEqual((await api('GET', '/api/admin/cash/session', null, { auth: true })).status, 403);
    assert.strictEqual((await api('GET', '/api/admin/reports', null, { auth: true })).status, 403);
    assert.strictEqual((await api('GET', `/api/admin/agenda?from=${date}`, null, { auth: true })).status, 200);
    cookie = adminCookie;
  });

  await t.test('GDPR: export e anonimizzazione', async () => {
    const list = (await api('GET', '/api/admin/customers?q=Carlo', null, { auth: true })).data;
    const id = list.rows[0].id;
    const ex = await api('GET', `/api/admin/customers/${id}/gdpr-export`, null, { auth: true, raw: true });
    assert.strictEqual(ex.status, 200);
    assert.strictEqual((await api('POST', `/api/admin/customers/${id}/anonymize`, {}, { auth: true })).status, 200);
    const c = (await api('GET', `/api/admin/customers/${id}`, null, { auth: true })).data.customer;
    assert.strictEqual(c.phone, null); assert.ok(c.anonymized);
  });

  await t.test('sito pubblico', async () => {
    for (const p of ['/', '/servizi', '/prenota', '/privacy', '/cookie', '/termini', '/manifest.webmanifest', '/robots.txt']) {
      const r = await fetch(base + p); assert.strictEqual(r.status, 200, p);
    }
    const home = await (await fetch(base + '/')).text();
    assert.ok(home.includes('Turn Over by Zaira')); assert.ok(home.includes('Via Antonio Vivaldi'));
    assert.strictEqual((await fetch(base + '/non-esiste')).status, 404);
  });

  server.close(); await db.pool.end();
});
