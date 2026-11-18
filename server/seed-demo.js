'use strict';
/*
 * Dati DIMOSTRATIVI (facoltativi) per provare il gestionale: clienti e appuntamenti finti, marcati is_demo=true.
 * Si eliminano in un clic da Impostazioni > Dati dimostrativi. Non usare in produzione con clienti reali.
 */
const db = require('./lib/db');
const log = require('./lib/log');
const U = require('./lib/util');
const tenants = require('./lib/tenant');
const booking = require('./lib/booking');

const NAMES = [['Giulia', 'Rossi', 'donna'], ['Marco', 'Bianchi', 'uomo'], ['Sara', 'Colombo', 'donna'], ['Luca', 'Ferrari', 'uomo'], ['Chiara', 'Ricci', 'donna'],
  ['Francesca', 'Galli', 'donna'], ['Andrea', 'Conti', 'uomo'], ['Elena', 'Marino', 'donna'], ['Matteo', 'Greco', 'bambino'], ['Valentina', 'Bruno', 'donna'],
  ['Alessandra', 'Fontana', 'donna'], ['Davide', 'Moretti', 'uomo'], ['Martina', 'Barbieri', 'donna'], ['Sofia', 'Lombardi', 'bambino'], ['Paola', 'Gatti', 'donna']];

async function run() {
  await db.migrate();
  const tRow = await db.one(`SELECT id FROM tenants WHERE slug=$1`, [process.env.DEFAULT_TENANT || 'turnover']);
  if (!tRow) throw new Error('Esegui prima il seed principale');
  const t = await tenants.byId(tRow.id);
  const services = await db.many('SELECT * FROM services WHERE tenant_id=$1 AND active', [t.id]);
  const staff = await db.many('SELECT * FROM staff WHERE tenant_id=$1 AND active', [t.id]);
  const byAud = a => services.filter(s => s.audience === a);
  const custs = [];
  for (const [i, [fn, ln, aud]] of NAMES.entries()) {
    custs.push(await db.one(`INSERT INTO customers(tenant_id, first_name, last_name, phone, phone_norm, email, audience, consent_privacy, consent_marketing, is_demo, birth_date)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,true,$9) RETURNING *`,
      [t.id, fn, ln, `+39 333 000 ${String(1000 + i)}`, `+393330001${String(i).padStart(3, '0')}`, `${fn.toLowerCase()}.${ln.toLowerCase()}@esempio.it`, aud, i % 2 === 0,
        aud === 'bambino' ? '2017-05-12' : `19${70 + i}-${String((i % 12) + 1).padStart(2, '0')}-15`]));
  }
  let made = 0;
  const today = U.todayLocal();
  for (let d = -20; d <= 6; d++) {
    const date = U.addDays(today, d);
    const wd = U.weekdayOf(date);
    if (!(t.settings.hours[wd] || []).length) continue;
    for (const time of ['09:30', '11:00', '14:30', '16:00']) {
      const c = custs[(made * 7 + d + 50) % custs.length];
      const pool = byAud(c.audience || 'donna');
      const svc = pool[(made + d + 40) % pool.length];
      try {
        const a = await booking.createAppointment({ tenant: t, date, time, serviceIds: [svc.id], staffId: staff[made % staff.length].id, customerId: c.id, publicMode: false, ignoreAbsences: true });
        await db.query('UPDATE appointments SET is_demo=true WHERE id=$1', [a.id]);
        if (d < 0) {
          await db.query(`UPDATE appointments SET status=$2 WHERE id=$1`, [a.id, made % 11 === 0 ? 'assente' : 'completato']);
          if (made % 11 !== 0) {
            const sale = await db.one(`INSERT INTO sales(tenant_id, customer_id, appointment_id, status, subtotal_cents, total_cents, closed_at) VALUES ($1,$2,$3,'chiusa',$4,$4,$5) RETURNING id`,
              [t.id, c.id, a.id, svc.price_cents, a.ends_at]);
            await db.query(`INSERT INTO sale_items(tenant_id, sale_id, kind, ref_id, name, qty, unit_cents, total_cents, staff_id) VALUES ($1,$2,'servizio',$3,$4,1,$5,$5,$6)`,
              [t.id, sale.id, svc.id, svc.name, svc.price_cents, a.staff_id]);
            await db.query(`INSERT INTO payments(tenant_id, sale_id, method, amount_cents, created_at) VALUES ($1,$2,$3,$4,$5)`, [t.id, sale.id, made % 3 ? 'carta' : 'contanti', svc.price_cents, a.ends_at]);
            await db.query('UPDATE customers SET last_visit_at=GREATEST(COALESCE(last_visit_at,$2),$2) WHERE id=$1', [c.id, a.starts_at]);
          }
          await db.query('DELETE FROM busy_blocks WHERE appointment_id=$1 AND $2', [a.id, made % 11 === 0]);
        }
        made++;
      } catch (e) { if (e.status !== 409) throw e; }
    }
  }
  await db.query('UPDATE tenants SET is_demo=true WHERE id=$1', [t.id]);
  log.info(`Dati demo creati: ${custs.length} clienti, ${made} appuntamenti`);
}

if (require.main === module) run().then(() => db.pool.end()).catch(e => { log.error('Seed demo fallito', e); process.exit(1); });
module.exports = { run };
