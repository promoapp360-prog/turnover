'use strict';
const db = require('../lib/db');
const H = require('../lib/http');
const U = require('../lib/util');
const auth = require('../lib/auth');
const tenants = require('../lib/tenant');
const events = require('../lib/events');
const notifications = require('../lib/notifications');

// ---------------------------------------------------------------------------
// CRUD generico con whitelist di campi, validazione e isolamento per tenant
// Tipi: s=testo breve, t=testo lungo, i=intero, n=numero, c=importo € -> centesimi, b=booleano,
//       d=data, dt=data/ora locale, ia=lista interi, e=enum, color
// ---------------------------------------------------------------------------
const AUD = ['donna', 'uomo', 'bambino'];
const RES = {
  categories: { table: 'service_categories', perm: 'services.manage', read: 'agenda.view', order: 'audience, sort, id', search: ['name'],
    fields: { name: 's!', audience: ['e!', AUD], sort: 'i' } },
  services: { table: 'services', perm: 'services.manage', read: 'agenda.view', order: 'audience, sort, id', search: ['name', 'description'],
    fields: { category_id: 'i', audience: ['e!', AUD], name: 's!', description: 't', price_cents: 'c', price_from: 'b', duration_min: 'i!',
      processing_start_min: 'i', processing_min: 'i', buffer_min: 'i', online_bookable: 'b', active: 'b', sort: 'i' } },
  suppliers: { table: 'suppliers', perm: 'inventory.manage', read: 'inventory.view', order: 'name', search: ['name', 'email', 'phone'],
    fields: { name: 's!', phone: 's', email: 's', notes: 't' } },
  products: { table: 'products', perm: 'inventory.manage', read: 'inventory.view', order: 'name', search: ['name', 'sku', 'brand', 'category'],
    fields: { name: 's!', sku: 's', category: 's', brand: 's', supplier_id: 'i', cost_cents: 'c', price_cents: 'c', min_stock: 'n', unit: 's', retail: 'b', active: 'b' },
    createOnly: { stock: 'n' } },
  promotions: { table: 'promotions', perm: 'marketing.manage', read: 'cash.use', order: 'active DESC, id DESC', search: ['title', 'code'],
    fields: { title: 's!', description: 't', kind: ['e!', ['percent', 'fixed']], value: 'n!', service_ids: 'ia', code: 's', starts_on: 'd', ends_on: 'd',
      birthday: 'b', max_uses: 'i', public: 'b', active: 'b' } },
  packages: { table: 'packages', perm: 'marketing.manage', read: 'cash.use', order: 'active DESC, name', search: ['name'],
    fields: { name: 's!', description: 't', service_id: 'i', sessions: 'i!', price_cents: 'c!', validity_days: 'i', public: 'b', active: 'b' } },
  giftcards: { table: 'gift_cards', perm: 'marketing.manage', read: 'cash.use', order: 'id DESC', search: ['code', 'recipient_name'],
    fields: { recipient_name: 's', message: 't', expires_on: 'd', customer_id: 'i', status: ['e', ['attiva', 'esaurita', 'scaduta', 'annullata']] },
    createOnly: { initial_cents: 'c!' } },
  expenses: { table: 'expenses', perm: 'cash.reports', read: 'cash.reports', order: 'spent_on DESC, id DESC', search: ['description', 'category'],
    fields: { spent_on: 'd!', category: 's!', description: 's!', amount_cents: 'c!', method: 's', supplier_id: 'i' } },
  reviews: { table: 'reviews', perm: 'site.manage', read: 'site.manage', order: 'created_at DESC', search: ['author', 'body'],
    fields: { author: 's!', rating: 'i!', body: 't!', source: 's', approved: 'b' } },
  gallery: { table: 'gallery', perm: 'site.manage', read: 'site.manage', order: 'sort, id', search: ['caption'],
    fields: { url: 's!', caption: 's', audience: 's', sort: 'i', active: 'b' } },
  absences: { table: 'absences', perm: 'staff.manage', read: 'agenda.view', order: 'starts_at DESC', search: ['reason'],
    fields: { staff_id: 'i', kind: ['e!', ['ferie', 'malattia', 'permesso', 'ritardo', 'chiusura', 'altro']], starts_at: 'dt!', ends_at: 'dt!', reason: 's' } },
  locations: { table: 'locations', perm: 'settings.manage', read: 'agenda.view', order: 'is_main DESC, id', search: ['name'],
    fields: { name: 's!', address: 's', phone: 's', is_main: 'b' } },
};

function coerce(type, v, name) {
  const [t, list] = Array.isArray(type) ? type : [type];
  const req = t.endsWith('!');
  const base = t.replace('!', '');
  const label = name;
  if (v === undefined) return undefined;
  switch (base) {
    case 's': return U.str(v, { max: 300, required: req, name: label });
    case 't': return U.str(v, { max: 10000, required: req, name: label });
    case 'i': return U.int(v, { required: req, name: label });
    case 'n': return U.num(v, { required: req, name: label });
    case 'c': return U.cents(v, { required: req, name: label });
    case 'b': return U.bool(v);
    case 'd': return U.date(v || null, { required: req, name: label });
    case 'dt': {
      if (!v) { if (req) throw H.bad(`${label} obbligatorio`); return null; }
      const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(v));
      if (!m) throw H.bad(`${label} non valido`);
      return U.localToUtc(m[1], m[2]);
    }
    case 'ia': return (Array.isArray(v) ? v : String(v || '').split(',').filter(Boolean)).map(x => U.int(x, { min: 1, name: label }));
    case 'e': if (v === null || v === '') { if (req) throw H.bad(`${label} obbligatorio`); return null; } return U.oneOf(v, list, label);
    default: throw new Error('tipo sconosciuto ' + base);
  }
}

function pick(spec, body, { creating }) {
  const out = {};
  const all = { ...spec.fields, ...(creating ? spec.createOnly || {} : {}) };
  for (const [k, type] of Object.entries(all)) {
    if (creating || body[k] !== undefined) {
      const v = coerce(type, body[k], k);
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

async function fkCheck(tenantId, data) {
  const map = { category_id: 'service_categories', supplier_id: 'suppliers', service_id: 'services', staff_id: 'staff', customer_id: 'customers' };
  for (const [col, table] of Object.entries(map)) {
    if (data[col]) {
      const ok = await db.one(`SELECT 1 FROM ${table} WHERE tenant_id=$1 AND id=$2`, [tenantId, data[col]]);
      if (!ok) throw H.bad(`Riferimento non valido: ${col}`);
    }
  }
}

function dbError(e) {
  if (e.code === '23503') return H.conflict('Elemento collegato ad altri dati: disattivalo invece di eliminarlo.');
  if (e.code === '23505') return H.conflict('Valore già esistente (duplicato).');
  if (e.code === '23514') return H.bad('Valori non coerenti: verifica i dati inseriti.');
  return e;
}

async function audit(req, action, entity, id, data) {
  await db.query('INSERT INTO audit_log(tenant_id, user_id, action, entity, entity_id, data, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [req.tenant.id, req.user && req.user.id, action, entity, id ? String(id) : null, data || null, req.ip]);
}

function getRes(name) { const s = RES[name]; if (!s) throw H.notFound('Risorsa inesistente'); return s; }

module.exports = function (r) {
  r.get('/api/admin/r/:res', async req => {
    const s = getRes(req.params.res);
    auth.require(req.user, s.read, s.perm);
    const params = [req.tenant.id];
    let where = 'tenant_id=$1';
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      where += ` AND (${s.search.map(c => `${c}::text ILIKE $${params.length}`).join(' OR ')})`;
    }
    if (req.query.active === '1' && s.fields.active) where += ' AND active';
    if (req.params.res === 'absences' && req.query.future === '1') where += ' AND ends_at > now()';
    const limit = Math.min(U.int(req.query.limit || 500, { min: 1, max: 2000 }), 2000);
    return db.many(`SELECT * FROM ${s.table} WHERE ${where} ORDER BY ${s.order} LIMIT ${limit}`, params);
  });

  r.get('/api/admin/r/:res/:id', async req => {
    const s = getRes(req.params.res);
    auth.require(req.user, s.read, s.perm);
    const row = await db.one(`SELECT * FROM ${s.table} WHERE tenant_id=$1 AND id=$2`, [req.tenant.id, U.int(req.params.id)]);
    if (!row) throw H.notFound();
    return row;
  });

  r.post('/api/admin/r/:res', async req => {
    const s = getRes(req.params.res);
    auth.require(req.user, s.perm);
    const data = pick(s, await H.parseJson(req), { creating: true });
    await fkCheck(req.tenant.id, data);
    if (req.params.res === 'giftcards') { data.code = U.giftCode(); data.balance_cents = data.initial_cents; }
    if (req.params.res === 'absences' && data.ends_at <= data.starts_at) throw H.bad('La fine deve essere successiva all’inizio');
    if (req.params.res === 'promotions' && data.code) data.code = data.code.toUpperCase();
    const cols = Object.keys(data);
    try {
      const row = await db.tx(async c => {
        const row = await c.one(`INSERT INTO ${s.table}(tenant_id, ${cols.join(',')}) VALUES ($1, ${cols.map((_, i) => '$' + (i + 2)).join(',')}) RETURNING *`,
          [req.tenant.id, ...cols.map(k => data[k])]);
        if (req.params.res === 'products' && row.stock) {
          await c.query(`INSERT INTO stock_movements(tenant_id, product_id, qty, kind, note, user_id, unit_cost_cents) VALUES ($1,$2,$3,'carico','Giacenza iniziale',$4,$5)`,
            [req.tenant.id, row.id, row.stock, req.user.id, row.cost_cents]);
        }
        return row;
      });
      await audit(req, 'create', req.params.res, row.id);
      if (req.params.res === 'absences') events.publish(req.tenant.id, 'appointments', {});
      return row;
    } catch (e) { throw dbError(e); }
  });

  r.put('/api/admin/r/:res/:id', async req => {
    const s = getRes(req.params.res);
    auth.require(req.user, s.perm);
    const data = pick(s, await H.parseJson(req), { creating: false });
    await fkCheck(req.tenant.id, data);
    if (req.params.res === 'promotions' && data.code) data.code = data.code.toUpperCase();
    const cols = Object.keys(data);
    if (!cols.length) throw H.bad('Nessun dato da aggiornare');
    try {
      const row = await db.one(`UPDATE ${s.table} SET ${cols.map((k, i) => `${k}=$${i + 3}`).join(',')} WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [req.tenant.id, U.int(req.params.id), ...cols.map(k => data[k])]);
      if (!row) throw H.notFound();
      if (req.params.res === 'absences' && row.ends_at <= row.starts_at) throw H.bad('La fine deve essere successiva all’inizio');
      await audit(req, 'update', req.params.res, row.id);
      if (req.params.res === 'absences') events.publish(req.tenant.id, 'appointments', {});
      return row;
    } catch (e) { throw dbError(e); }
  });

  r.delete('/api/admin/r/:res/:id', async req => {
    const s = getRes(req.params.res);
    auth.require(req.user, s.perm);
    try {
      const row = await db.one(`DELETE FROM ${s.table} WHERE tenant_id=$1 AND id=$2 RETURNING id`, [req.tenant.id, U.int(req.params.id)]);
      if (!row) throw H.notFound();
      await audit(req, 'delete', req.params.res, row.id);
      if (req.params.res === 'absences') events.publish(req.tenant.id, 'appointments', {});
      return { ok: true };
    } catch (e) { throw dbError(e); }
  });

  // ---------------- Staff (con servizi abilitati e turni) ----------------
  r.get('/api/admin/staff', async req => {
    auth.require(req.user, 'agenda.view');
    return db.many(`SELECT s.*, COALESCE(array_agg(ss.service_id) FILTER (WHERE ss.service_id IS NOT NULL), '{}') AS service_ids
                      FROM staff s LEFT JOIN staff_services ss ON ss.staff_id=s.id WHERE s.tenant_id=$1 GROUP BY s.id ORDER BY s.sort, s.id`, [req.tenant.id]);
  });
  async function saveStaff(req, id) {
    auth.require(req.user, 'staff.manage');
    const b = await H.parseJson(req);
    const schedule = {};
    if (b.schedule && typeof b.schedule === 'object') {
      for (const [d, list] of Object.entries(b.schedule)) {
        if (!/^[0-6]$/.test(d)) continue;
        if (list === null) continue; // segue l'orario del salone
        if (!Array.isArray(list)) throw H.bad('Turni non validi');
        schedule[d] = list.map(([a, z]) => {
          if (!U.TIME_RE.test(a) || !U.TIME_RE.test(z) || U.toMin(z) <= U.toMin(a)) throw H.bad('Orario turno non valido');
          return [a, z];
        });
      }
    }
    const f = {
      name: U.str(b.name, { required: true, max: 80, name: 'Nome' }), role_title: U.str(b.role_title, { max: 80 }), bio: U.str(b.bio, { max: 2000 }),
      specialties: U.str(b.specialties, { max: 300 }), photo_url: U.str(b.photo_url, { max: 500 }), phone: U.str(b.phone, { max: 30 }),
      email: U.email(b.email), color: /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '#b08968',
      commission_pct: U.num(b.commission_pct || 0, { min: 0, max: 100 }), online_bookable: U.bool(b.online_bookable), show_on_site: U.bool(b.show_on_site),
      active: b.active === undefined ? true : U.bool(b.active), sort: U.int(b.sort || 0),
    };
    const serviceIds = (b.service_ids || []).map(x => U.int(x, { min: 1 }));
    return db.tx(async c => {
      let row;
      const vals = [f.name, f.role_title, f.bio, f.specialties, f.photo_url, f.phone, f.email, f.color, schedule, f.commission_pct, f.online_bookable, f.show_on_site, f.active, f.sort];
      if (id) {
        row = await c.one(`UPDATE staff SET name=$3, role_title=$4, bio=$5, specialties=$6, photo_url=$7, phone=$8, email=$9, color=$10, schedule=$11,
                             commission_pct=$12, online_bookable=$13, show_on_site=$14, active=$15, sort=$16 WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.tenant.id, id, ...vals]);
        if (!row) throw H.notFound();
      } else {
        row = await c.one(`INSERT INTO staff(tenant_id, name, role_title, bio, specialties, photo_url, phone, email, color, schedule, commission_pct, online_bookable, show_on_site, active, sort)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [req.tenant.id, ...vals]);
      }
      await c.query('DELETE FROM staff_services WHERE staff_id=$1', [row.id]);
      if (serviceIds.length) {
        const valid = await c.many('SELECT id FROM services WHERE tenant_id=$1 AND id = ANY($2::int[])', [req.tenant.id, serviceIds]);
        for (const s of valid) await c.query('INSERT INTO staff_services(staff_id, service_id) VALUES ($1,$2)', [row.id, s.id]);
      }
      events.publish(req.tenant.id, 'appointments', {});
      return row;
    });
  }
  r.post('/api/admin/staff', req => saveStaff(req, null));
  r.put('/api/admin/staff/:id', req => saveStaff(req, U.int(req.params.id, { min: 1 })));
  r.delete('/api/admin/staff/:id', async req => {
    auth.require(req.user, 'staff.manage');
    try {
      const row = await db.one('DELETE FROM staff WHERE tenant_id=$1 AND id=$2 RETURNING id', [req.tenant.id, U.int(req.params.id)]);
      if (!row) throw H.notFound();
      return { ok: true };
    } catch (e) { throw dbError(e); }
  });

  // ---------------- Utenti e ruoli ----------------
  r.get('/api/admin/users', async req => {
    auth.require(req.user, 'users.manage');
    return db.many('SELECT id, username, email, display_name, role, staff_id, active, last_login_at, created_at FROM users WHERE tenant_id=$1 ORDER BY id', [req.tenant.id]);
  });
  async function saveUser(req, id) {
    auth.require(req.user, 'users.manage');
    const b = await H.parseJson(req);
    const f = {
      username: U.str(b.username, { required: true, max: 60, min: 3, name: 'Utente' }), email: U.email(b.email),
      display_name: U.str(b.display_name, { max: 80 }), role: U.oneOf(b.role, Object.keys(auth.PERMS), 'Ruolo'),
      staff_id: b.staff_id ? U.int(b.staff_id, { min: 1 }) : null, active: b.active === undefined ? true : U.bool(b.active),
    };
    if (f.staff_id) await fkCheck(req.tenant.id, { staff_id: f.staff_id });
    const pw = b.password ? U.str(b.password, { min: 5, max: 200, name: 'Password' }) : null;
    try {
      return await db.tx(async c => {
        let row;
        if (id) {
          row = await c.one(`UPDATE users SET username=$3, email=$4, display_name=$5, role=$6, staff_id=$7, active=$8 WHERE tenant_id=$1 AND id=$2 RETURNING id`,
            [req.tenant.id, id, f.username, f.email, f.display_name, f.role, f.staff_id, f.active]);
          if (!row) throw H.notFound();
          if (pw) { await c.query('UPDATE users SET password_hash=$2 WHERE id=$1', [id, auth.hashPassword(pw)]); await c.query('DELETE FROM sessions WHERE user_id=$1 AND user_id<>$2', [id, req.user.id]); }
          if (!f.active) await c.query('DELETE FROM sessions WHERE user_id=$1', [id]);
        } else {
          if (!pw) throw H.bad('Password obbligatoria per il nuovo utente');
          row = await c.one(`INSERT INTO users(tenant_id, username, email, display_name, role, staff_id, active, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [req.tenant.id, f.username, f.email, f.display_name, f.role, f.staff_id, f.active, auth.hashPassword(pw)]);
        }
        const admins = await c.one(`SELECT count(*)::int n FROM users WHERE tenant_id=$1 AND role='admin' AND active`, [req.tenant.id]);
        if (!admins.n) throw H.bad('Deve rimanere almeno un amministratore attivo');
        await c.query('INSERT INTO audit_log(tenant_id, user_id, action, entity, entity_id, ip) VALUES ($1,$2,$3,$4,$5,$6)', [req.tenant.id, req.user.id, id ? 'update' : 'create', 'user', String(row.id), req.ip]);
        return { ok: true, id: row.id };
      });
    } catch (e) { throw dbError(e); }
  }
  r.post('/api/admin/users', req => saveUser(req, null));
  r.put('/api/admin/users/:id', req => saveUser(req, U.int(req.params.id, { min: 1 })));
  r.delete('/api/admin/users/:id', async req => {
    auth.require(req.user, 'users.manage');
    const id = U.int(req.params.id, { min: 1 });
    if (id === req.user.id) throw H.bad('Non puoi eliminare il tuo utente');
    await db.tx(async c => {
      await c.query('DELETE FROM users WHERE tenant_id=$1 AND id=$2', [req.tenant.id, id]);
      const admins = await c.one(`SELECT count(*)::int n FROM users WHERE tenant_id=$1 AND role='admin' AND active`, [req.tenant.id]);
      if (!admins.n) throw H.bad('Deve rimanere almeno un amministratore attivo');
    });
    return { ok: true };
  });

  // ---------------- Impostazioni ----------------
  r.get('/api/admin/settings', async req => {
    auth.require(req.user, 'dashboard.view');
    const t = await tenants.byId(req.tenant.id);
    return { name: t.name, settings: t.settings, modules: t.modules, is_demo: t.is_demo, providers: notifications.providers(),
      domains: auth.can(req.user, 'settings.manage') ? await db.many('SELECT host FROM domains WHERE tenant_id=$1', [t.id]) : [] };
  });
  const SETTINGS_PERM = { brand: 'settings.manage', contact: 'settings.manage', hours: 'settings.hours', booking: 'settings.hours', site: 'site.manage',
    notifications: 'notifications.manage', loyalty: 'marketing.manage', payments: 'settings.manage', crm: 'settings.manage' };
  r.put('/api/admin/settings', async req => {
    const b = await H.parseJson(req, 200000);
    const t = await tenants.byId(req.tenant.id);
    const next = { ...(await db.one('SELECT settings FROM tenants WHERE id=$1', [t.id])).settings };
    for (const [section, val] of Object.entries(b.settings || {})) {
      if (!SETTINGS_PERM[section]) throw H.bad(`Sezione sconosciuta: ${section}`);
      auth.require(req.user, SETTINGS_PERM[section]);
      if (typeof val !== 'object' || val === null) throw H.bad('Formato impostazioni non valido');
      if (section === 'hours') {
        for (const [d, list] of Object.entries(val)) {
          if (!/^[0-6]$/.test(d) || !Array.isArray(list)) throw H.bad('Orari non validi');
          for (const [a, z] of list) if (!U.TIME_RE.test(a) || !U.TIME_RE.test(z) || U.toMin(z) <= U.toMin(a)) throw H.bad('Fascia oraria non valida');
        }
        next.hours = val;
      } else {
        const def = tenants.DEFAULT_SETTINGS[section];
        const clean = {};
        for (const [k, v] of Object.entries(val)) {
          if (!(k in def)) continue;
          const dv = def[k];
          if (typeof dv === 'boolean') clean[k] = U.bool(v);
          else if (typeof dv === 'number' || (dv === null && typeof v === 'number')) clean[k] = v === '' || v === null ? null : U.num(v, { name: k });
          else if (Array.isArray(dv)) clean[k] = Array.isArray(v) ? v.map(x => String(x).slice(0, 50)) : dv;
          else clean[k] = v === null ? '' : String(v).slice(0, 20000);
        }
        if (section === 'brand') for (const k of ['primary', 'accent', 'background']) if (clean[k] && !/^#[0-9a-fA-F]{6}$/.test(clean[k])) throw H.bad('Colore non valido');
        next[section] = { ...(next[section] || {}), ...clean };
      }
    }
    let name = t.name;
    if (b.name !== undefined) { auth.require(req.user, 'settings.manage'); name = U.str(b.name, { required: true, max: 120, name: 'Nome salone' }); }
    let modules = t.modules;
    if (b.modules) {
      auth.require(req.user, 'settings.manage');
      modules = { ...t.modules };
      for (const k of Object.keys(tenants.DEFAULT_MODULES)) if (k in b.modules) modules[k] = U.bool(b.modules[k]);
    }
    await db.query('UPDATE tenants SET settings=$2, modules=$3, name=$4 WHERE id=$1', [t.id, next, modules, name]);
    if (b.domains && auth.can(req.user, 'settings.manage')) {
      await db.tx(async c => {
        await c.query('DELETE FROM domains WHERE tenant_id=$1', [t.id]);
        for (const h of b.domains.map(x => String(x).trim().toLowerCase()).filter(x => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x))) {
          await c.query('INSERT INTO domains(host, tenant_id) VALUES ($1,$2) ON CONFLICT (host) DO NOTHING', [h, t.id]);
        }
      });
    }
    tenants.invalidate();
    await audit(req, 'settings', 'tenant', t.id, { sections: Object.keys(b.settings || {}) });
    return { ok: true };
  });

  // ---------------- Upload immagini ----------------
  r.post('/api/admin/media', async req => {
    auth.require(req.user, 'site.manage', 'staff.manage', 'clients.edit', 'settings.manage');
    const mime = String(req.headers['content-type'] || '').split(';')[0];
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'].includes(mime)) throw H.bad('Formato immagine non supportato (JPG, PNG, WEBP)');
    const buf = await H.readBody(req, 5 * 1024 * 1024);
    if (!buf.length) throw H.bad('File vuoto');
    // verifica firma del file (non solo il content-type dichiarato)
    const sig = buf.subarray(0, 12).toString('hex');
    const okSig = (mime === 'image/jpeg' && sig.startsWith('ffd8')) || (mime === 'image/png' && sig.startsWith('89504e47')) ||
      (mime === 'image/webp' && buf.subarray(8, 12).toString() === 'WEBP') || (mime === 'image/gif' && sig.startsWith('474946')) ||
      (mime === 'image/svg+xml' && /<svg[\s>]/i.test(buf.toString('utf8', 0, 2000)) && !/<script|on\w+=/i.test(buf.toString('utf8')));
    if (!okSig) throw H.bad('Il file non sembra un’immagine valida');
    const isPrivate = req.query.private === '1';
    const row = await db.one('INSERT INTO media(tenant_id, mime, size, data, is_private) VALUES ($1,$2,$3,$4,$5) RETURNING id', [req.tenant.id, mime, buf.length, buf, isPrivate]);
    return { id: row.id, url: `/api/media/${row.id}` };
  });

  // ---------------- Notifiche ----------------
  r.get('/api/admin/notifications/templates', async req => {
    auth.require(req.user, 'notifications.manage');
    await notifications.ensureTemplates(req.tenant.id);
    const rows = await db.many('SELECT * FROM notification_templates WHERE tenant_id=$1 ORDER BY key, channel', [req.tenant.id]);
    return rows.map(r => ({ ...r, label: (notifications.TEMPLATE_META[r.key] || {}).label || r.key, marketing: !!(notifications.TEMPLATE_META[r.key] || {}).marketing }));
  });
  r.put('/api/admin/notifications/templates/:id', async req => {
    auth.require(req.user, 'notifications.manage');
    const b = await H.parseJson(req);
    const row = await db.one(`UPDATE notification_templates SET subject=$3, body=$4, active=$5, wa_template=$6 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [req.tenant.id, U.int(req.params.id), U.str(b.subject, { max: 200 }), U.str(b.body, { required: true, max: 2000, name: 'Testo' }), U.bool(b.active), U.str(b.wa_template, { max: 100 })]);
    if (!row) throw H.notFound();
    return row;
  });
  r.get('/api/admin/notifications/log', async req => {
    auth.require(req.user, 'notifications.manage');
    return db.many(`SELECT l.*, c.first_name, c.last_name FROM notification_log l LEFT JOIN customers c ON c.id=l.customer_id
                     WHERE l.tenant_id=$1 ORDER BY l.created_at DESC LIMIT 300`, [req.tenant.id]);
  });
  r.post('/api/admin/notifications/test', async req => {
    auth.require(req.user, 'notifications.manage');
    const b = await H.parseJson(req);
    const fake = { id: null, first_name: 'Test', last_name: '', email: U.email(b.email), phone: U.str(b.phone, { max: 30 }), consent_marketing: true };
    const t = await tenants.byId(req.tenant.id);
    const forced = { ...t, settings: { ...t.settings, notifications: { ...t.settings.notifications, email_enabled: !!fake.email, whatsapp_enabled: !!fake.phone } } };
    return notifications.notify(forced, 'promo', { customer: fake, vars: { titolo: 'Messaggio di prova', messaggio: 'questo è un messaggio di prova del gestionale.' } });
  });
  // Campagna promozionale ai clienti con consenso marketing
  r.post('/api/admin/notifications/campaign', async req => {
    auth.require(req.user, 'marketing.manage');
    const b = await H.parseJson(req);
    const titolo = U.str(b.title, { required: true, max: 120, name: 'Titolo' });
    const messaggio = U.str(b.message, { required: true, max: 800, name: 'Messaggio' });
    const segment = b.segment || 'tutti';
    const t = await tenants.byId(req.tenant.id);
    const inactive = t.settings.crm.inactive_days || 60;
    let where = 'tenant_id=$1 AND consent_marketing AND NOT anonymized';
    if (segment === 'inattivi') where += ` AND (last_visit_at IS NULL OR last_visit_at < now() - interval '${parseInt(inactive, 10)} days')`;
    if (AUD.includes(segment)) where += ` AND audience='${segment}'`;
    const list = await db.many(`SELECT * FROM customers WHERE ${where} LIMIT 2000`, [t.id]);
    let count = 0;
    for (const c of list) { await notifications.notify(t, 'promo', { customer: c, vars: { titolo, messaggio } }); count++; }
    await audit(req, 'campaign', 'notifications', null, { segment, count });
    return { ok: true, recipients: count };
  });

  // ---------------- Lista d'attesa ----------------
  r.get('/api/admin/waitlist', async req => {
    auth.require(req.user, 'waitlist.manage', 'agenda.view');
    return db.many(`SELECT w.*, c.first_name, c.last_name, c.phone, c.email FROM waitlist w JOIN customers c ON c.id=w.customer_id
                     WHERE w.tenant_id=$1 AND ($2::text IS NULL OR w.status=$2) ORDER BY w.status, w.created_at`, [req.tenant.id, req.query.status || null]);
  });
  r.post('/api/admin/waitlist', async req => {
    auth.require(req.user, 'waitlist.manage');
    const b = await H.parseJson(req);
    const cid = U.int(b.customer_id, { required: true, min: 1, name: 'Cliente' });
    await fkCheck(req.tenant.id, { customer_id: cid, staff_id: b.staff_id || null });
    const from = U.date(b.date_from, { required: true }); const to = U.date(b.date_to || b.date_from, { required: true });
    return db.one(`INSERT INTO waitlist(tenant_id, customer_id, service_ids, staff_id, date_from, date_to, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.tenant.id, cid, (b.service_ids || []).map(x => U.int(x, { min: 1 })), b.staff_id ? U.int(b.staff_id) : null, from, to, U.str(b.notes, { max: 500 })]);
  });
  r.put('/api/admin/waitlist/:id', async req => {
    auth.require(req.user, 'waitlist.manage');
    const b = await H.parseJson(req);
    const row = await db.one('UPDATE waitlist SET status=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.tenant.id, U.int(req.params.id), U.oneOf(b.status, ['attesa', 'avvisato', 'prenotato', 'chiuso'], 'Stato')]);
    if (!row) throw H.notFound();
    return row;
  });

  // ---------------- Eventi in tempo reale ----------------
  r.get('/api/admin/stream', async (req, res) => {
    auth.require(req.user, 'agenda.view');
    events.subscribe(req.tenant.id, req, res);
  });

  // ---------------- Dati dimostrativi ----------------
  r.post('/api/admin/demo/clear', async req => {
    auth.require(req.user, 'settings.manage');
    await db.tx(async c => {
      await c.query('DELETE FROM sales WHERE tenant_id=$1 AND (appointment_id IN (SELECT id FROM appointments WHERE tenant_id=$1 AND is_demo) OR customer_id IN (SELECT id FROM customers WHERE tenant_id=$1 AND is_demo))', [req.tenant.id]);
      await c.query('DELETE FROM appointments WHERE tenant_id=$1 AND is_demo', [req.tenant.id]);
      await c.query('DELETE FROM customers WHERE tenant_id=$1 AND is_demo', [req.tenant.id]);
      await c.query('UPDATE tenants SET is_demo=false WHERE id=$1', [req.tenant.id]);
    });
    tenants.invalidate();
    await audit(req, 'demo_clear', 'tenant', req.tenant.id);
    return { ok: true };
  });

  r.get('/api/admin/audit', async req => {
    auth.require(req.user, 'users.manage');
    return db.many(`SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT 300`, [req.tenant.id]);
  });
};
module.exports.RES = RES;
module.exports.audit = audit;
module.exports.dbError = dbError;
