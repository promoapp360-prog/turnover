'use strict';
const db = require('../lib/db');
const H = require('../lib/http');
const U = require('../lib/util');
const auth = require('../lib/auth');
const booking = require('../lib/booking');
const hooks = require('../lib/hooks');
const scheduler = require('../lib/scheduler');

const bookLimiter = H.rateLimiter({ windowMs: 10 * 60000, max: 15 });
const readLimiter = H.rateLimiter({ windowMs: 60000, max: 240 });

function bookingEnabled(t) { if (!t.modules.booking || !t.settings.booking.enabled) throw H.forbidden('Le prenotazioni online non sono attive'); }

async function publicCatalog(t) {
  const cats = await db.many('SELECT id, name, audience, sort FROM service_categories WHERE tenant_id=$1 ORDER BY audience, sort, id', [t.id]);
  const services = await db.many(
    `SELECT id, category_id, audience, name, description, price_cents, price_from, duration_min, online_bookable
       FROM services WHERE tenant_id=$1 AND active ORDER BY sort, id`, [t.id]);
  const staff = await db.many(
    `SELECT s.id, s.name, s.role_title, s.specialties, s.photo_url, s.bio,
            COALESCE(array_agg(ss.service_id) FILTER (WHERE ss.service_id IS NOT NULL), '{}') AS service_ids
       FROM staff s LEFT JOIN staff_services ss ON ss.staff_id=s.id
      WHERE s.tenant_id=$1 AND s.active AND s.online_bookable GROUP BY s.id ORDER BY s.sort, s.id`, [t.id]);
  return { categories: cats, services, staff };
}

function parseIds(v) {
  return String(v || '').split(',').filter(Boolean).map(x => U.int(x, { min: 1, name: 'Servizio' }));
}

async function byToken(t, token) {
  if (!token || token.length > 64) throw H.notFound('Prenotazione non trovata');
  const a = await db.one('SELECT * FROM appointments WHERE tenant_id=$1 AND manage_token=$2', [t.id, token]);
  if (!a) throw H.notFound('Prenotazione non trovata');
  return a;
}

async function bookingView(t, a) {
  const items = await db.many('SELECT name, price_cents, service_id FROM appointment_services WHERE appointment_id=$1 ORDER BY sort', [a.id]);
  const staff = await db.one('SELECT name FROM staff WHERE id=$1', [a.staff_id]);
  const cust = a.customer_id ? await db.one('SELECT first_name FROM customers WHERE id=$1', [a.customer_id]) : null;
  const deadline = new Date(+new Date(a.starts_at) - t.settings.booking.cancel_min_hours * 3600000);
  const editable = ['in_attesa', 'confermato'].includes(a.status) && new Date() < deadline;
  const p = U.localParts(new Date(a.starts_at));
  return {
    status: a.status, date: p.date, time: p.time, starts_at: a.starts_at, ends_at: a.ends_at,
    services: items, staff: staff && staff.name, staff_id: a.staff_id, total_cents: a.total_cents,
    customer_first_name: cust && cust.first_name, editable, deadline,
  };
}

module.exports = function (r) {
  r.get('/api/public/catalog', async req => {
    readLimiter(req.ip);
    const t = req.tenant;
    const b = t.settings.booking;
    return { ...(await publicCatalog(t)), booking: { enabled: t.modules.booking && b.enabled, allow_staff_choice: b.allow_staff_choice, max_advance_days: b.max_advance_days, terms: b.terms, require_approval: b.require_approval, cancel_min_hours: b.cancel_min_hours }, today: U.todayLocal() };
  });

  r.get('/api/public/availability', async req => {
    readLimiter(req.ip);
    bookingEnabled(req.tenant);
    const av = await booking.availability(req.tenant, { date: req.query.date, serviceIds: parseIds(req.query.services), staffId: req.query.staff || null, publicMode: true });
    return { date: req.query.date, slots: av.slots.map(s => ({ time: s.time })), plan: av.plan };
  });

  // Giorni con almeno un orario libero, per il calendario della prenotazione
  r.get('/api/public/days', async req => {
    readLimiter(req.ip);
    bookingEnabled(req.tenant);
    const from = U.date(req.query.from, { required: true });
    const n = Math.min(U.int(req.query.days || 14, { min: 1, max: 42 }), 42);
    const ids = parseIds(req.query.services);
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = U.addDays(from, i);
      const av = await booking.availability(req.tenant, { date: d, serviceIds: ids, staffId: req.query.staff || null, publicMode: true });
      out.push({ date: d, available: av.slots.length });
    }
    return { days: out };
  });

  r.post('/api/public/book', async req => {
    bookLimiter(req.ip);
    const t = req.tenant;
    bookingEnabled(t);
    const b = await H.parseJson(req, 20000);
    if (b.website) throw H.bad('Richiesta non valida'); // honeypot anti-spam
    const customer = {
      first_name: U.str(b.first_name, { required: true, max: 60, name: 'Nome' }),
      last_name: U.str(b.last_name, { required: true, max: 60, name: 'Cognome' }),
      phone: U.phone(b.phone, { required: true }),
      email: U.email(b.email, { required: false }),
      consent_privacy: U.bool(b.consent_privacy),
      consent_marketing: U.bool(b.consent_marketing),
      audience: ['donna', 'uomo', 'bambino'].includes(b.audience) ? b.audience : null,
    };
    if (!customer.consent_privacy) throw H.bad('È necessario accettare l’informativa privacy');
    const staffId = t.settings.booking.allow_staff_choice && b.staff_id ? U.int(b.staff_id, { min: 1 }) : null;
    const appt = await booking.createAppointment({
      tenant: t, date: b.date, time: b.time, serviceIds: Array.isArray(b.services) ? b.services : parseIds(b.services),
      staffId, customer, notes: U.str(b.notes, { max: 500 }), publicMode: true,
    });
    await db.query('INSERT INTO audit_log(tenant_id, action, entity, entity_id, ip) VALUES ($1,$2,$3,$4,$5)', [t.id, 'booking_online', 'appointment', String(appt.id), req.ip]);
    hooks.onCreated(t, appt);
    return { ok: true, token: appt.manage_token, status: appt.status, booking: await bookingView(t, appt) };
  });

  r.get('/api/public/booking/:token', async req => {
    readLimiter(req.ip);
    return bookingView(req.tenant, await byToken(req.tenant, req.params.token));
  });

  r.post('/api/public/booking/:token/cancel', async req => {
    bookLimiter(req.ip);
    const t = req.tenant;
    const a = await byToken(t, req.params.token);
    const v = await bookingView(t, a);
    if (!v.editable) throw H.bad(`La prenotazione non può più essere annullata online (limite: ${t.settings.booking.cancel_min_hours} ore prima). Contatta il salone.`);
    const upd = await booking.setStatus(t, a.id, 'cancellato', { reason: 'Annullata dal cliente' });
    hooks.onStatus(t, upd, a.status);
    return bookingView(t, upd);
  });

  r.get('/api/public/booking/:token/availability', async req => {
    readLimiter(req.ip);
    const t = req.tenant;
    const a = await byToken(t, req.params.token);
    const date = U.date(req.query.date, { required: true });
    if (date < U.todayLocal() || date > U.addDays(U.todayLocal(), t.settings.booking.max_advance_days)) return { slots: [] };
    const items = await db.many('SELECT a.service_id AS id, a.name, a.price_cents, s.duration_min, s.processing_start_min, s.processing_min, s.buffer_min FROM appointment_services a LEFT JOIN services s ON s.id=a.service_id WHERE a.appointment_id=$1 ORDER BY a.sort', [a.id]);
    const staff = await db.one('SELECT * FROM staff WHERE id=$1', [a.staff_id]);
    const times = await booking.availabilityExcluding(t, db, { date, services: items.map(i => ({ ...i, duration_min: i.duration_min || 30 })), staff, excludeId: a.id });
    return { slots: times.map(time => ({ time })) };
  });

  r.post('/api/public/booking/:token/reschedule', async req => {
    bookLimiter(req.ip);
    const t = req.tenant;
    const a = await byToken(t, req.params.token);
    const v = await bookingView(t, a);
    if (!v.editable) throw H.bad('La prenotazione non può più essere spostata online. Contatta il salone.');
    const b = await H.parseJson(req);
    const upd = await booking.rescheduleAppointment(t, a.id, { date: b.date, time: b.time, publicMode: true });
    hooks.onRescheduled(t, upd);
    return bookingView(t, upd);
  });

  r.post('/api/public/waitlist', async req => {
    bookLimiter(req.ip);
    const t = req.tenant;
    if (!t.modules.waitlist) throw H.forbidden('Lista d’attesa non attiva');
    const b = await H.parseJson(req, 20000);
    if (b.website) throw H.bad('Richiesta non valida');
    if (!U.bool(b.consent_privacy)) throw H.bad('È necessario accettare l’informativa privacy');
    const from = U.date(b.date_from, { required: true, name: 'Dal' });
    const to = U.date(b.date_to || b.date_from, { required: true, name: 'Al' });
    if (to < from) throw H.bad('Intervallo date non valido');
    const ids = (Array.isArray(b.services) ? b.services : parseIds(b.services)).map(x => U.int(x, { min: 1 }));
    const res = await db.tx(async c => {
      const cust = await booking.upsertCustomer(c, t.id, {
        first_name: U.str(b.first_name, { required: true, max: 60, name: 'Nome' }), last_name: U.str(b.last_name, { max: 60 }),
        phone: U.phone(b.phone, { required: true }), email: U.email(b.email), consent_privacy: true, consent_marketing: U.bool(b.consent_marketing),
      });
      return c.one(`INSERT INTO waitlist(tenant_id, customer_id, service_ids, staff_id, date_from, date_to, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [t.id, cust.id, ids, b.staff_id ? U.int(b.staff_id, { min: 1 }) : null, from, to, U.str(b.notes, { max: 500 })]);
    });
    require('../lib/events').publish(t.id, 'waitlist', {});
    return { ok: true, id: res.id };
  });

  // Immagini caricate dal gestionale (salvate nel database: persistenti anche su Replit Autoscale)
  r.get('/api/media/:id', async (req, res) => {
    const id = U.int(req.params.id, { min: 1 });
    const m = await db.one('SELECT mime, data, is_private, tenant_id, size FROM media WHERE id=$1 AND tenant_id=$2', [id, req.tenant.id]);
    if (!m) throw H.notFound('Immagine non trovata');
    if (m.is_private && !auth.can(req.user, 'clients.view')) throw H.forbidden();
    const data = Buffer.isBuffer(m.data) ? m.data : Buffer.from(String(m.data).replace(/^\\x/, ''), 'hex');
    H.send(res, 200, data, { 'Content-Type': m.mime, 'Cache-Control': m.is_private ? 'private, max-age=300' : 'public, max-age=86400', 'Content-Length': data.length });
  });

  // Trigger esterno per le automazioni (es. cron-job.org ogni 10 minuti) quando il server è in modalità Autoscale
  r.post('/api/cron/tick', async req => {
    const key = req.query.key || req.headers['x-cron-key'];
    if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) throw H.forbidden('Chiave cron non valida');
    return scheduler.tick();
  });
  r.get('/api/cron/tick', async req => {
    const key = req.query.key;
    if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) throw H.forbidden('Chiave cron non valida');
    return scheduler.tick();
  });
};
module.exports.publicCatalog = publicCatalog;
