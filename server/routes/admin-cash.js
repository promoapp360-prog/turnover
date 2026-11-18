'use strict';
/*
 * Cassa, vendite e magazzino.
 * IMPORTANTE: il gestionale registra incassi a fini gestionali. NON emette documenti fiscali
 * (scontrino elettronico / documento commerciale): per quello serve un registratore telematico
 * o un servizio certificato AdE da integrare (vedi docs/INTEGRAZIONI.md).
 */
const db = require('../lib/db');
const H = require('../lib/http');
const U = require('../lib/util');
const auth = require('../lib/auth');
const events = require('../lib/events');
const hooks = require('../lib/hooks');
const { audit } = require('./admin-core');

const METHODS = ['contanti', 'carta', 'bancomat', 'satispay', 'bonifico', 'giftcard', 'acconto', 'altro'];

async function recalc(c, t, saleId) {
  const sale = await c.one('SELECT * FROM sales WHERE tenant_id=$1 AND id=$2', [t.id, saleId]);
  const items = await c.many('SELECT * FROM sale_items WHERE sale_id=$1 ORDER BY id', [saleId]);
  const subtotal = items.reduce((a, i) => a + i.total_cents, 0);
  let promoDiscount = 0;
  if (sale.promotion_id) {
    const p = await c.one('SELECT * FROM promotions WHERE id=$1', [sale.promotion_id]);
    if (p) {
      const eligible = items.filter(i => !p.service_ids.length || (i.kind === 'servizio' && p.service_ids.includes(i.ref_id)));
      const base = eligible.reduce((a, i) => a + i.total_cents, 0);
      promoDiscount = p.kind === 'percent' ? Math.round(base * Math.min(p.value, 100) / 100) : Math.min(base, Math.round(p.value * 100));
    }
  }
  const pointsValue = (sale.points_redeemed || 0) * (t.settings.loyalty.euro_per_point_cents || 0);
  const manual = sale.discount_cents || 0;
  const total = Math.max(0, subtotal - promoDiscount - manual - pointsValue);
  return c.one('UPDATE sales SET subtotal_cents=$2, total_cents=$3 WHERE id=$1 RETURNING *', [saleId, subtotal, total]).then(s => ({ ...s, promo_discount_cents: promoDiscount, points_value_cents: pointsValue }));
}

async function saleDetail(t, id) {
  const s = await db.one(`SELECT s.*, c.first_name, c.last_name, c.points AS customer_points, p.title AS promo_title, p.code AS promo_code
                            FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN promotions p ON p.id=s.promotion_id
                           WHERE s.tenant_id=$1 AND s.id=$2`, [t.id, id]);
  if (!s) throw H.notFound('Conto non trovato');
  const items = await db.many('SELECT i.*, st.name staff_name FROM sale_items i LEFT JOIN staff st ON st.id=i.staff_id WHERE i.sale_id=$1 ORDER BY i.id', [id]);
  const payments = await db.many('SELECT * FROM payments WHERE sale_id=$1 ORDER BY id', [id]);
  const packages = s.customer_id ? await db.many(`SELECT * FROM customer_packages WHERE tenant_id=$1 AND customer_id=$2 AND sessions_used < sessions_total
                                                   AND (expires_on IS NULL OR expires_on >= CURRENT_DATE)`, [t.id, s.customer_id]) : [];
  let recalcd;
  if (s.status === 'aperta') recalcd = await db.tx(c => recalc(c, t, id));
  else {
    const pv = (s.points_redeemed || 0) * (t.settings.loyalty.euro_per_point_cents || 0);
    recalcd = { points_value_cents: pv, promo_discount_cents: Math.max(0, s.subtotal_cents - s.total_cents - s.discount_cents - pv) };
  }
  return { ...s, ...recalcd, first_name: s.first_name, last_name: s.last_name, customer_points: s.customer_points, promo_title: s.promo_title, promo_code: s.promo_code,
    items, payments, packages, paid_cents: payments.reduce((a, p) => a + p.amount_cents, 0), loyalty: t.settings.loyalty };
}

async function openSessionId(c, t) {
  const s = await c.one('SELECT id FROM cash_sessions WHERE tenant_id=$1 AND closed_at IS NULL', [t.id]);
  return s ? s.id : null;
}

async function sessionSummary(t, sessionId) {
  const byMethod = await db.many(`SELECT p.method, sum(p.amount_cents)::int total FROM payments p JOIN sales s ON s.id=p.sale_id
                                   WHERE s.tenant_id=$1 AND s.cash_session_id=$2 AND s.status='chiusa' GROUP BY p.method`, [t.id, sessionId]);
  const count = await db.one(`SELECT count(*)::int n, COALESCE(sum(total_cents),0)::int total FROM sales WHERE tenant_id=$1 AND cash_session_id=$2 AND status='chiusa'`, [t.id, sessionId]);
  return { by_method: byMethod, sales: count.n, total_cents: count.total };
}

module.exports = function (r) {
  // ---------------- Sessione di cassa ----------------
  r.get('/api/admin/cash/session', async req => {
    auth.require(req.user, 'cash.use');
    const s = await db.one(`SELECT cs.*, u.username opened_by_name FROM cash_sessions cs LEFT JOIN users u ON u.id=cs.opened_by WHERE cs.tenant_id=$1 AND cs.closed_at IS NULL`, [req.tenant.id]);
    const openSales = await db.many(`SELECT s.id, s.total_cents, s.created_at, c.first_name, c.last_name, s.appointment_id FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
                                      WHERE s.tenant_id=$1 AND s.status='aperta' ORDER BY s.created_at`, [req.tenant.id]);
    const today = U.todayLocal();
    const closedToday = await db.many(`SELECT s.id, s.total_cents, s.closed_at, c.first_name, c.last_name,
                                          (SELECT string_agg(method, ', ') FROM payments p WHERE p.sale_id=s.id) methods
                                        FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
                                        WHERE s.tenant_id=$1 AND s.status='chiusa' AND s.closed_at >= $2 ORDER BY s.closed_at DESC`, [req.tenant.id, U.localToUtc(today, '00:00')]);
    return { session: s, summary: s ? await sessionSummary(req.tenant, s.id) : null, open_sales: openSales, closed_today: closedToday };
  });
  r.post('/api/admin/cash/open', async req => {
    auth.require(req.user, 'cash.use');
    const b = await H.parseJson(req);
    try {
      return await db.one('INSERT INTO cash_sessions(tenant_id, opened_by, opening_cents) VALUES ($1,$2,$3) RETURNING *', [req.tenant.id, req.user.id, U.cents(b.opening || 0)]);
    } catch (e) { if (e.code === '23505') throw H.conflict('La cassa è già aperta'); throw e; }
  });
  r.post('/api/admin/cash/close', async req => {
    auth.require(req.user, 'cash.use');
    const b = await H.parseJson(req);
    const s = await db.one('SELECT * FROM cash_sessions WHERE tenant_id=$1 AND closed_at IS NULL', [req.tenant.id]);
    if (!s) throw H.bad('Nessuna cassa aperta');
    const sum = await sessionSummary(req.tenant, s.id);
    const cash = (sum.by_method.find(m => m.method === 'contanti') || { total: 0 }).total;
    const cashExpenses = await db.one(`SELECT COALESCE(sum(amount_cents),0)::int t FROM expenses WHERE tenant_id=$1 AND method='contanti' AND created_at >= $2`, [req.tenant.id, s.opened_at]);
    const expected = s.opening_cents + cash - cashExpenses.t;
    const row = await db.one(`UPDATE cash_sessions SET closed_at=now(), closed_by=$2, counted_cents=$3, expected_cents=$4, notes=$5 WHERE id=$1 RETURNING *`,
      [s.id, req.user.id, U.cents(b.counted, { required: true, name: 'Contanti contati' }), expected, U.str(b.notes, { max: 1000 })]);
    await audit(req, 'cash_close', 'cash_session', s.id, { expected, counted: row.counted_cents });
    return { session: row, summary: sum, difference_cents: row.counted_cents - expected };
  });
  r.get('/api/admin/cash/sessions', async req => {
    auth.require(req.user, 'cash.reports');
    return db.many(`SELECT cs.*, uo.username opened_by_name, uc.username closed_by_name,
                       (SELECT COALESCE(sum(total_cents),0)::int FROM sales WHERE cash_session_id=cs.id AND status='chiusa') total_cents
                      FROM cash_sessions cs LEFT JOIN users uo ON uo.id=cs.opened_by LEFT JOIN users uc ON uc.id=cs.closed_by
                     WHERE cs.tenant_id=$1 ORDER BY cs.opened_at DESC LIMIT 100`, [req.tenant.id]);
  });

  // ---------------- Vendite / conti ----------------
  r.post('/api/admin/sales', async req => {
    auth.require(req.user, 'cash.use');
    const t = req.tenant;
    const b = await H.parseJson(req);
    const apptId = b.appointment_id ? U.int(b.appointment_id, { min: 1 }) : null;
    const id = await db.tx(async c => {
      let customerId = b.customer_id ? U.int(b.customer_id, { min: 1 }) : null;
      let appt = null;
      if (apptId) {
        appt = await c.one('SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2', [t.id, apptId]);
        if (!appt) throw H.bad('Appuntamento non valido');
        const existing = await c.one(`SELECT id FROM sales WHERE appointment_id=$1 AND status<>'annullata'`, [apptId]);
        if (existing) return existing.id;
        customerId = appt.customer_id;
      }
      if (customerId) { const ok = await c.one('SELECT 1 FROM customers WHERE tenant_id=$1 AND id=$2', [t.id, customerId]); if (!ok) throw H.bad('Cliente non valido'); }
      const sale = await c.one(`INSERT INTO sales(tenant_id, customer_id, appointment_id, user_id) VALUES ($1,$2,$3,$4) RETURNING id`, [t.id, customerId, apptId, req.user.id]);
      if (appt) {
        const items = await c.many('SELECT * FROM appointment_services WHERE appointment_id=$1 ORDER BY sort', [apptId]);
        for (const it of items) {
          await c.query(`INSERT INTO sale_items(tenant_id, sale_id, kind, ref_id, name, qty, unit_cents, total_cents, staff_id) VALUES ($1,$2,'servizio',$3,$4,1,$5,$5,$6)`,
            [t.id, sale.id, it.service_id, it.name, it.price_cents, appt.staff_id]);
        }
      }
      return sale.id;
    });
    return saleDetail(t, id);
  });

  r.get('/api/admin/sales', async req => {
    auth.require(req.user, 'cash.use');
    const from = U.date(req.query.from || U.todayLocal()); const to = U.date(req.query.to || from);
    return db.many(`SELECT s.*, c.first_name, c.last_name, (SELECT string_agg(name, ', ') FROM sale_items WHERE sale_id=s.id) items,
                           (SELECT string_agg(method || ' ' || to_char(amount_cents/100.0, 'FM999990.00'), ', ') FROM payments WHERE sale_id=s.id) pays
                      FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
                     WHERE s.tenant_id=$1 AND COALESCE(s.closed_at, s.created_at) >= $2 AND COALESCE(s.closed_at, s.created_at) < $3 ORDER BY s.id DESC`,
      [req.tenant.id, U.localToUtc(from, '00:00'), U.localToUtc(U.addDays(to, 1), '00:00')]);
  });

  r.get('/api/admin/sales/:id', async req => { auth.require(req.user, 'cash.use'); return saleDetail(req.tenant, U.int(req.params.id, { min: 1 })); });

  async function openSale(c, t, id) {
    const s = await c.one('SELECT * FROM sales WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [t.id, id]);
    if (!s) throw H.notFound('Conto non trovato');
    if (s.status !== 'aperta') throw H.bad('Il conto è già chiuso');
    return s;
  }

  r.post('/api/admin/sales/:id/items', async req => {
    auth.require(req.user, 'cash.use');
    const t = req.tenant; const id = U.int(req.params.id, { min: 1 });
    const b = await H.parseJson(req);
    await db.tx(async c => {
      const sale = await openSale(c, t, id);
      const kind = U.oneOf(b.kind, ['servizio', 'prodotto', 'pacchetto', 'giftcard'], 'Tipo');
      const qty = U.num(b.qty || 1, { min: 0.01, max: 999, name: 'Quantità' });
      let name, unit, ref = b.ref_id ? U.int(b.ref_id, { min: 1 }) : null, cpId = null;
      if (kind === 'servizio') {
        const s = await c.one('SELECT * FROM services WHERE tenant_id=$1 AND id=$2', [t.id, ref]); if (!s) throw H.bad('Servizio non valido');
        name = s.name; unit = s.price_cents;
        if (b.customer_package_id) {
          const cp = await c.one('SELECT * FROM customer_packages WHERE tenant_id=$1 AND id=$2 AND customer_id=$3', [t.id, U.int(b.customer_package_id), sale.customer_id]);
          if (!cp || cp.sessions_used >= cp.sessions_total) throw H.bad('Pacchetto non utilizzabile');
          cpId = cp.id; unit = 0; name = `${s.name} (pacchetto: ${cp.name})`;
        }
      } else if (kind === 'prodotto') {
        const p = await c.one('SELECT * FROM products WHERE tenant_id=$1 AND id=$2 AND active', [t.id, ref]); if (!p) throw H.bad('Prodotto non valido');
        name = p.name; unit = p.price_cents;
      } else if (kind === 'pacchetto') {
        if (!sale.customer_id) throw H.bad('Associa un cliente al conto per vendere un pacchetto');
        const p = await c.one('SELECT * FROM packages WHERE tenant_id=$1 AND id=$2 AND active', [t.id, ref]); if (!p) throw H.bad('Pacchetto non valido');
        name = `Pacchetto: ${p.name}`; unit = p.price_cents;
      } else {
        unit = U.cents(b.unit_euro, { required: true, name: 'Importo gift card' });
        if (unit <= 0) throw H.bad('Importo gift card non valido');
        name = `Gift card ${U.euro(unit)}`; ref = null;
      }
      if (b.unit_euro !== undefined && kind !== 'giftcard' && !cpId) unit = U.cents(b.unit_euro, { name: 'Prezzo' }); // prezzo modificato manualmente
      const disc = U.cents(b.discount_euro || 0) || 0;
      const total = Math.max(0, Math.round(unit * qty) - disc);
      await c.query(`INSERT INTO sale_items(tenant_id, sale_id, kind, ref_id, name, qty, unit_cents, discount_cents, total_cents, staff_id, customer_package_id)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [t.id, id, kind, ref, name, qty, unit, disc, total, b.staff_id ? U.int(b.staff_id) : null, cpId]);
      await recalc(c, t, id);
    });
    return saleDetail(t, id);
  });

  r.delete('/api/admin/sales/:id/items/:itemId', async req => {
    auth.require(req.user, 'cash.use');
    const t = req.tenant; const id = U.int(req.params.id, { min: 1 });
    await db.tx(async c => {
      await openSale(c, t, id);
      await c.query('DELETE FROM sale_items WHERE sale_id=$1 AND id=$2', [id, U.int(req.params.itemId)]);
      await recalc(c, t, id);
    });
    return saleDetail(t, id);
  });

  r.put('/api/admin/sales/:id', async req => {
    auth.require(req.user, 'cash.use');
    const t = req.tenant; const id = U.int(req.params.id, { min: 1 });
    const b = await H.parseJson(req);
    await db.tx(async c => {
      const sale = await openSale(c, t, id);
      if (b.customer_id !== undefined) {
        const cid = b.customer_id ? U.int(b.customer_id, { min: 1 }) : null;
        if (cid) { const ok = await c.one('SELECT 1 FROM customers WHERE tenant_id=$1 AND id=$2', [t.id, cid]); if (!ok) throw H.bad('Cliente non valido'); }
        await c.query('UPDATE sales SET customer_id=$2, points_redeemed=0 WHERE id=$1', [id, cid]);
      }
      if (b.discount_euro !== undefined) await c.query('UPDATE sales SET discount_cents=$2 WHERE id=$1', [id, U.cents(b.discount_euro || 0) || 0]);
      if (b.notes !== undefined) await c.query('UPDATE sales SET notes=$2 WHERE id=$1', [id, U.str(b.notes, { max: 1000 })]);
      if (b.promotion_code !== undefined || b.promotion_id !== undefined) {
        let promo = null;
        if (b.promotion_code) promo = await c.one('SELECT * FROM promotions WHERE tenant_id=$1 AND upper(code)=upper($2)', [t.id, String(b.promotion_code).trim()]);
        else if (b.promotion_id) promo = await c.one('SELECT * FROM promotions WHERE tenant_id=$1 AND id=$2', [t.id, U.int(b.promotion_id)]);
        if ((b.promotion_code || b.promotion_id) && !promo) throw H.bad('Promozione non trovata');
        if (promo) {
          const today = U.todayLocal();
          if (!promo.active || (promo.starts_on && promo.starts_on > today) || (promo.ends_on && promo.ends_on < today)) throw H.bad('Promozione non attiva oggi');
          if (promo.max_uses && promo.uses >= promo.max_uses) throw H.bad('Promozione esaurita');
          if (promo.birthday) {
            const cu = sale.customer_id ? await c.one('SELECT birth_date FROM customers WHERE id=$1', [sale.customer_id]) : null;
            if (!cu || !cu.birth_date || cu.birth_date.slice(5, 7) !== today.slice(5, 7)) throw H.bad('Promozione valida solo nel mese di compleanno del cliente');
          }
        }
        await c.query('UPDATE sales SET promotion_id=$2 WHERE id=$1', [id, promo ? promo.id : null]);
      }
      if (b.points_redeemed !== undefined) {
        const pts = U.int(b.points_redeemed || 0, { min: 0, name: 'Punti' });
        if (pts) {
          if (!t.settings.loyalty.enabled) throw H.bad('Programma fedeltà disattivato');
          const cu = await c.one('SELECT points FROM customers WHERE id=$1', [sale.customer_id]);
          if (!cu || cu.points < pts) throw H.bad('Punti insufficienti');
          if (pts < t.settings.loyalty.min_redeem_points) throw H.bad(`Minimo ${t.settings.loyalty.min_redeem_points} punti per lo sconto`);
        }
        await c.query('UPDATE sales SET points_redeemed=$2 WHERE id=$1', [id, pts]);
      }
      await recalc(c, t, id);
    });
    return saleDetail(t, id);
  });

  // Chiusura conto: pagamenti (anche misti), gift card, pacchetti, magazzino, punti, stato appuntamento
  r.post('/api/admin/sales/:id/close', async req => {
    auth.require(req.user, 'cash.use');
    const t = req.tenant; const id = U.int(req.params.id, { min: 1 });
    const b = await H.parseJson(req);
    const result = await db.tx(async c => {
      await openSale(c, t, id);
      const sale = await recalc(c, t, id);
      const items = await c.many('SELECT * FROM sale_items WHERE sale_id=$1', [id]);
      if (!items.length) throw H.bad('Il conto è vuoto');
      const payments = (b.payments || []).map(p => ({ method: U.oneOf(p.method, METHODS, 'Metodo di pagamento'), amount: U.cents(p.amount_euro, { required: true, name: 'Importo' }), ref: U.str(p.ref, { max: 60 }) })).filter(p => p.amount > 0);
      const paid = payments.reduce((a, p) => a + p.amount, 0);
      if (paid !== sale.total_cents) throw H.bad(`I pagamenti (${U.euro(paid)}) non corrispondono al totale (${U.euro(sale.total_cents)})`);
      const sessionId = await openSessionId(c, t);
      if (!sessionId && payments.some(p => p.method === 'contanti')) throw H.bad('Apri la cassa prima di registrare pagamenti in contanti');
      for (const p of payments) {
        if (p.method === 'giftcard') {
          if (!p.ref) throw H.bad('Indica il codice della gift card');
          const g = await c.one(`SELECT * FROM gift_cards WHERE tenant_id=$1 AND upper(code)=upper($2) FOR UPDATE`, [t.id, p.ref.trim()]);
          if (!g || g.status !== 'attiva' || (g.expires_on && g.expires_on < U.todayLocal())) throw H.bad('Gift card non valida o scaduta');
          if (g.balance_cents < p.amount) throw H.bad(`Saldo gift card insufficiente (${U.euro(g.balance_cents)})`);
          await c.query(`UPDATE gift_cards SET balance_cents=balance_cents-$2, status=CASE WHEN balance_cents-$2=0 THEN 'esaurita' ELSE status END WHERE id=$1`, [g.id, p.amount]);
          p.ref = g.code;
        }
        await c.query('INSERT INTO payments(tenant_id, sale_id, method, amount_cents, ref) VALUES ($1,$2,$3,$4,$5)', [t.id, id, p.method, p.amount, p.ref]);
      }
      const created = { giftcards: [], packages: [] };
      for (const it of items) {
        if (it.kind === 'prodotto') {
          await c.query('UPDATE products SET stock=stock-$2 WHERE id=$1', [it.ref_id, it.qty]);
          await c.query(`INSERT INTO stock_movements(tenant_id, product_id, qty, kind, sale_id, user_id, note) VALUES ($1,$2,$3,'vendita',$4,$5,'Vendita al banco')`, [t.id, it.ref_id, -it.qty, id, req.user.id]);
        }
        if (it.customer_package_id) {
          const cp = await c.one('UPDATE customer_packages SET sessions_used=sessions_used+1 WHERE id=$1 AND sessions_used < sessions_total RETURNING id', [it.customer_package_id]);
          if (!cp) throw H.bad('Sedute del pacchetto esaurite');
        }
        if (it.kind === 'pacchetto') {
          const p = await c.one('SELECT * FROM packages WHERE id=$1', [it.ref_id]);
          for (let q = 0; q < Math.round(it.qty); q++) {
            const cp = await c.one(`INSERT INTO customer_packages(tenant_id, customer_id, package_id, name, service_id, sessions_total, expires_on, sale_id)
                                    VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $7::int IS NULL THEN NULL ELSE CURRENT_DATE + $7::int END, $8) RETURNING *`,
              [t.id, sale.customer_id, p.id, p.name, p.service_id, p.sessions, p.validity_days, id]);
            created.packages.push(cp);
          }
        }
        if (it.kind === 'giftcard') {
          for (let q = 0; q < Math.round(it.qty); q++) {
            const g = await c.one(`INSERT INTO gift_cards(tenant_id, code, initial_cents, balance_cents, customer_id, sale_id, expires_on) VALUES ($1,$2,$3,$3,$4,$5, CURRENT_DATE + 365) RETURNING *`,
              [t.id, U.giftCode(), it.unit_cents, sale.customer_id, id]);
            created.giftcards.push(g);
          }
        }
      }
      let earned = 0;
      if (sale.customer_id && t.settings.loyalty.enabled) {
        if (sale.points_redeemed) {
          const cu = await c.one('UPDATE customers SET points=points-$2 WHERE id=$1 AND points >= $2 RETURNING id', [sale.customer_id, sale.points_redeemed]);
          if (!cu) throw H.bad('Punti insufficienti');
          await c.query('INSERT INTO loyalty_ledger(tenant_id, customer_id, points, reason, sale_id) VALUES ($1,$2,$3,$4,$5)', [t.id, sale.customer_id, -sale.points_redeemed, 'Sconto fedeltà', id]);
        }
        const eligible = payments.filter(p => p.method !== 'giftcard').reduce((a, p) => a + p.amount, 0);
        earned = Math.floor(eligible / 100 * (t.settings.loyalty.points_per_euro || 0));
        if (earned > 0) {
          await c.query('UPDATE customers SET points=points+$2 WHERE id=$1', [sale.customer_id, earned]);
          await c.query('INSERT INTO loyalty_ledger(tenant_id, customer_id, points, reason, sale_id) VALUES ($1,$2,$3,$4,$5)', [t.id, sale.customer_id, earned, 'Acquisto', id]);
        }
      }
      if (sale.promotion_id) await c.query('UPDATE promotions SET uses=uses+1 WHERE id=$1', [sale.promotion_id]);
      await c.query(`UPDATE sales SET status='chiusa', closed_at=now(), cash_session_id=$2, points_earned=$3 WHERE id=$1`, [id, sessionId, earned]);
      let appt = null;
      if (sale.appointment_id) {
        appt = await c.one(`UPDATE appointments SET status='completato', version=version+1, updated_at=now() WHERE id=$1 AND status NOT IN ('cancellato') RETURNING *`, [sale.appointment_id]);
      }
      if (sale.customer_id) await c.query('UPDATE customers SET last_visit_at=now() WHERE id=$1', [sale.customer_id]);
      return { created, appt };
    });
    if (result.appt) hooks.onStatus(t, result.appt, 'in_lavorazione');
    events.publish(t.id, 'cash', {});
    await audit(req, 'sale_close', 'sale', id);
    return { ...(await saleDetail(t, id)), created: result.created };
  });

  // Annullamento: conto aperto -> annullato; conto chiuso -> storno completo (solo responsabile/admin)
  r.post('/api/admin/sales/:id/void', async req => {
    const t = req.tenant; const id = U.int(req.params.id, { min: 1 });
    const b = await H.parseJson(req);
    await db.tx(async c => {
      const s = await c.one('SELECT * FROM sales WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [t.id, id]);
      if (!s) throw H.notFound();
      if (s.status === 'annullata') throw H.bad('Conto già annullato');
      if (s.status === 'aperta') { auth.require(req.user, 'cash.use'); await c.query(`UPDATE sales SET status='annullata' WHERE id=$1`, [id]); return; }
      auth.require(req.user, 'cash.reports');
      const items = await c.many('SELECT * FROM sale_items WHERE sale_id=$1', [id]);
      for (const it of items) {
        if (it.kind === 'prodotto') {
          await c.query('UPDATE products SET stock=stock+$2 WHERE id=$1', [it.ref_id, it.qty]);
          await c.query(`INSERT INTO stock_movements(tenant_id, product_id, qty, kind, sale_id, user_id, note) VALUES ($1,$2,$3,'reso',$4,$5,'Storno vendita')`, [t.id, it.ref_id, it.qty, id, req.user.id]);
        }
        if (it.customer_package_id) await c.query('UPDATE customer_packages SET sessions_used=GREATEST(sessions_used-1,0) WHERE id=$1', [it.customer_package_id]);
      }
      const usedPk = await c.one('SELECT count(*)::int n FROM customer_packages WHERE sale_id=$1 AND sessions_used>0', [id]);
      if (usedPk.n) throw H.bad('Un pacchetto venduto in questo conto è già stato utilizzato: storno non possibile');
      await c.query('DELETE FROM customer_packages WHERE sale_id=$1', [id]);
      const gUsed = await c.one('SELECT count(*)::int n FROM gift_cards WHERE sale_id=$1 AND balance_cents < initial_cents', [id]);
      if (gUsed.n) throw H.bad('Una gift card venduta in questo conto è già stata utilizzata: storno non possibile');
      await c.query(`UPDATE gift_cards SET status='annullata', balance_cents=0 WHERE sale_id=$1`, [id]);
      for (const p of await c.many(`SELECT * FROM payments WHERE sale_id=$1 AND method='giftcard'`, [id]))
        await c.query(`UPDATE gift_cards SET balance_cents=balance_cents+$3, status='attiva' WHERE tenant_id=$1 AND upper(code)=upper($2)`, [t.id, p.ref, p.amount_cents]);
      const pts = await c.one('SELECT COALESCE(sum(points),0)::int n FROM loyalty_ledger WHERE sale_id=$1', [id]);
      if (pts.n && s.customer_id) {
        await c.query('UPDATE customers SET points=points-$2 WHERE id=$1', [s.customer_id, pts.n]);
        await c.query('INSERT INTO loyalty_ledger(tenant_id, customer_id, points, reason, sale_id) VALUES ($1,$2,$3,$4,$5)', [t.id, s.customer_id, -pts.n, 'Storno vendita', id]);
      }
      if (s.promotion_id) await c.query('UPDATE promotions SET uses=GREATEST(uses-1,0) WHERE id=$1', [s.promotion_id]);
      await c.query(`UPDATE sales SET status='annullata', notes=COALESCE(notes,'') || $2 WHERE id=$1`, [id, ` [Stornato: ${U.str(b.reason, { max: 200 }) || 'nessun motivo'}]`]);
    });
    await audit(req, 'sale_void', 'sale', id);
    events.publish(t.id, 'cash', {});
    return { ok: true };
  });

  r.get('/api/admin/giftcards/lookup', async req => {
    auth.require(req.user, 'cash.use');
    const g = await db.one('SELECT g.*, c.first_name, c.last_name FROM gift_cards g LEFT JOIN customers c ON c.id=g.customer_id WHERE g.tenant_id=$1 AND upper(g.code)=upper($2)', [req.tenant.id, String(req.query.code || '').trim()]);
    if (!g) throw H.notFound('Gift card non trovata');
    return g;
  });

  // ---------------- Magazzino ----------------
  r.post('/api/admin/stock/move', async req => {
    auth.require(req.user, 'inventory.manage');
    const t = req.tenant;
    const b = await H.parseJson(req);
    const kind = U.oneOf(b.kind, ['carico', 'scarico', 'uso', 'rettifica'], 'Tipo movimento');
    let qty = U.num(b.qty, { required: true, min: -100000, max: 100000, name: 'Quantità' });
    if (kind === 'carico') qty = Math.abs(qty); if (kind === 'scarico' || kind === 'uso') qty = -Math.abs(qty);
    return db.tx(async c => {
      const p = await c.one('SELECT * FROM products WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [t.id, U.int(b.product_id, { min: 1 })]);
      if (!p) throw H.bad('Prodotto non valido');
      const cost = b.unit_cost_euro !== undefined && b.unit_cost_euro !== '' ? U.cents(b.unit_cost_euro) : null;
      await c.query(`INSERT INTO stock_movements(tenant_id, product_id, qty, kind, note, user_id, unit_cost_cents, appointment_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [t.id, p.id, qty, kind, U.str(b.note, { max: 300 }), req.user.id, cost, b.appointment_id ? U.int(b.appointment_id) : null]);
      if (kind === 'carico' && cost !== null) await c.query('UPDATE products SET cost_cents=$2 WHERE id=$1', [p.id, cost]);
      return c.one('UPDATE products SET stock=stock+$2 WHERE id=$1 RETURNING *', [p.id, qty]);
    });
  });
  r.get('/api/admin/stock/movements', async req => {
    auth.require(req.user, 'inventory.manage', 'inventory.view');
    const pid = req.query.product_id ? U.int(req.query.product_id) : null;
    return db.many(`SELECT m.*, p.name product_name, p.unit, u.username FROM stock_movements m JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.user_id
                     WHERE m.tenant_id=$1 AND ($2::int IS NULL OR m.product_id=$2) ORDER BY m.created_at DESC LIMIT 300`, [req.tenant.id, pid]);
  });
  r.get('/api/admin/inventory/summary', async req => {
    auth.require(req.user, 'inventory.manage', 'inventory.view');
    const t = req.tenant;
    const value = await db.one(`SELECT COALESCE(sum(GREATEST(stock,0) * cost_cents),0)::bigint cost_value, COALESCE(sum(GREATEST(stock,0) * price_cents),0)::bigint retail_value,
                                       count(*) FILTER (WHERE stock <= min_stock AND active)::int low_count, count(*) FILTER (WHERE active)::int products
                                  FROM products WHERE tenant_id=$1`, [t.id]);
    const low = await db.many('SELECT id, name, stock, min_stock, unit FROM products WHERE tenant_id=$1 AND active AND stock <= min_stock ORDER BY stock - min_stock', [t.id]);
    const top = await db.many(`SELECT p.id, p.name, sum(i.qty)::float qty, sum(i.total_cents)::int revenue FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN products p ON p.id=i.ref_id
                                WHERE s.tenant_id=$1 AND s.status='chiusa' AND i.kind='prodotto' AND s.closed_at > now() - interval '90 days' GROUP BY p.id ORDER BY qty DESC LIMIT 10`, [t.id]);
    return { ...value, low, top };
  });
};
