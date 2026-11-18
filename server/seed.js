'use strict';
/*
 * Seed iniziale del tenant "Turn Over by Zaira".
 * Contiene SOLO dati reali o di configurazione (anagrafica salone, orari, listino da verificare, utente titolare).
 * I dati dimostrativi (clienti/appuntamenti finti) si caricano a parte con `npm run seed:demo` e sono marcati is_demo.
 */
const db = require('./lib/db');
const log = require('./lib/log');
const auth = require('./lib/auth');
const notifications = require('./lib/notifications');

const IMG = id => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1400`;

const SETTINGS = {
  brand: { name: 'Turn Over by Zaira', tagline: 'Parrucchiere uomo · donna · bambino', primary: '#2b2523', accent: '#b0835a', background: '#f8f4ef',
    font_heading: 'Playfair Display', font_body: 'Inter', logo_url: '' },
  contact: {
    address: 'Via Antonio Vivaldi, 18', city: 'Paderno Dugnano', zip: '20037', province: 'MI', phone: '+39 327 182 0186', whatsapp: '+39 327 182 0186', email: '',
    maps_url: 'https://www.google.com/maps/search/?api=1&query=Turn+Over+by+Zaira+Via+Antonio+Vivaldi+18+Paderno+Dugnano', lat: 45.5708717, lng: 9.1882733,
    instagram: '', facebook: '', tiktok: '', legal_name: 'Turn Over S.a.s.', vat: '',
  },
  hours: { 0: [], 1: [], 2: [['09:00', '18:00']], 3: [['09:00', '18:00']], 4: [['09:00', '18:00']], 5: [['09:00', '18:00']], 6: [['09:00', '17:00']] },
  booking: { enabled: true, slot_step_min: 15, min_notice_min: 120, max_advance_days: 60, cancel_min_hours: 24, require_approval: false, allow_staff_choice: true,
    terms: 'Puoi annullare o spostare la prenotazione online fino a 24 ore prima. Per disdette all’ultimo momento ti chiediamo di chiamarci o scriverci su WhatsApp.' },
  site: {
    hero_title: 'Il tuo stile, con la cura di casa.',
    hero_subtitle: 'Taglio, colore e trattamenti per donna, uomo e bambino a Paderno Dugnano. Un ambiente accogliente e familiare, dove ti senti a tuo agio dal primo momento.',
    hero_image: IMG(3993449),
    about_title: 'Benvenuti da Turn Over',
    about_text: 'Turn Over è il salone di Zaira in Via Vivaldi a Paderno Dugnano: un piccolo team che lavora con passione e professionalità, puntualità e attenzione ai dettagli.\n\nLe nostre specialità sono il colore e la cura del capello, insieme a tagli moda pensati sul tuo viso e sul tuo stile. Che tu voglia una piega perfetta, un colore che duri o un cambio di look deciso, qui trovi consigli sinceri e un’atmosfera di famiglia.',
    about_image: IMG(3992874),
    show_reviews: true, show_gallery: true, show_staff: true, show_promotions: true, show_giftcards: true,
    giftcard_text: 'Regala un momento di bellezza a chi vuoi bene: chiedi in salone la gift card Turn Over del valore che preferisci.',
    seo_description: 'Turn Over by Zaira, parrucchiere unisex a Paderno Dugnano (MI), Via Antonio Vivaldi 18. Colore, tagli moda, pieghe, trattamenti e barba. Prenota online.',
  },
  notifications: { email_enabled: false, whatsapp_enabled: false, reminder_hours: 24, review_request: false, birthday: false },
};

const CATEGORIES = [
  ['donna', 'Taglio e piega'], ['donna', 'Colore'], ['donna', 'Trattamenti'], ['donna', 'Beauty e cerimonia'],
  ['uomo', 'Uomo'], ['bambino', 'Bambini'],
];
// [categoria, nome, descrizione, prezzo €, da, durata, inizio posa, posa, pausa]
// NB: i prezzi contrassegnati con * sono indicativi e vanno confermati dalla titolare (vedi README)
const SERVICES = [
  ['Taglio e piega', 'Taglio donna', 'Taglio personalizzato con consulenza sullo stile e sulla forma del viso.', 25, false, 45, 0, 0, 0],
  ['Taglio e piega', 'Piega capelli corti', 'Shampoo e piega per capelli corti o medi.', 15, false, 30, 0, 0, 0],
  ['Taglio e piega', 'Piega capelli lunghi', 'Shampoo e piega per capelli lunghi, liscia o mossa.', 18, false, 45, 0, 0, 0],
  ['Taglio e piega', 'Taglio e piega', 'Taglio moda e piega finale.', 35, false, 60, 0, 0, 0],
  ['Colore', 'Colore completo', 'Colorazione completa con prodotti professionali. Durante la posa ci prendiamo cura di te.', 40, false, 90, 15, 40, 5],
  ['Colore', 'Ritocco radice', 'Ritocco del colore sulla ricrescita.', 30, false, 75, 15, 30, 5],
  ['Colore', 'Colpi di sole / meches', 'Schiariture con tecnica a cartine o a mano libera.', 55, true, 120, 40, 40, 5],
  ['Colore', 'Balayage', 'Schiariture sfumate dall’effetto naturale, studiate sul tuo colore di base.', 70, true, 150, 50, 45, 5],
  ['Trattamenti', 'Trattamento curativo', 'Trattamento ristrutturante per capelli sfibrati o sensibilizzati.', 10, false, 75, 10, 45, 0],
  ['Trattamenti', 'Fiala curativa', 'Fiala specifica (anticaduta, ristrutturante o lucidante) applicata in salone.', 5, false, 25, 0, 0, 0],
  ['Beauty e cerimonia', 'Laminazione sopracciglia', 'Sopracciglia ordinate e definite più a lungo.', 30, false, 45, 10, 20, 0],
  ['Beauty e cerimonia', 'Acconciatura cerimonia', 'Raccolti e acconciature per eventi, matrimoni e cerimonie.', 40, true, 60, 0, 0, 0],
  ['Uomo', 'Taglio uomo', 'Taglio classico o moda, con rifinitura.', 15, false, 30, 0, 0, 0],
  ['Uomo', 'Barba', 'Regolazione e rifinitura della barba.', 5, false, 20, 0, 0, 0],
  ['Uomo', 'Taglio e barba', 'Taglio uomo con regolazione barba.', 20, false, 45, 0, 0, 0],
  ['Uomo', 'Colore uomo', 'Colore o tonalizzante per coprire i capelli bianchi in modo naturale.', 20, false, 45, 10, 20, 0],
  ['Bambini', 'Taglio bambino', 'Taglio per bambini fino a 10 anni.', 12, false, 25, 0, 0, 0],
  ['Bambini', 'Taglio bambina', 'Taglio per bambine fino a 10 anni.', 15, false, 30, 0, 0, 0],
  ['Bambini', 'Piega bambina', 'Piega o acconciatura semplice per bambine.', 10, false, 20, 0, 0, 0],
];

const GALLERY = [
  [3065209, 'Il salone'], [3993449, 'Colore e piega'], [3992874, 'Consulenza'], [3993398, 'Cura del capello'],
  [1813272, 'Taglio uomo'], [3998429, 'Styling'],
];

async function run() {
  const exists = await db.one(`SELECT id FROM tenants WHERE slug='turnover'`);
  if (exists) { log.info('Tenant turnover già presente: seed saltato'); return exists.id; }
  return db.tx(async c => {
    const t = await c.one(`INSERT INTO tenants(slug, name, settings) VALUES ('turnover', 'Turn Over by Zaira', $1) RETURNING id`, [SETTINGS]);
    await c.query(`INSERT INTO locations(tenant_id, name, address, phone, is_main) VALUES ($1, 'Turn Over – Paderno Dugnano', 'Via Antonio Vivaldi 18, 20037 Paderno Dugnano (MI)', '+39 327 182 0186', true)`, [t.id]);
    const catIds = {};
    let i = 0;
    for (const [aud, name] of CATEGORIES) catIds[name] = (await c.one('INSERT INTO service_categories(tenant_id, name, audience, sort) VALUES ($1,$2,$3,$4) RETURNING id', [t.id, name, aud, i++])).id;
    i = 0;
    for (const [cat, name, desc, price, from, dur, ps, pm, buf] of SERVICES) {
      const aud = CATEGORIES.find(x => x[1] === cat)[0];
      await c.query(`INSERT INTO services(tenant_id, category_id, audience, name, description, price_cents, price_from, duration_min, processing_start_min, processing_min, buffer_min, sort)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [t.id, catIds[cat], aud, name, desc, price * 100, from, dur, ps, pm, buf, i++]);
    }
    const staff = await c.one(`INSERT INTO staff(tenant_id, name, role_title, bio, specialties, color, schedule, sort)
                               VALUES ($1, 'Zaira', 'Titolare · Hair stylist', 'Fondatrice di Turn Over: accoglienza, ascolto e tanta passione per il colore.', 'Colore, cura del capello, tagli moda', '#b0835a', '{}'::jsonb, 0) RETURNING id`, [t.id]);
    const pw = process.env.ADMIN_PASSWORD || 'Zaira';
    await c.query(`INSERT INTO users(tenant_id, username, display_name, role, staff_id, password_hash) VALUES ($1, 'zaira', 'Zaira', 'admin', $2, $3)`, [t.id, staff.id, auth.hashPassword(pw)]);
    i = 0;
    for (const [id, cap] of GALLERY) await c.query('INSERT INTO gallery(tenant_id, url, caption, sort) VALUES ($1,$2,$3,$4)', [t.id, IMG(id), cap, i++]);
    await notifications.ensureTemplates(t.id, c);
    log.info(`Seed completato: tenant Turn Over by Zaira (id ${t.id}). Accesso: utente "zaira".`);
    return t.id;
  });
}

module.exports = { run };

if (require.main === module) {
  db.migrate().then(run).then(() => db.pool.end()).catch(e => { log.error('Seed fallito', e); process.exit(1); });
}
