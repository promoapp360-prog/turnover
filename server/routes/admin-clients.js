'use strict';
const db = require('../lib/db');
const H = require('../lib/http');
const U = require('../lib/util');
const auth = require('../lib/auth');
const { audit, dbError } = require('./admin-core');

const STATS = `
  (SELECT count(*) FROM appointments a WHERE a.customer_id=c.id AND a.status='completato')::int AS visits,
  (SELECT COALESCE(sum(total_cents),0) FROM sales s WHERE s.customer_id=c.id AND s.status='chiusa')::int AS spent_cents,
  (SELECT min(starts_at) FROM appointments a WHERE a.customer_id=c.id AND a.starts_at > now() AND a.status IN ('confermato','in_attesa')) AS next_appointment`;

function customerFields(b) {
  return {
    first_name: U.str(b.first_name, { required: true, max: 60, name: 'Nome' }), last_name: U.str(b.last_name, { max: 60 }),
    phone: U.phone(b.phone), email: U.email(b.email), birth_date: U.date(b.birth_date || null, { name: 'Data di nascita' }),
    audience: ['donna', 'uomo', 'bambino'].includes(b.audience) ? b.audience : null,
    preferences: U.str(b.preferences, { max: 2000 }), notes: U.str(b.notes, { max: 4000 }),
    consent_privacy: U.bool(b.consent_privacy), consent_marketing: U.bool(b.consent_marketing), consent_photos: U.bool(b.consent_photos),
  };
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // prevenzione formula injection in Excel
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = function (r) {
  r.get('/api/admin/customers', async req => {
    auth.require(req.user, 'clients.view');
    const t = req.tenant;
    const params = [t.id];
    let where = 'c.tenant_id=$1 AND NOT c.anonymized';
    if (req.query.q) {
      params.push(`%${req.query.q.trim()}%`);
      where += ` AND (c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.email ILIKE $${params.length}
                 OR (c.first_name || ' ' || coalesce(c.last_name,'')) ILIKE $${params.length})`;
    }
    if (['donna', 'uomo', 'bambino'].includes(req.query.audience)) { params.push(req.query.audience); where += ` AND c.audience=$${params.length}`; }
    const days = parseInt(req.query.inactive_days || t.settings.crm.inactive_days || 60, 10);
    if (req.query.filter === 'inactive') where += ` AND c.last_visit_at IS NOT NULL AND c.last_visit_at < now() - interval '${days} days'`;
    if (req.query.filter === 'never') where += ` AND c.last_visit_at IS NULL`;
    if (req.query.filter === 'new') where += ` AND c.created_at > now() - interval '30 days'`;
    if (req.query.filter === 'birthday') where += ` AND to_char(c.birth_date,'MM') = to_char(now(),'MM')`;
    if (req.query.filter === 'marketing') where += ` AND c.consent_marketing`;
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
    const rows = await db.many(`SELECT c.*, ${STATS} FROM customers c WHERE ${where} ORDER BY c.last_name NULLS LAST, c.first_name LIMIT ${limit} OFFSET ${offset}`, params);
    const total = await db.one(`SELECT count(*)::int n FROM customers c WHERE ${where}`, params);
    return { rows, total: total.n };
  });

  r.post('/api/admin/customers', async req => {
    auth.require(req.user, 'clients.edit');
    const f = customerFields(await H.parseJson(req));
    const pn = U.normPhone(f.phone);
    if (pn) {
      const dup = await db.one('SELECT id, first_name, last_name FROM customers WHERE tenant_id=$1 AND phone_norm=$2 AND NOT anonymized', [req.tenant.id, pn]);
      if (dup) throw H.conflict(`Esiste già un cliente con questo telefono: ${dup.first_name} ${dup.last_name || ''}`, { id: dup.id });
    }
    const row = await db.one(`INSERT INTO customers(tenant_id, first_name, last_name, phone, phone_norm, email, birth_date, audience, preferences, notes,
                                consent_privacy, consent_marketing, consent_photos, consent_updated_at)
                              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()) RETURNING *`,
      [req.tenant.id, f.first_name, f.last_name, f.phone, pn, f.email, f.birth_date, f.audience, f.preferences, f.notes, f.consent_privacy, f.consent_marketing, f.consent_photos]);
    await audit(req, 'create', 'customer', row.id);
    return row;
  });

  r.put('/api/admin/customers/:id', async req => {
    auth.require(req.user, 'clients.edit');
    const f = customerFields(await H.parseJson(req));
    const row = await db.one(`UPDATE customers SET first_name=$3, last_name=$4, phone=$5, phone_norm=$6, email=$7, birth_date=$8, audience=$9, preferences=$10, notes=$11,
                                consent_updated_at = CASE WHEN consent_privacy<>$12 OR consent_marketing<>$13 OR consent_photos<>$14 THEN now() ELSE consent_updated_at END,
                                consent_privacy=$12, consent_marketing=$13, consent_photos=$14
                              WHERE tenant_id=$1 AND id=$2 AND NOT anonymized RETURNING *`,
      [req.tenant.id, U.int(req.params.id), f.first_name, f.last_name, f.phone, U.normPhone(f.phone), f.email, f.birth_date, f.audience, f.preferences, f.notes, f.consent_privacy, f.consent_marketing, f.consent_photos]);
    if (!row) throw H.notFound();
    await audit(req, 'update', 'customer', row.id);
    return row;
  });

  r.get('/api/admin/customers/:id', async req => {
    auth.require(req.user, 'clients.view');
    const t = req.tenant; const id = U.int(req.params.id, { min: 1 });
    const c = await db.one(`SELECT c.*, ${STATS} FROM customers c WHERE c.tenant_id=$1 AND c.id=$2`, [t.id, id]);
    if (!c) throw H.notFound('Cliente non trovato');
    const finance = auth.can(req.user, 'cash.use') || auth.can(req.user, 'cash.reports');
    const [appointments, notes, photos, packages, giftcards, ledger, sales] = await Promise.all([
      db.many(`SELECT a.id, a.starts_at, a.ends_at, a.status, a.total_cents, a.customer_notes, a.internal_notes, s.name staff_name,
                      (SELECT string_agg(name, ', ' ORDER BY sort) FROM appointment_services x WHERE x.appointment_id=a.id) services
                 FROM appointments a JOIN staff s ON s.id=a.staff_id WHERE a.tenant_id=$1 AND a.customer_id=$2 ORDER BY a.starts_at DESC LIMIT 200`, [t.id, id]),
      db.many(`SELECT n.*, s.name staff_name, u.username FROM customer_notes n LEFT JOIN staff s ON s.id=n.staff_id LEFT JOIN users u ON u.id=n.user_id
                WHERE n.tenant_id=$1 AND n.customer_id=$2 ORDER BY n.created_at DESC`, [t.id, id]),
      db.many(`SELECT id, media_id, label, created_at FROM customer_photos WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at DESC`, [t.id, id]),
      db.many(`SELECT * FROM customer_packages WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at DESC`, [t.id, id]),
      db.many(`SELECT * FROM gift_cards WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at DESC`, [t.id, id]),
      db.many(`SELECT * FROM loyalty_ledger WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at DESC LIMIT 100`, [t.id, id]),
      finance ? db.many(`SELECT s.id, s.closed_at, s.total_cents, s.discount_cents, p.title promo, (SELECT string_agg(name, ', ') FROM sale_items i WHERE i.sale_id=s.id) items
                           FROM sales s LEFT JOIN promotions p ON p.id=s.promotion_id WHERE s.tenant_id=$1 AND s.customer_id=$2 AND s.status='chiusa' ORDER BY s.closed_at DESC LIMIT 200`, [t.id, id]) : [],
    ]);
    const freq = appointments.filter(a => a.status === 'completato').map(a => +new Date(a.starts_at)).sort();
    let avgDays = null;
    if (freq.length > 1) avgDays = Math.round((freq[freq.length - 1] - freq[0]) / 86400000 / (freq.length - 1));
    return { customer: c, appointments, notes, photos, packages, giftcards, ledger, sales, avg_days_between_visits: avgDays };
  });

  r.post('/api/admin/customers/:id/notes', async req => {
    auth.require(req.user, 'clients.edit', 'clients.notes');
    const b = await H.parseJson(req);
    const id = U.int(req.params.id, { min: 1 });
    const ok = await db.one('SELECT 1 FROM customers WHERE tenant_id=$1 AND id=$2', [req.tenant.id, id]);
    if (!ok) throw H.notFound();
    return db.one(`INSERT INTO customer_notes(tenant_id, customer_id, kind, body, staff_id, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.tenant.id, id, U.oneOf(b.kind || 'nota', ['nota', 'formula', 'prodotti', 'tecnica'], 'Tipo'), U.str(b.body, { required: true, max: 4000, name: 'Testo' }),
        b.staff_id ? U.int(b.staff_id) : req.user.staff_id, req.user.id]);
  });
  r.delete('/api/admin/customers/:id/notes/:noteId', async req => {
    auth.require(req.user, 'clients.edit');
    await db.query('DELETE FROM customer_notes WHERE tenant_id=$1 AND customer_id=$2 AND id=$3', [req.tenant.id, U.int(req.params.id), U.int(req.params.noteId)]);
    return { ok: true };
  });

  r.post('/api/admin/customers/:id/photos', async req => {
    auth.require(req.user, 'clients.edit', 'clients.notes');
    const b = await H.parseJson(req);
    const id = U.int(req.params.id, { min: 1 });
    const c = await db.one('SELECT consent_photos FROM customers WHERE tenant_id=$1 AND id=$2', [req.tenant.id, id]);
    if (!c) throw H.notFound();
    if (!c.consent_photos) throw H.bad('Il cliente non ha dato il consenso alle fotografie. Registra prima il consenso nella scheda.');
    const m = await db.one('SELECT id FROM media WHERE tenant_id=$1 AND id=$2', [req.tenant.id, U.int(b.media_id, { min: 1 })]);
    if (!m) throw H.bad('Immagine non valida');
    await db.query('UPDATE media SET is_private=true WHERE id=$1', [m.id]);
    return db.one('INSERT INTO customer_photos(tenant_id, customer_id, media_id, label) VALUES ($1,$2,$3,$4) RETURNING *', [req.tenant.id, id, m.id, U.str(b.label, { max: 100 })]);
  });
  r.delete('/api/admin/customers/:id/photos/:photoId', async req => {
    auth.require(req.user, 'clients.edit');
    const p = await db.one('DELETE FROM customer_photos WHERE tenant_id=$1 AND customer_id=$2 AND id=$3 RETURNING media_id', [req.tenant.id, U.int(req.params.id), U.int(req.params.photoId)]);
    if (p) await db.query('DELETE FROM media WHERE tenant_id=$1 AND id=$2', [req.tenant.id, p.media_id]);
    return { ok: true };
  });

  r.post('/api/admin/customers/:id/points', async req => {
    auth.require(req.user, 'marketing.manage', 'cash.use');
    const b = await H.parseJson(req);
    const id = U.int(req.params.id, { min: 1 });
    const pts = U.int(b.points, { required: true, min: -100000, max: 100000, name: 'Punti' });
    return db.tx(async c => {
      const cu = await c.one('UPDATE customers SET points=points+$3 WHERE tenant_id=$1 AND id=$2 RETURNING points', [req.tenant.id, id, pts]);
      if (!cu) throw H.notFound();
      if (cu.points < 0) throw H.bad('Saldo punti insufficiente');
      await c.query('INSERT INTO loyalty_ledger(tenant_id, customer_id, points, reason) VALUES ($1,$2,$3,$4)', [req.tenant.id, id, pts, U.str(b.reason, { max: 200 }) || 'Rettifica manuale']);
      return cu;
    });
  });

  r.post('/api/admin/customers/:id/merge', async req => {
    auth.require(req.user, 'clients.export');
    const b = await H.parseJson(req);
    const keep = U.int(req.params.id, { min: 1 }); const drop = U.int(b.merge_id, { min: 1 });
    if (keep === drop) throw H.bad('Seleziona due clienti diversi');
    await db.tx(async c => {
      const both = await c.many('SELECT id FROM customers WHERE tenant_id=$1 AND id = ANY($2::int[])', [req.tenant.id, [keep, drop]]);
      if (both.length !== 2) throw H.notFound();
      for (const tbl of ['appointments', 'sales', 'customer_notes', 'customer_photos', 'customer_packages', 'gift_cards', 'loyalty_ledger', 'waitlist', 'notification_log'])
        await c.query(`UPDATE ${tbl} SET customer_id=$1 WHERE customer_id=$2`, [keep, drop]);
      await c.query('UPDATE customers k SET points=k.points + d.points FROM customers d WHERE k.id=$1 AND d.id=$2', [keep, drop]);
      await c.query('DELETE FROM customers WHERE id=$1', [drop]);
    });
    await audit(req, 'merge', 'customer', keep, { merged: drop });
    return { ok: true };
  });

  // ---------- GDPR ----------
  r.get('/api/admin/customers/:id/gdpr-export', async (req, res) => {
    auth.require(req.user, 'clients.export');
    const id = U.int(req.params.id, { min: 1 }); const t = req.tenant;
    const customer = await db.one('SELECT * FROM customers WHERE tenant_id=$1 AND id=$2', [t.id, id]);
    if (!customer) throw H.notFound();
    const data = {
      generated_at: new Date().toISOString(), titolare: t.settings.contact.legal_name || t.settings.brand.name, customer,
      appointments: await db.many('SELECT id, starts_at, ends_at, status, customer_notes, total_cents FROM appointments WHERE tenant_id=$1 AND customer_id=$2', [t.id, id]),
      services: await db.many('SELECT x.name, x.starts_at, x.price_cents FROM appointment_services x JOIN appointments a ON a.id=x.appointment_id WHERE a.tenant_id=$1 AND a.customer_id=$2', [t.id, id]),
      notes: await db.many('SELECT kind, body, created_at FROM customer_notes WHERE tenant_id=$1 AND customer_id=$2', [t.id, id]),
      purchases: await db.many(`SELECT s.closed_at, s.total_cents, (SELECT json_agg(json_build_object('name', name, 'qty', qty, 'total_cents', total_cents)) FROM sale_items WHERE sale_id=s.id) items
                                  FROM sales s WHERE s.tenant_id=$1 AND s.customer_id=$2 AND s.status='chiusa'`, [t.id, id]),
      loyalty: await db.many('SELECT points, reason, created_at FROM loyalty_ledger WHERE tenant_id=$1 AND customer_id=$2', [t.id, id]),
      messages: await db.many('SELECT template_key, channel, status, created_at FROM notification_log WHERE tenant_id=$1 AND customer_id=$2', [t.id, id]),
    };
    await audit(req, 'gdpr_export', 'customer', id);
    H.send(res, 200, JSON.stringify(data, null, 2), { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="dati-cliente-${id}.json"` });
  });

  // Diritto all'oblio: anonimizza i dati personali mantenendo i dati contabili aggregati
  r.post('/api/admin/customers/:id/anonymize', async req => {
    auth.require(req.user, 'clients.export');
    const id = U.int(req.params.id, { min: 1 });
    await db.tx(async c => {
      const row = await c.one(`UPDATE customers SET first_name='Cliente', last_name='anonimizzato #' || id, phone=NULL, phone_norm=NULL, email=NULL, birth_date=NULL,
                               preferences=NULL, notes=NULL, consent_privacy=false, consent_marketing=false, consent_photos=false, anonymized=true, consent_updated_at=now()
                              WHERE tenant_id=$1 AND id=$2 RETURNING id`, [req.tenant.id, id]);
      if (!row) throw H.notFound();
      await c.query('DELETE FROM customer_notes WHERE customer_id=$1', [id]);
      await c.query('DELETE FROM media WHERE id IN (SELECT media_id FROM customer_photos WHERE customer_id=$1)', [id]);
      await c.query('DELETE FROM waitlist WHERE customer_id=$1', [id]);
      await c.query(`UPDATE appointments SET customer_notes=NULL WHERE customer_id=$1`, [id]);
      await c.query(`UPDATE notification_log SET to_addr=NULL, body=NULL WHERE customer_id=$1`, [id]);
    });
    await audit(req, 'gdpr_anonymize', 'customer', id);
    return { ok: true };
  });

  r.get('/api/admin/customers-export.csv', async (req, res) => {
    auth.require(req.user, 'clients.export');
    const rows = await db.many(`SELECT c.id, c.first_name, c.last_name, c.phone, c.email, c.birth_date, c.audience, c.points, c.consent_privacy, c.consent_marketing,
                                       c.last_visit_at, c.created_at, ${STATS} FROM customers c WHERE c.tenant_id=$1 AND NOT c.anonymized ORDER BY c.last_name, c.first_name`, [req.tenant.id]);
    const head = ['id', 'nome', 'cognome', 'telefono', 'email', 'data_nascita', 'categoria', 'punti', 'consenso_privacy', 'consenso_marketing', 'ultima_visita', 'creato', 'visite', 'speso_euro'];
    const lines = [head.join(';')].concat(rows.map(r => [r.id, r.first_name, r.last_name, r.phone, r.email, r.birth_date, r.audience, r.points, r.consent_privacy ? 'si' : 'no',
      r.consent_marketing ? 'si' : 'no', r.last_visit_at, r.created_at, r.visits, (r.spent_cents / 100).toFixed(2).replace('.', ',')].map(csvCell).join(';')));
    await audit(req, 'export', 'customers', null, { count: rows.length });
    H.send(res, 200, '﻿' + lines.join('\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="clienti.csv"' });
  });

  r.delete('/api/admin/customers/:id', async req => {
    auth.require(req.user, 'clients.export');
    try {
      const row = await db.one(`DELETE FROM customers WHERE tenant_id=$1 AND id=$2 AND NOT EXISTS (SELECT 1 FROM sales WHERE customer_id=$2 AND status='chiusa') RETURNING id`, [req.tenant.id, U.int(req.params.id)]);
      if (!row) throw H.conflict('Il cliente ha movimenti di cassa registrati: usa “Anonimizza” per cancellarne i dati personali.');
      return { ok: true };
    } catch (e) { throw dbError(e); }
  });
};
