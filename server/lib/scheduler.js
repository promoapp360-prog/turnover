'use strict';
// Attività automatiche: promemoria, richieste recensione, auguri compleanno, pulizia sessioni.
// Si eseguono ogni 5 minuti mentre il server è attivo e possono essere invocate da un cron esterno (/api/cron/tick).
const db = require('./db');
const log = require('./log');
const tenants = require('./tenant');
const notifications = require('./notifications');
const auth = require('./auth');
const U = require('./util');

let running = false;

async function tickTenant(t) {
  const ns = t.settings.notifications;
  let sent = 0;
  // Promemoria
  if (ns.email_enabled || ns.whatsapp_enabled) {
    const due = await db.many(
      `SELECT a.* FROM appointments a
        WHERE a.tenant_id=$1 AND a.status IN ('confermato') AND a.reminder_sent_at IS NULL AND NOT a.is_demo
          AND a.starts_at > now() AND a.starts_at <= now() + ($2 || ' hours')::interval
        LIMIT 100`, [t.id, String(ns.reminder_hours || 24)]);
    for (const a of due) {
      const upd = await db.one('UPDATE appointments SET reminder_sent_at=now() WHERE id=$1 AND reminder_sent_at IS NULL RETURNING id', [a.id]);
      if (!upd) continue; // già gestito da un'altra istanza
      const cust = a.customer_id ? await db.one('SELECT * FROM customers WHERE id=$1', [a.customer_id]) : null;
      await notifications.notify(t, 'reminder', { customer: cust, appointment: a });
      sent++;
    }
    // Richiesta recensione
    if (ns.review_request) {
      const done = await db.many(
        `SELECT a.* FROM appointments a WHERE a.tenant_id=$1 AND a.status='completato' AND a.review_requested_at IS NULL AND NOT a.is_demo
           AND a.ends_at < now() - ($2 || ' hours')::interval AND a.ends_at > now() - interval '3 days' LIMIT 100`,
        [t.id, String(ns.review_delay_hours || 3)]);
      for (const a of done) {
        const upd = await db.one('UPDATE appointments SET review_requested_at=now() WHERE id=$1 AND review_requested_at IS NULL RETURNING id', [a.id]);
        if (!upd) continue;
        const cust = a.customer_id ? await db.one('SELECT * FROM customers WHERE id=$1', [a.customer_id]) : null;
        await notifications.notify(t, 'review_request', { customer: cust, appointment: a });
        sent++;
      }
    }
    // Compleanni (una volta all'anno, dopo l'ora impostata)
    const now = U.localParts(new Date());
    if (ns.birthday && +now.time.slice(0, 2) >= (ns.birthday_hour || 9)) {
      const md = now.date.slice(5);
      const year = now.date.slice(0, 4);
      const list = await db.many(
        `SELECT c.* FROM customers c WHERE c.tenant_id=$1 AND NOT c.anonymized AND c.birth_date IS NOT NULL
            AND to_char(c.birth_date,'MM-DD')=$2 AND c.consent_marketing
            AND NOT EXISTS (SELECT 1 FROM notification_log l WHERE l.customer_id=c.id AND l.template_key='birthday'
                            AND to_char(l.created_at AT TIME ZONE $4,'YYYY')=$3)`, [t.id, md, year, U.TZ]);
      for (const c of list) {
        await notifications.notify(t, 'birthday', { customer: c });
        if (t.settings.loyalty.enabled && t.settings.loyalty.birthday_points > 0) {
          await db.query('INSERT INTO loyalty_ledger(tenant_id, customer_id, points, reason) VALUES ($1,$2,$3,$4)', [t.id, c.id, t.settings.loyalty.birthday_points, 'Compleanno']);
          await db.query('UPDATE customers SET points=points+$2 WHERE id=$1', [c.id, t.settings.loyalty.birthday_points]);
        }
        sent++;
      }
    }
  }
  return sent;
}

async function tick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const list = await db.many('SELECT id FROM tenants ORDER BY id');
    let total = 0;
    for (const { id } of list) {
      try { total += await tickTenant(await tenants.byId(id)); } catch (e) { log.error(`Scheduler tenant ${id}`, e); }
    }
    await auth.cleanupSessions();
    await db.query(`UPDATE gift_cards SET status='scaduta' WHERE status='attiva' AND expires_on < CURRENT_DATE`);
    return { processed: total };
  } finally { running = false; }
}

function start() {
  const every = parseInt(process.env.SCHEDULER_INTERVAL_MIN || '5', 10) * 60000;
  setTimeout(() => tick().catch(e => log.error('Scheduler', e)), 15000).unref();
  setInterval(() => tick().catch(e => log.error('Scheduler', e)), every).unref();
}

module.exports = { start, tick };
