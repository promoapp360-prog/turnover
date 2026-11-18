'use strict';
// Azioni conseguenti agli eventi sugli appuntamenti (notifiche, lista d'attesa, aggiornamento agenda in tempo reale)
const db = require('./db');
const log = require('./log');
const events = require('./events');
const notifications = require('./notifications');
const U = require('./util');

function bg(p) { p.catch(e => log.error('Hook in background', e)); }

async function customerOf(appt) {
  return appt.customer_id ? db.one('SELECT * FROM customers WHERE id=$1', [appt.customer_id]) : null;
}

function changed(tenant, appt, kind) {
  events.publish(tenant.id, 'appointments', { id: appt.id, date: U.localParts(new Date(appt.starts_at)).date, kind });
}

function onCreated(tenant, appt, { notify = true } = {}) {
  changed(tenant, appt, 'created');
  if (!notify) return;
  bg((async () => {
    const c = await customerOf(appt);
    await notifications.notify(tenant, appt.status === 'in_attesa' ? 'booking_pending' : 'booking_confirmed', { customer: c, appointment: appt });
    if (appt.source === 'online' && tenant.settings.notifications.notify_owner_new_booking) {
      const v = await notifications.appointmentVars(tenant, appt);
      await notifications.notifyOwner(tenant, `Nuova prenotazione online: ${c ? c.first_name + ' ' + (c.last_name || '') : ''}`,
        `${v.data} alle ${v.ora}\nServizi: ${v.servizi}\nOperatore: ${v.operatore}\nTelefono: ${c && c.phone || '-'}`);
    }
  })());
}

function onRescheduled(tenant, appt, { notify = true } = {}) {
  changed(tenant, appt, 'updated');
  if (notify) bg((async () => notifications.notify(tenant, 'rescheduled', { customer: await customerOf(appt), appointment: appt }))());
}

function onStatus(tenant, appt, prevStatus, { notify = true } = {}) {
  changed(tenant, appt, 'status');
  bg((async () => {
    const c = await customerOf(appt);
    if (notify && appt.status === 'cancellato' && prevStatus !== 'cancellato') await notifications.notify(tenant, 'cancelled', { customer: c, appointment: appt });
    if (notify && appt.status === 'confermato' && prevStatus === 'in_attesa') await notifications.notify(tenant, 'booking_confirmed', { customer: c, appointment: appt });
    if (appt.status === 'cancellato') await offerToWaitlist(tenant, appt);
    if (appt.status === 'completato' && c) await db.query('UPDATE customers SET last_visit_at=GREATEST(COALESCE(last_visit_at, $2), $2) WHERE id=$1', [c.id, appt.starts_at]);
  })());
}

// Quando si libera un posto avvisa i clienti in lista d'attesa compatibili (in ordine di iscrizione)
async function offerToWaitlist(tenant, appt) {
  if (!tenant.modules.waitlist) return;
  if (new Date(appt.starts_at) < new Date()) return;
  const day = U.localParts(new Date(appt.starts_at)).date;
  const list = await db.many(
    `SELECT w.* FROM waitlist w WHERE w.tenant_id=$1 AND w.status='attesa' AND $2::date BETWEEN w.date_from AND w.date_to
       AND (w.staff_id IS NULL OR w.staff_id=$3) ORDER BY w.created_at LIMIT 5`, [tenant.id, day, appt.staff_id]);
  for (const w of list) {
    const c = await db.one('SELECT * FROM customers WHERE id=$1', [w.customer_id]);
    await notifications.notify(tenant, 'waitlist_slot', { customer: c, vars: { data: U.fmtDateIt(new Date(appt.starts_at)), ora: U.fmtTimeIt(new Date(appt.starts_at)) } });
    await db.query(`UPDATE waitlist SET status='avvisato', notified_at=now() WHERE id=$1`, [w.id]);
  }
  if (list.length) events.publish(tenant.id, 'waitlist', { date: day });
}

module.exports = { onCreated, onRescheduled, onStatus, changed };
