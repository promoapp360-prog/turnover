'use strict';
/*
 * Motore prenotazioni.
 * - Servizi consecutivi nella stessa prenotazione, con lo stesso operatore.
 * - Tempi di posa: durante la posa l'operatore è libero (non genera "busy block").
 * - Pausa/pulizia (buffer) dopo l'ultimo servizio.
 * - Orari salone ∩ turni operatore, meno assenze/chiusure e appuntamenti esistenti.
 * - Doppia protezione contro le doppie prenotazioni: advisory lock per operatore + vincolo di esclusione su busy_blocks.
 */
const db = require('./db');
const { bad, conflict } = require('./http');
const U = require('./util');

async function loadServices(q, tenantId, ids, { onlineOnly = false } = {}) {
  if (!Array.isArray(ids) || !ids.length) throw bad('Seleziona almeno un servizio');
  if (ids.length > 8) throw bad('Massimo 8 servizi per prenotazione');
  const clean = ids.map(x => U.int(x, { min: 1, name: 'Servizio' }));
  const rows = await q.many(`SELECT * FROM services WHERE tenant_id=$1 AND id = ANY($2::int[]) AND active`, [tenantId, clean]);
  const byId = new Map(rows.map(r => [r.id, r]));
  const list = clean.map(id => byId.get(id));
  if (list.some(s => !s)) throw bad('Servizio non disponibile');
  if (onlineOnly && list.some(s => !s.online_bookable)) throw bad('Uno dei servizi non è prenotabile online');
  return list;
}

// Piano relativo (minuti dall'inizio): blocchi in cui l'operatore è occupato
function buildPlan(services) {
  let o = 0; const blocks = []; const items = [];
  for (const s of services) {
    const ps = s.processing_start_min || 0, pm = s.processing_min || 0, d = s.duration_min;
    if (pm > 0) {
      if (ps > 0) blocks.push([o, o + ps]);
      if (o + ps + pm < o + d) blocks.push([o + ps + pm, o + d]);
    } else blocks.push([o, o + d]);
    items.push({ service: s, start: o, end: o + d });
    o += d;
  }
  const buffer = services.length ? (services[services.length - 1].buffer_min || 0) : 0;
  if (blocks.length && buffer) blocks[blocks.length - 1] = [blocks[blocks.length - 1][0], blocks[blocks.length - 1][1] + buffer];
  else if (!blocks.length && buffer) blocks.push([o, o + buffer]);
  // unisci blocchi contigui
  const merged = [];
  for (const b of blocks.sort((a, c) => a[0] - c[0])) {
    const last = merged[merged.length - 1];
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]); else merged.push([...b]);
  }
  const price = services.reduce((a, s) => a + s.price_cents, 0);
  return { total: o, blocks: merged, items, buffer, price };
}

function intersect(a, b) {
  const out = [];
  for (const [s1, e1] of a) for (const [s2, e2] of b) {
    const s = Math.max(s1, s2), e = Math.min(e1, e2);
    if (e > s) out.push([s, e]);
  }
  return out;
}
const windowsToMin = list => (list || []).map(([a, b]) => [U.toMin(a), U.toMin(b)]).filter(([a, b]) => b > a);

function workingWindows(tenant, staff, dateStr) {
  const wd = U.weekdayOf(dateStr);
  const salon = windowsToMin(tenant.settings.hours[wd] || tenant.settings.hours[String(wd)]);
  const sched = staff.schedule || {};
  const own = Object.prototype.hasOwnProperty.call(sched, String(wd)) ? windowsToMin(sched[String(wd)]) : salon;
  return intersect(salon, own);
}

async function staffCandidates(q, tenantId, services, staffId) {
  const params = [tenantId];
  let where = 'tenant_id=$1 AND active';
  if (staffId) { params.push(staffId); where += ` AND id=$${params.length}`; }
  const staff = await q.many(`SELECT * FROM staff WHERE ${where} ORDER BY sort, id`, params);
  if (!staff.length) return [];
  const links = await q.many(`SELECT staff_id, service_id FROM staff_services WHERE staff_id = ANY($1::int[])`, [staff.map(s => s.id)]);
  const map = new Map();
  links.forEach(l => { if (!map.has(l.staff_id)) map.set(l.staff_id, new Set()); map.get(l.staff_id).add(l.service_id); });
  // Nessun servizio associato = l'operatore esegue tutti i servizi
  return staff.filter(s => !map.has(s.id) || services.every(sv => map.get(s.id).has(sv.id)));
}

async function busyForDay(q, tenantId, staffIds, dayStart, dayEnd) {
  const blocks = await q.many(
    `SELECT staff_id, lower(during) AS s, upper(during) AS e FROM busy_blocks
      WHERE tenant_id=$1 AND staff_id = ANY($2::int[]) AND during && tstzrange($3,$4)`, [tenantId, staffIds, dayStart, dayEnd]);
  const abs = await q.many(
    `SELECT staff_id, starts_at AS s, ends_at AS e FROM absences
      WHERE tenant_id=$1 AND (staff_id IS NULL OR staff_id = ANY($2::int[])) AND starts_at < $4 AND ends_at > $3`, [tenantId, staffIds, dayStart, dayEnd]);
  const per = new Map(staffIds.map(id => [id, []]));
  for (const b of blocks) per.get(b.staff_id).push([+new Date(b.s), +new Date(b.e), 'busy']);
  for (const a of abs) {
    if (a.staff_id === null) for (const id of staffIds) per.get(id).push([+new Date(a.s), +new Date(a.e), 'absence']);
    else per.get(a.staff_id).push([+new Date(a.s), +new Date(a.e), 'absence']);
  }
  return per;
}

/**
 * Calcola gli orari disponibili per data/servizi/operatore.
 * @returns {Promise<{slots:Array<{time:string, staff_ids:number[]}>, plan:object, staff:Array}>}
 */
async function availability(tenant, { date, serviceIds, staffId = null, publicMode = true }, q = db) {
  U.date(date, { required: true });
  const st = tenant.settings.booking;
  const services = await loadServices(q, tenant.id, serviceIds, { onlineOnly: publicMode });
  const plan = buildPlan(services);
  let staff = await staffCandidates(q, tenant.id, services, staffId ? U.int(staffId, { min: 1 }) : null);
  if (publicMode) staff = staff.filter(s => s.online_bookable);
  const result = { slots: [], plan: { total_min: plan.total, price_cents: plan.price }, staff: staff.map(s => ({ id: s.id, name: s.name })) };
  if (!staff.length) return result;

  const today = U.todayLocal();
  if (publicMode) {
    if (date < today) return result;
    if (date > U.addDays(today, st.max_advance_days)) return result;
  }
  const dayStart = U.localToUtc(date, '00:00');
  const dayEnd = U.localToUtc(U.addDays(date, 1), '00:00');
  const busy = await busyForDay(q, tenant.id, staff.map(s => s.id), dayStart, dayEnd);
  const minStart = Date.now() + (publicMode ? st.min_notice_min : 0) * 60000;
  const step = Math.max(5, st.slot_step_min || 15);
  const slotMap = new Map();
  const load = new Map();

  for (const s of staff) {
    const b = busy.get(s.id);
    load.set(s.id, b.filter(x => x[2] === 'busy').reduce((a, x) => a + (x[1] - x[0]), 0));
    for (const [ws, we] of workingWindows(tenant, s, date)) {
      for (let m = Math.ceil(ws / step) * step; m + plan.total <= we; m += step) {
        const startAbs = +U.localToUtc(date, U.minToHHMM(m));
        if (startAbs < minStart) continue;
        const endPresence = startAbs + plan.total * 60000;
        let ok = true;
        for (const [bs, be, kind] of b) {
          if (kind === 'absence') { if (bs < endPresence && be > startAbs) { ok = false; break; } continue; }
          for (const [rs, re] of plan.blocks) {
            const a1 = startAbs + rs * 60000, a2 = startAbs + re * 60000;
            if (bs < a2 && be > a1) { ok = false; break; }
          }
          if (!ok) break;
        }
        if (!ok) continue;
        const key = U.minToHHMM(m);
        if (!slotMap.has(key)) slotMap.set(key, []);
        slotMap.get(key).push(s.id);
      }
    }
  }
  const order = new Map(staff.map((s, i) => [s.id, i]));
  result.slots = [...slotMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([time, ids]) => ({ time, staff_ids: ids.sort((x, y) => (load.get(x) - load.get(y)) || (order.get(x) - order.get(y))) }));
  return result;
}

// Dati occupazione per un operatore in un intervallo assoluto
function absoluteBlocks(plan, start) {
  return plan.blocks.map(([a, b]) => [new Date(+start + a * 60000), new Date(+start + b * 60000)]);
}

async function lockStaff(c, staffId) {
  await c.query('SELECT pg_advisory_xact_lock($1, $2)', [7301, staffId]);
}

async function assertFree(c, tenantId, staffId, blocks, excludeAppointmentId = null) {
  for (const [s, e] of blocks) {
    const hit = await c.one(
      `SELECT appointment_id FROM busy_blocks WHERE tenant_id=$1 AND staff_id=$2 AND during && tstzrange($3,$4)
         AND ($5::int IS NULL OR appointment_id <> $5) LIMIT 1`, [tenantId, staffId, s, e, excludeAppointmentId]);
    if (hit) throw conflict('L’orario selezionato non è più disponibile', { appointment_id: hit.appointment_id });
  }
}
async function assertNoAbsence(c, tenantId, staffId, start, end) {
  const a = await c.one(`SELECT kind, reason FROM absences WHERE tenant_id=$1 AND (staff_id IS NULL OR staff_id=$2) AND starts_at < $4 AND ends_at > $3 LIMIT 1`,
    [tenantId, staffId, start, end]);
  if (a) throw conflict(`Operatore non disponibile (${a.kind}${a.reason ? ': ' + a.reason : ''})`);
}

async function insertBlocks(c, tenantId, apptId, staffId, blocks) {
  await c.query('DELETE FROM busy_blocks WHERE appointment_id=$1', [apptId]);
  for (const [s, e] of blocks) {
    await c.query(`INSERT INTO busy_blocks(tenant_id, appointment_id, staff_id, during) VALUES ($1,$2,$3,tstzrange($4,$5))`, [tenantId, apptId, staffId, s, e]);
  }
}

function mapExclusion(e) {
  if (e && e.code === '23P01') return conflict('L’orario selezionato non è più disponibile');
  return e;
}

async function upsertCustomer(c, tenantId, { first_name, last_name, phone, email, consent_privacy, consent_marketing, audience }) {
  const pn = U.normPhone(phone);
  let cust = null;
  if (pn) cust = await c.one('SELECT * FROM customers WHERE tenant_id=$1 AND phone_norm=$2 AND NOT anonymized ORDER BY id LIMIT 1', [tenantId, pn]);
  if (!cust && email) cust = await c.one('SELECT * FROM customers WHERE tenant_id=$1 AND lower(email)=lower($2) AND NOT anonymized ORDER BY id LIMIT 1', [tenantId, email]);
  if (cust) {
    cust = await c.one(
      `UPDATE customers SET email=COALESCE(email,$2), phone=COALESCE(phone,$3), phone_norm=COALESCE(phone_norm,$4),
              last_name=COALESCE(last_name,$5),
              consent_privacy = consent_privacy OR $6, consent_marketing = CASE WHEN $7::boolean IS NULL THEN consent_marketing ELSE $7 END,
              consent_updated_at = now(), audience=COALESCE(audience,$8)
        WHERE id=$1 RETURNING *`, [cust.id, email, phone, pn, last_name, !!consent_privacy, consent_marketing === undefined ? null : !!consent_marketing, audience || null]);
    return cust;
  }
  return c.one(
    `INSERT INTO customers(tenant_id, first_name, last_name, phone, phone_norm, email, consent_privacy, consent_marketing, consent_updated_at, audience)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) RETURNING *`,
    [tenantId, first_name, last_name, phone, pn, email, !!consent_privacy, !!consent_marketing, audience || null]);
}

/**
 * Crea un appuntamento in modo atomico.
 * opts: { tenant, date, time, serviceIds, staffId|null, customer:{...}|customerId, source, notes, internalNotes, status, userId, publicMode }
 */
async function createAppointment(opts) {
  const { tenant } = opts;
  U.date(opts.date, { required: true });
  if (!U.TIME_RE.test(opts.time || '')) throw bad('Orario non valido');
  return db.tx(async c => {
    const services = await loadServices(c, tenant.id, opts.serviceIds, { onlineOnly: opts.publicMode });
    const plan = buildPlan(services);
    const start = U.localToUtc(opts.date, opts.time);
    const end = new Date(+start + plan.total * 60000);

    let candidates;
    if (opts.publicMode) {
      const av = await availability(tenant, { date: opts.date, serviceIds: opts.serviceIds, staffId: opts.staffId, publicMode: true }, c);
      const slot = av.slots.find(s => s.time === opts.time);
      if (!slot) throw conflict('L’orario selezionato non è più disponibile. Scegli un altro orario.');
      candidates = slot.staff_ids;
    } else {
      if (!opts.staffId) throw bad('Seleziona l’operatore');
      candidates = [U.int(opts.staffId, { min: 1 })];
      const st = await c.one('SELECT id FROM staff WHERE tenant_id=$1 AND id=$2', [tenant.id, candidates[0]]);
      if (!st) throw bad('Operatore non valido');
    }

    let customerId = opts.customerId || null;
    if (!customerId && opts.customer) customerId = (await upsertCustomer(c, tenant.id, opts.customer)).id;
    if (customerId) {
      const ok = await c.one('SELECT id FROM customers WHERE tenant_id=$1 AND id=$2', [tenant.id, customerId]);
      if (!ok) throw bad('Cliente non valido');
    }

    const blocks = absoluteBlocks(plan, start);
    let lastErr;
    for (const staffId of candidates) {
      try {
        await c.query('SAVEPOINT try_staff');
        await lockStaff(c, staffId);
        await assertFree(c, tenant.id, staffId, blocks);
        if (!opts.publicMode && !opts.ignoreAbsences) await assertNoAbsence(c, tenant.id, staffId, start, end);
        const status = opts.status || (opts.publicMode && tenant.settings.booking.require_approval ? 'in_attesa' : 'confermato');
        const appt = await c.one(
          `INSERT INTO appointments(tenant_id, customer_id, staff_id, starts_at, ends_at, status, source, customer_notes, internal_notes,
                                    total_cents, manage_token, created_by, recurrence_group)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [tenant.id, customerId, staffId, start, end, status, opts.publicMode ? 'online' : 'staff',
            opts.notes || null, opts.internalNotes || null, plan.price, U.token(18), opts.userId || null, opts.recurrenceGroup || null]);
        let i = 0;
        for (const it of plan.items) {
          await c.query(`INSERT INTO appointment_services(tenant_id, appointment_id, service_id, name, price_cents, starts_at, ends_at, sort)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [tenant.id, appt.id, it.service.id, it.service.name, it.service.price_cents,
              new Date(+start + it.start * 60000), new Date(+start + it.end * 60000), i++]);
        }
        await insertBlocks(c, tenant.id, appt.id, staffId, blocks);
        await c.query('RELEASE SAVEPOINT try_staff');
        return appt;
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT try_staff');
        lastErr = mapExclusion(e);
        if (lastErr.status !== 409) throw lastErr;
      }
    }
    throw lastErr || conflict('L’orario selezionato non è più disponibile');
  });
}

/** Sposta/modifica un appuntamento con controllo di versione (nessuna sovrascrittura silenziosa) */
async function rescheduleAppointment(tenant, id, { date, time, staffId, durationMin, version, ignoreAbsences = false, publicMode = false }) {
  return db.tx(async c => {
    const appt = await c.one('SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant.id, id]);
    if (!appt) throw bad('Appuntamento non trovato');
    if (version !== undefined && version !== null && +version !== appt.version)
      throw conflict('L’appuntamento è stato modificato da un altro utente. Ricarica l’agenda.', { current_version: appt.version });
    if (['cancellato', 'completato', 'assente'].includes(appt.status)) throw bad('Appuntamento non modificabile in questo stato');

    const items = await c.many('SELECT a.*, s.duration_min, s.processing_start_min, s.processing_min, s.buffer_min FROM appointment_services a LEFT JOIN services s ON s.id=a.service_id WHERE a.appointment_id=$1 ORDER BY a.sort', [id]);
    const services = items.map(it => ({
      id: it.service_id, name: it.name, price_cents: it.price_cents,
      duration_min: Math.round((new Date(it.ends_at) - new Date(it.starts_at)) / 60000),
      processing_start_min: it.processing_start_min || 0, processing_min: it.processing_min || 0, buffer_min: it.buffer_min || 0,
    }));
    if (durationMin) {
      // modifica rapida durata: si applica all'ultimo servizio
      const diff = U.int(durationMin, { min: 5, max: 720, name: 'Durata' }) - services.reduce((a, s) => a + s.duration_min, 0);
      const last = services[services.length - 1];
      last.duration_min = Math.max(5, last.duration_min + diff);
      if (last.processing_start_min + last.processing_min > last.duration_min) { last.processing_min = 0; last.processing_start_min = 0; }
    }
    const plan = buildPlan(services);
    const newStaff = staffId ? U.int(staffId, { min: 1 }) : appt.staff_id;
    const st = await c.one('SELECT * FROM staff WHERE tenant_id=$1 AND id=$2', [tenant.id, newStaff]);
    if (!st) throw bad('Operatore non valido');
    const start = date && time ? U.localToUtc(U.date(date), time) : new Date(appt.starts_at);
    if (time && !U.TIME_RE.test(time)) throw bad('Orario non valido');
    const end = new Date(+start + plan.total * 60000);
    if (publicMode) {
      const p = U.localParts(start);
      const av = await availabilityExcluding(tenant, c, { date: p.date, services, staff: st, excludeId: id });
      if (!av.includes(p.time)) throw conflict('L’orario selezionato non è disponibile');
    }
    await lockStaff(c, newStaff);
    const blocks = absoluteBlocks(plan, start);
    await assertFree(c, tenant.id, newStaff, blocks, id);
    if (!ignoreAbsences) await assertNoAbsence(c, tenant.id, newStaff, start, end);
    try {
      await insertBlocks(c, tenant.id, id, newStaff, blocks);
    } catch (e) { throw mapExclusion(e); }
    let o = 0, i = 0;
    for (const it of items) {
      const d = services[i].duration_min;
      await c.query('UPDATE appointment_services SET starts_at=$2, ends_at=$3 WHERE id=$1', [it.id, new Date(+start + o * 60000), new Date(+start + (o + d) * 60000)]);
      o += d; i++;
    }
    return c.one(`UPDATE appointments SET starts_at=$2, ends_at=$3, staff_id=$4, version=version+1, updated_at=now(), reminder_sent_at=NULL
                   WHERE id=$1 RETURNING *`, [id, start, end, newStaff]);
  });
}

// Disponibilità per riprogrammazione pubblica: considera i blocchi dell'appuntamento stesso come liberi
async function availabilityExcluding(tenant, c, { date, services, staff, excludeId }) {
  const plan = buildPlan(services);
  const st = tenant.settings.booking;
  const dayStart = U.localToUtc(date, '00:00');
  const dayEnd = U.localToUtc(U.addDays(date, 1), '00:00');
  const busy = (await busyForDay(c, tenant.id, [staff.id], dayStart, dayEnd)).get(staff.id);
  const own = await c.many(`SELECT lower(during) s, upper(during) e FROM busy_blocks WHERE appointment_id=$1`, [excludeId]);
  const ownSet = new Set(own.map(o => +new Date(o.s) + ':' + +new Date(o.e)));
  const b = busy.filter(x => !(x[2] === 'busy' && ownSet.has(x[0] + ':' + x[1])));
  const out = [];
  const minStart = Date.now() + st.min_notice_min * 60000;
  const step = Math.max(5, st.slot_step_min || 15);
  for (const [ws, we] of workingWindows(tenant, staff, date)) {
    for (let m = Math.ceil(ws / step) * step; m + plan.total <= we; m += step) {
      const sAbs = +U.localToUtc(date, U.minToHHMM(m));
      if (sAbs < minStart) continue;
      const endP = sAbs + plan.total * 60000;
      const clash = b.some(([bs, be, kind]) => kind === 'absence' ? (bs < endP && be > sAbs)
        : plan.blocks.some(([rs, re]) => bs < sAbs + re * 60000 && be > sAbs + rs * 60000));
      if (!clash) out.push(U.minToHHMM(m));
    }
  }
  return out;
}

async function setStatus(tenant, id, status, { version, reason } = {}) {
  U.oneOf(status, ['in_attesa', 'confermato', 'arrivato', 'in_lavorazione', 'completato', 'cancellato', 'assente'], 'Stato');
  return db.tx(async c => {
    const appt = await c.one('SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant.id, id]);
    if (!appt) throw bad('Appuntamento non trovato');
    if (version !== undefined && version !== null && +version !== appt.version)
      throw conflict('L’appuntamento è stato modificato da un altro utente. Ricarica l’agenda.');
    if (appt.status === 'cancellato' && status !== 'cancellato') {
      // ripristino: deve tornare libero l'orario
      const items = await c.many('SELECT a.*, s.processing_start_min, s.processing_min, s.buffer_min FROM appointment_services a LEFT JOIN services s ON s.id=a.service_id WHERE a.appointment_id=$1 ORDER BY a.sort', [id]);
      const plan = buildPlan(items.map(it => ({ duration_min: Math.round((new Date(it.ends_at) - new Date(it.starts_at)) / 60000), processing_start_min: it.processing_start_min || 0, processing_min: it.processing_min || 0, buffer_min: it.buffer_min || 0, price_cents: it.price_cents })));
      const blocks = absoluteBlocks(plan, new Date(appt.starts_at));
      await lockStaff(c, appt.staff_id);
      await assertFree(c, tenant.id, appt.staff_id, blocks, id);
      try { await insertBlocks(c, tenant.id, id, appt.staff_id, blocks); } catch (e) { throw mapExclusion(e); }
    }
    if (status === 'cancellato' || status === 'assente') await c.query('DELETE FROM busy_blocks WHERE appointment_id=$1', [id]);
    return c.one(`UPDATE appointments SET status=$2, version=version+1, updated_at=now(),
                    cancelled_at = CASE WHEN $2='cancellato' THEN now() ELSE NULL END,
                    cancel_reason = CASE WHEN $2='cancellato' THEN $3 ELSE NULL END
                  WHERE id=$1 RETURNING *`, [id, status, reason || null]);
  });
}

module.exports = { availability, createAppointment, rescheduleAppointment, setStatus, buildPlan, upsertCustomer, workingWindows, availabilityExcluding, loadServices };
