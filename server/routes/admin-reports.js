'use strict';
// Dashboard e report: tutti i valori sono calcolati dai dati registrati (nessuna statistica inventata)
const db = require('../lib/db');
const H = require('../lib/http');
const U = require('../lib/util');
const auth = require('../lib/auth');

function range(q) {
  const today = U.todayLocal();
  const to = U.date(q.to || today);
  const from = U.date(q.from || U.addDays(to, -29));
  if (to < from) throw H.bad('Intervallo non valido');
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > 731) throw H.bad('Intervallo massimo: 2 anni');
  return { from, to, days, start: U.localToUtc(from, '00:00'), end: U.localToUtc(U.addDays(to, 1), '00:00'),
    prevStart: U.localToUtc(U.addDays(from, -days), '00:00'), prevEnd: U.localToUtc(from, '00:00') };
}

module.exports = function (r) {
  r.get('/api/admin/dashboard', async req => {
    auth.require(req.user, 'dashboard.view');
    const t = req.tenant; const tz = U.TZ;
    const fin = auth.can(req.user, 'dashboard.finance');
    const R = range(req.query);
    const staffF = req.query.staff_id ? U.int(req.query.staff_id, { min: 1 }) : null;
    const audF = ['donna', 'uomo', 'bambino'].includes(req.query.audience) ? req.query.audience : null;
    const today = U.todayLocal();
    const tStart = U.localToUtc(today, '00:00'), tEnd = U.localToUtc(U.addDays(today, 1), '00:00');
    const wd = U.weekdayOf(today); const wStart = U.localToUtc(U.addDays(today, -((wd + 6) % 7)), '00:00'); const wEnd = new Date(+wStart + 7 * 86400000);
    const mFrom = today.slice(0, 8) + '01';
    const mStart = U.localToUtc(mFrom, '00:00');
    const pmFrom = U.addDays(mFrom, -1).slice(0, 8) + '01';
    const pmStart = U.localToUtc(pmFrom, '00:00');
    const pmSameDay = U.localToUtc(U.addDays(pmFrom, Math.min(+today.slice(8, 10), 28)), '00:00');

    const apptFilter = `a.tenant_id=$1 AND ($2::int IS NULL OR a.staff_id=$2) AND ($3::text IS NULL OR EXISTS (
        SELECT 1 FROM appointment_services x JOIN services s ON s.id=x.service_id WHERE x.appointment_id=a.id AND s.audience=$3))`;
    const P = [t.id, staffF, audF];

    const k = await db.one(`SELECT
        count(*) FILTER (WHERE a.starts_at >= $4 AND a.starts_at < $5 AND a.status NOT IN ('cancellato'))::int today,
        count(*) FILTER (WHERE a.starts_at >= $6 AND a.starts_at < $7 AND a.status NOT IN ('cancellato'))::int week,
        count(*) FILTER (WHERE a.status='in_attesa' AND a.starts_at > now())::int pending,
        count(*) FILTER (WHERE a.status IN ('arrivato','in_lavorazione'))::int present
      FROM appointments a WHERE ${apptFilter}`, [...P, tStart, tEnd, wStart, wEnd]);

    const period = await db.one(`SELECT count(*)::int total,
        count(*) FILTER (WHERE status='cancellato')::int cancelled,
        count(*) FILTER (WHERE status='assente')::int no_show,
        count(*) FILTER (WHERE status='completato')::int completed,
        count(*) FILTER (WHERE source='online')::int online
      FROM appointments a WHERE ${apptFilter} AND a.starts_at >= $4 AND a.starts_at < $5`, [...P, R.start, R.end]);

    const clients = await db.one(`SELECT
        (SELECT count(*) FROM customers WHERE tenant_id=$1 AND created_at >= $2 AND created_at < $3 AND NOT anonymized)::int new_clients,
        (SELECT count(DISTINCT customer_id) FROM appointments a WHERE a.tenant_id=$1 AND a.status='completato' AND a.starts_at >= $2 AND a.starts_at < $3
            AND EXISTS (SELECT 1 FROM appointments b WHERE b.customer_id=a.customer_id AND b.status='completato' AND b.starts_at < $2))::int returning_clients,
        (SELECT count(DISTINCT customer_id) FROM appointments a WHERE a.tenant_id=$1 AND a.status='completato' AND a.starts_at >= $2 AND a.starts_at < $3)::int served_clients`,
      [t.id, R.start, R.end]);

    const topServices = await db.many(`SELECT x.name, count(*)::int n, sum(x.price_cents)::int value FROM appointment_services x JOIN appointments a ON a.id=x.appointment_id
        WHERE ${apptFilter} AND a.status NOT IN ('cancellato','assente') AND a.starts_at >= $4 AND a.starts_at < $5 GROUP BY x.name ORDER BY n DESC LIMIT 8`, [...P, R.start, R.end]);
    const busyStaff = await db.many(`SELECT s.name, s.color, count(a.*)::int n, COALESCE(sum(EXTRACT(EPOCH FROM (a.ends_at-a.starts_at))/60),0)::int minutes
        FROM appointments a JOIN staff s ON s.id=a.staff_id WHERE ${apptFilter} AND a.status NOT IN ('cancellato','assente') AND a.starts_at >= $4 AND a.starts_at < $5
        GROUP BY s.id ORDER BY minutes DESC`, [...P, R.start, R.end]);
    const upcoming = await db.many(`SELECT a.id, a.starts_at, a.status, c.first_name, c.last_name, s.name staff_name, s.color,
          (SELECT string_agg(name, ', ' ORDER BY sort) FROM appointment_services x WHERE x.appointment_id=a.id) services
        FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id JOIN staff s ON s.id=a.staff_id
        WHERE ${apptFilter} AND a.starts_at >= $4 AND a.starts_at < $5 AND a.status NOT IN ('cancellato') ORDER BY a.starts_at LIMIT 30`, [...P, tStart, tEnd]);

    const out = { range: R, kpi: k, period, clients, top_services: topServices, busy_staff: busyStaff, today: upcoming, finance: null };
    out.period.cancel_rate = period.total ? Math.round(period.cancelled / period.total * 1000) / 10 : 0;
    out.period.no_show_rate = period.total ? Math.round(period.no_show / period.total * 1000) / 10 : 0;

    if (fin) {
      const saleF = `s.tenant_id=$1 AND s.status='chiusa'`;
      const money = await db.one(`SELECT
          COALESCE(sum(total_cents) FILTER (WHERE closed_at >= $2 AND closed_at < $3),0)::int AS today,
          COALESCE(sum(total_cents) FILTER (WHERE closed_at >= $4),0)::int AS month,
          COALESCE(sum(total_cents) FILTER (WHERE closed_at >= $5 AND closed_at < $6),0)::int AS prev_month_same_period,
          COALESCE(sum(total_cents) FILTER (WHERE closed_at >= $7 AND closed_at < $8),0)::int AS period,
          COALESCE(sum(total_cents) FILTER (WHERE closed_at >= $9 AND closed_at < $7),0)::int AS prev_period,
          count(*) FILTER (WHERE closed_at >= $7 AND closed_at < $8)::int AS period_sales
        FROM sales s WHERE ${saleF}`, [t.id, tStart, tEnd, mStart, pmStart, pmSameDay, R.start, R.end, R.prevStart]);
      money.avg_ticket = money.period_sales ? Math.round(money.period / money.period_sales) : 0;
      const series = await db.many(`SELECT to_char(closed_at AT TIME ZONE '${tz}', 'YYYY-MM-DD') d, sum(total_cents)::int v
          FROM sales s WHERE ${saleF} AND closed_at >= $2 AND closed_at < $3 GROUP BY 1 ORDER BY 1`, [t.id, R.start, R.end]);
      const map = new Map(series.map(s => [s.d, s.v]));
      const points = [];
      for (let i = 0; i < R.days; i++) { const d = U.addDays(R.from, i); points.push({ d, v: map.get(d) || 0 }); }
      const topProducts = await db.many(`SELECT i.name, sum(i.qty)::float qty, sum(i.total_cents)::int revenue FROM sale_items i JOIN sales s ON s.id=i.sale_id
          WHERE ${saleF} AND i.kind='prodotto' AND s.closed_at >= $2 AND s.closed_at < $3 GROUP BY i.name ORDER BY qty DESC LIMIT 8`, [t.id, R.start, R.end]);
      out.finance = { ...money, series: points, top_products: topProducts };
    }
    return out;
  });

  r.get('/api/admin/reports', async req => {
    auth.require(req.user, 'cash.reports');
    const t = req.tenant; const R = range(req.query);
    const p = [t.id, R.start, R.end];
    const base = `s.tenant_id=$1 AND s.status='chiusa' AND s.closed_at >= $2 AND s.closed_at < $3`;
    const [byService, byStaff, byMethod, byKind, expenses, totals, byDay] = await Promise.all([
      db.many(`SELECT i.name, count(*)::int n, sum(i.total_cents)::int revenue FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE ${base} AND i.kind='servizio' GROUP BY i.name ORDER BY revenue DESC`, p),
      db.many(`SELECT st.id, st.name, st.commission_pct, count(DISTINCT s.id)::int sales, COALESCE(sum(i.total_cents) FILTER (WHERE i.kind='servizio'),0)::int services_revenue,
                      COALESCE(sum(i.total_cents) FILTER (WHERE i.kind='prodotto'),0)::int products_revenue
                 FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN staff st ON st.id=i.staff_id WHERE ${base} GROUP BY st.id ORDER BY services_revenue DESC`, p),
      db.many(`SELECT pm.method, sum(pm.amount_cents)::int total FROM payments pm JOIN sales s ON s.id=pm.sale_id WHERE ${base} GROUP BY pm.method ORDER BY total DESC`, p),
      db.many(`SELECT i.kind, sum(i.total_cents)::int total FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE ${base} GROUP BY i.kind`, p),
      db.many(`SELECT category, sum(amount_cents)::int total FROM expenses WHERE tenant_id=$1 AND spent_on BETWEEN $2 AND $3 GROUP BY category ORDER BY total DESC`, [t.id, R.from, R.to]),
      db.one(`SELECT COALESCE(sum(total_cents),0)::int revenue, COALESCE(sum(subtotal_cents - total_cents),0)::int discounts, count(*)::int sales FROM sales s WHERE ${base}`, p),
      db.many(`SELECT to_char(s.closed_at AT TIME ZONE '${U.TZ}', 'YYYY-MM-DD') d, sum(total_cents)::int v FROM sales s WHERE ${base} GROUP BY 1 ORDER BY 1`, p),
    ]);
    byStaff.forEach(s => { s.commission_cents = Math.round(s.services_revenue * (s.commission_pct || 0) / 100); });
    const expTotal = expenses.reduce((a, e) => a + e.total, 0);
    return { range: R, by_service: byService, by_staff: byStaff, by_method: byMethod, by_kind: byKind, expenses, expenses_total: expTotal, totals, net_cents: totals.revenue - expTotal, by_day: byDay };
  });
};
