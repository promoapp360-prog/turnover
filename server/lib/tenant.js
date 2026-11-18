'use strict';
const db = require('./db');
const { deepMerge } = require('./util');

// Impostazioni predefinite: ogni tenant le sovrascrive dal pannello Impostazioni
const DEFAULT_SETTINGS = {
  brand: {
    name: 'Il tuo salone', tagline: 'Hair & Beauty', logo_url: '', favicon_url: '',
    primary: '#2f2a26', accent: '#b08968', background: '#faf7f2', font_heading: 'Playfair Display', font_body: 'Inter',
  },
  contact: {
    address: '', city: '', zip: '', province: '', phone: '', whatsapp: '', email: '',
    maps_url: '', lat: null, lng: null, instagram: '', facebook: '', tiktok: '',
    legal_name: '', vat: '',
  },
  // 0=domenica ... 6=sabato
  hours: { 0: [], 1: [], 2: [['09:00', '18:00']], 3: [['09:00', '18:00']], 4: [['09:00', '18:00']], 5: [['09:00', '18:00']], 6: [['09:00', '17:00']] },
  booking: {
    enabled: true, slot_step_min: 15, min_notice_min: 120, max_advance_days: 60,
    cancel_min_hours: 24, require_approval: false, allow_staff_choice: true,
    deposit_enabled: false, deposit_percent: 0, no_show_policy: '',
    terms: 'Puoi annullare o spostare la prenotazione fino a 24 ore prima dell’appuntamento.',
  },
  site: {
    hero_title: '', hero_subtitle: '', hero_image: '', about_title: 'Chi siamo', about_text: '', about_image: '',
    show_reviews: true, show_gallery: true, show_staff: true, show_promotions: true, show_giftcards: true,
    giftcard_text: 'Regala un momento di bellezza: chiedi in salone la gift card del valore che preferisci.',
    seo_description: '', privacy_html: '', cookie_html: '', terms_html: '',
  },
  notifications: {
    email_enabled: false, whatsapp_enabled: false, reminder_hours: 24,
    review_request: false, review_delay_hours: 3, review_url: '', birthday: false, birthday_hour: 9,
    owner_email: '', notify_owner_new_booking: true,
  },
  loyalty: { enabled: true, points_per_euro: 1, euro_per_point_cents: 5, min_redeem_points: 100, birthday_points: 0 },
  payments: { methods: ['contanti', 'carta', 'bancomat', 'satispay'] },
  crm: { inactive_days: 60 },
};
const DEFAULT_MODULES = {
  booking: true, cash: true, inventory: true, marketing: true, loyalty: true, giftcards: true, packages: true,
  waitlist: true, notifications: true, gallery: true, reviews: true, multi_location: false,
};

const cache = new Map(); // host -> {tenant, exp}
function invalidate() { cache.clear(); }

function hydrate(t) {
  if (!t) return null;
  return { ...t, settings: deepMerge(DEFAULT_SETTINGS, t.settings || {}), modules: { ...DEFAULT_MODULES, ...(t.modules || {}) } };
}

async function resolve(host) {
  host = (host || '').toLowerCase().split(':')[0];
  const c = cache.get(host);
  if (c && c.exp > Date.now()) return c.tenant;
  let t = await db.one('SELECT t.* FROM domains d JOIN tenants t ON t.id=d.tenant_id WHERE d.host=$1', [host]);
  if (!t && process.env.DEFAULT_TENANT) t = await db.one('SELECT * FROM tenants WHERE slug=$1', [process.env.DEFAULT_TENANT]);
  if (!t) t = await db.one('SELECT * FROM tenants ORDER BY id LIMIT 1');
  const tenant = hydrate(t);
  cache.set(host, { tenant, exp: Date.now() + 30000 });
  return tenant;
}
async function byId(id) { return hydrate(await db.one('SELECT * FROM tenants WHERE id=$1', [id])); }

module.exports = { DEFAULT_SETTINGS, DEFAULT_MODULES, resolve, byId, invalidate, hydrate };
