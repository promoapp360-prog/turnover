'use strict';
const crypto = require('crypto');
const db = require('../lib/db');
const H = require('../lib/http');
const U = require('../lib/util');
const auth = require('../lib/auth');
const booking = require('../lib/booking');
const hooks = require('../lib/hooks');
const notifications = require('../lib/notifications');
const { audit } = require('./admin-core');

const APPT_SELECT = `
  SELECT a.*, c.first_name, c.last_name, c.phone, c.email, c.notes AS customer_profile_notes, s.name AS staff_name, s.color AS staff_color,
         COALESCE((SELECT json_agg(json_build_object('id', x.id, 'service_id', x.service_id, 'name', x.name, 'price_cents', x.price_cents,
                    'starts_at', x.starts_at, 'ends_at', x.ends_at) ORDER BY x.sort) FROM appointment_services x WHERE x.appointment_id=a.id), '[]') AS services,
         (SELECT id FROM sales WHERE appointment_id=a.id AND status<>'annullata' ORDER BY id DESC LIMIT 1) AS sale_id
    FROM appointments a
    LEFT JOIN customers c ON c.id=a.customer_id
    JOIN staff s ON s.id=a.staff_id`;

function canTouch(user, appt) {
  if (auth.can(user, 'agenda.edit')) return true;
  return auth.can(user, 'agenda.own') && user.staff_id && user.staff_id === appt.staff_id;
}

async function loadAppt(t, id) {
  const a = await db.one(`${APPT_SELECT} WHERE a.tenant_id=$1 AND a.id=$2`, [t.id, id]);
  if (!a) throw H.notFound('Appuntamento non trovato');
  return a;
}

module.exports = function (r) {
  r.get('/api/admin/agenda', async req => {
    auth.require(req.user, 'agenda.view');
    const t = req.tenant;
    const from = U.date(req.query.from, { required: true });
    const to = U.date(req.query.to || req.query.from, { required: true });
    if (to < from) throw H.bad('Intervallo non valido');
    const start = U.localToUtc(from, '00:00'), end = U.localToUtc(U.addDays(to, 1), '00:00');
    const includeCancelled = req.query.cancelled === '1';
    const appts = await db.many(`${APPT_SELECT} WHERE a.tenant_id=$1 AND a.starts_at < $3 AND a.ends_at > $2 ${includeCancelled ? '' : "AND a.status <> 'cancellato'"} ORDER BY a.starts_at`, [t.id, start, end]);
    const absences = await db.many(`SELECT x.*, s.name AS staff_name FROM absences x LEFT JOIN staff s ON s.id=x.staff_id WHERE x.tenant_id=$1 AND x.starts_at < $3 AND x.ends_at > $2`, [t.id, start, end]);
    const staff = await db.many(`SELECT id, name, color, schedule, active, online_bookable, photo_url FROM staff WHERE tenant_id=$1 AND active ORDER BY sort, id`, [t.id]);
    return { appointments: appts, absences, staff, hours: t.settings.hours, step: t.settings.booking.slot_step_min };
  });

  r.get('/api/admin/appointments/search', async req => {
    auth.require(req.user, 'agenda.view');
    const q = U.str(req.query.q, { required: true, max: 80, name: 'Ricerca' });
    return db.many(`${APPT_SELECT} WHERE a.tenant_id=$1 AND (c.first_name ILIKE $2 OR c.last_name ILIKE $2 OR c.phone ILIKE $2 OR (c.first_name || ' ' || coalesce(c.last_name,'')) ILIKE $2)
                    ORDER BY a.starts_at DESC LIMIT 50`, [req.tenant.id, `%${q}%`]);
  });

  r.get('/api/admin/appointments/:id', async req => {
    auth.require(req.user, 'agenda.view');
    const a = await loadAppt(req.tenant, U.int(req.params.id, { min: 1 }));
    const v = await notifications.appointmentVars(req.tenant, a);
    const text = `Ciao ${a.first_name || ''}, ti ricordiamo l'appuntamento da ${req.tenant.settings.brand.name} ${v.data} alle ${v.ora}.`;
    return { ...a, wa_link: a.phone ? notifications.waLink(a.phone, text) : null, manage_url: v.link };
  });

  r.get('/api/admin/availability', async req => {
    auth.require(req.user, 'agenda.view');
    const ids = String(req.query.services || '').split(',').filter(Boolean).map(x => U.int(x, { min: 1 }));
    return booking.availability(req.tenant, { date: req.query.date, serviceIds: ids, staffId: req.query.staff || null, publicMode: false });
  });

  r.post('/api/admin/appointments', async req => {
    auth.require(req.user, 'agenda.edit');
    const t = req.tenant;
    const b = await H.parseJson(req);
    let customerId = b.customer_id ? U.int(b.customer_id, { min: 1 }) : null;
    let customer = null;
    if (!customerId && b.customer) {
      customer = {
        first_name: U.str(b.customer.first_name, { required: true, max: 60, name: 'Nome' }), last_name: U.str(b.customer.last_name, { max: 60 }),
        phone: U.phone(b.customer.phone), email: U.email(b.customer.email), consent_privacy: U.bool(b.customer.consent_privacy),
        consent_marketing: U.bool(b.customer.consent_marketing), audience: AUDV(b.customer.audience),
      };
    }
    const repeat = b.repeat && b.repeat.count > 1 ? { every: U.int(b.repeat.every_weeks || 1, { min: 1, max: 12 }), count: U.int(b.repeat.count, { min: 2, max: 26 }) } : null;
    const base = {
      tenant: t, time: b.time, serviceIds: b.service_ids, staffId: b.staff_id, customerId, customer,
      notes: U.str(b.notes, { max: 1000 }), internalNotes: U.str(b.internal_notes, { max: 2000 }),
      status: b.status ? U.oneOf(b.status, ['in_attesa', 'confermato', 'arrivato', 'in_lavorazione'], 'Stato') : 'confermato',
      userId: req.user.id, publicMode: false, ignoreAbsences: U.bool(b.ignore_absences),
    };
    const created = []; const skipped = [];
    const group = repeat ? crypto.randomUUID() : null;
    const first = await booking.createAppointment({ ...base, date: b.date, recurrenceGroup: group });
    created.push(first);
    if (repeat) {
      for (let i = 1; i < repeat.count; i++) {
        const d = U.addDays(b.date, 7 * repeat.every * i);
        try { created.push(await booking.createAppointment({ ...base, customer: null, customerId: first.customer_id, date: d, recurrenceGroup: group })); }
        catch (e) { if (e.status === 409 || e.status === 400) skipped.push({ date: d, reason: e.message }); else throw e; }
      }
    }
    for (const a of created) hooks.onCreated(t, a, { notify: U.bool(b.notify) && a === first });
    await audit(req, 'create', 'appointment', first.id, { count: created.length });
    return { ok: true, appointment: await loadAppt(t, first.id), created: created.length, skipped };
  });

  // Spostamento (drag & drop), cambio operatore, modifica durata, note
  r.patch('/api/admin/appointments/:id', async req => {
    const t = req.tenant;
    const id = U.int(req.params.id, { min: 1 });
    const cur = await loadAppt(t, id);
    const b = await H.parseJson(req);
    const moving = b.date || b.time || b.staff_id || b.duration_min;
    if (moving) auth.require(req.user, 'agenda.edit'); else if (!canTouch(req.user, cur)) throw H.forbidden();
    let upd = cur;
    if (moving) {
      upd = await booking.rescheduleAppointment(t, id, {
        date: b.date || U.localParts(new Date(cur.starts_at)).date, time: b.time || U.localParts(new Date(cur.starts_at)).time,
        staffId: b.staff_id, durationMin: b.duration_min, version: b.version, ignoreAbsences: U.bool(b.ignore_absences),
      });
      hooks.onRescheduled(t, upd, { notify: U.bool(b.notify) });
    }
    if (b.notes !== undefined || b.internal_notes !== undefined || b.customer_id !== undefined) {
      if (b.customer_id) { const ok = await db.one('SELECT 1 FROM customers WHERE tenant_id=$1 AND id=$2', [t.id, U.int(b.customer_id)]); if (!ok) throw H.bad('Cliente non valido'); }
      const row = await db.one(`UPDATE appointments SET customer_notes=COALESCE($3, customer_notes), internal_notes=COALESCE($4, internal_notes),
                                  customer_id=COALESCE($5, customer_id), version=version+1, updated_at=now()
                                 WHERE tenant_id=$1 AND id=$2 AND ($6::int IS NULL OR version=$6 OR $7) RETURNING *`,
        [t.id, id, b.notes === undefined ? null : U.str(b.notes, { max: 1000 }) || '', b.internal_notes === undefined ? null : U.str(b.internal_notes, { max: 2000 }) || '',
          b.customer_id ? U.int(b.customer_id) : null, moving ? null : (b.version ?? null), !!moving]);
      if (!row) throw H.conflict('L’appuntamento è stato modificato da un altro utente. Ricarica.');
      hooks.changed(t, row, 'updated');
    }
    await audit(req, 'update', 'appointment', id, { moved: !!moving });
    return loadAppt(t, id);
  });

  r.post('/api/admin/appointments/:id/status', async req => {
    const t = req.tenant;
    const id = U.int(req.params.id, { min: 1 });
    const cur = await loadAppt(t, id);
    if (!canTouch(req.user, cur)) throw H.forbidden();
    const b = await H.parseJson(req);
    const upd = await booking.setStatus(t, id, b.status, { version: b.version, reason: U.str(b.reason, { max: 300 }) });
    hooks.onStatus(t, upd, cur.status, { notify: b.notify !== false });
    await audit(req, 'status', 'appointment', id, { from: cur.status, to: upd.status });
    return loadAppt(t, id);
  });
};

function AUDV(v) { return ['donna', 'uomo', 'bambino'].includes(v) ? v : null; }
