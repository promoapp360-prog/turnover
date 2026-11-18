'use strict';
// Sito pubblico del salone: pagine generate lato server (SEO) con i dati del gestionale
const db = require('../lib/db');
const H = require('../lib/http');
const U = require('../lib/util');
const { publicCatalog } = require('./public-api');

const e = U.escapeHtml;
const DAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const AUD_LABEL = { donna: 'Donna', uomo: 'Uomo', bambino: 'Bambini' };

function fontsLink(b) {
  const fam = [...new Set([b.font_heading, b.font_body])].filter(Boolean).map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&');
  return fam ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fam}&display=swap">` : '';
}

function paragraphs(text) {
  return String(text || '').split(/\n{2,}/).map(p => {
    const t = p.trim();
    if (!t) return '';
    if (t.startsWith('## ')) return `<h2>${e(t.slice(3))}</h2>`;
    if (t.startsWith('### ')) return `<h3>${e(t.slice(4))}</h3>`;
    if (/^- /m.test(t)) return `<ul>${t.split('\n').map(l => `<li>${e(l.replace(/^- /, ''))}</li>`).join('')}</ul>`;
    return `<p>${e(t).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

function money(c, from) { return (from ? 'da ' : '') + U.euro(c); }
function dur(m) { return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`; }
function hoursRows(hours) {
  return [1, 2, 3, 4, 5, 6, 0].map(d => {
    const l = hours[d] || hours[String(d)] || [];
    return `<tr><th>${DAYS[d]}</th><td>${l.length ? l.map(([a, b]) => `${a} – ${b}`).join(' · ') : '<span class="muted">Chiuso</span>'}</td></tr>`;
  }).join('');
}
function waUrl(n, text) { const p = U.normPhone(n); return p ? `https://wa.me/${p.replace('+', '')}${text ? '?text=' + encodeURIComponent(text) : ''}` : null; }

function layout(t, { title, description, body, path = '/', bodyClass = '', scripts = [] }) {
  const s = t.settings; const b = s.brand; const c = s.contact;
  const fullTitle = title ? `${title} · ${b.name}` : `${b.name} – ${b.tagline}`;
  const phoneHref = c.phone ? `tel:${U.normPhone(c.phone)}` : null;
  const wa = waUrl(c.whatsapp || c.phone, `Ciao, vorrei un'informazione`);
  const address = [c.address, [c.zip, c.city].filter(Boolean).join(' '), c.province ? `(${c.province})` : ''].filter(Boolean).join(', ');
  const nav = [['/', 'Home'], ['/servizi', 'Servizi e prezzi'], ['/#team', 'Team'], ['/#galleria', 'Galleria'], ['/#contatti', 'Contatti']];
  const ld = {
    '@context': 'https://schema.org', '@type': 'HairSalon', name: b.name, telephone: c.phone || undefined, image: s.site.hero_image || undefined,
    address: { '@type': 'PostalAddress', streetAddress: c.address, addressLocality: c.city, postalCode: c.zip, addressRegion: c.province, addressCountry: 'IT' },
    geo: c.lat ? { '@type': 'GeoCoordinates', latitude: c.lat, longitude: c.lng } : undefined,
    openingHoursSpecification: [0, 1, 2, 3, 4, 5, 6].flatMap(d => (s.hours[d] || []).map(([o, cl]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d], opens: o, closes: cl }))),
    sameAs: [c.instagram, c.facebook, c.tiktok].filter(Boolean),
  };
  const logo = b.logo_url ? `<img src="${e(b.logo_url)}" alt="${e(b.name)}" class="logo-img">` : `<span class="logo-text">${e(b.name)}</span>`;
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${e(fullTitle)}</title><meta name="description" content="${e(description || s.site.seo_description || b.tagline)}">
<meta property="og:title" content="${e(fullTitle)}"><meta property="og:description" content="${e(description || s.site.seo_description || '')}">
${s.site.hero_image ? `<meta property="og:image" content="${e(s.site.hero_image)}">` : ''}<meta name="theme-color" content="${e(b.primary)}">
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="${e(b.favicon_url || '/favicon.svg')}">
${fontsLink(b)}<link rel="stylesheet" href="/assets/site.css">
<style>:root{--primary:${e(b.primary)};--accent:${e(b.accent)};--bg:${e(b.background)};--font-h:'${e(b.font_heading)}',Georgia,serif;--font-b:'${e(b.font_body)}',system-ui,sans-serif}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head><body class="${bodyClass}">
<a class="skip" href="#main">Vai al contenuto</a>
<header class="site-header"><div class="wrap header-inner">
  <a href="/" class="brand">${logo}</a>
  <nav class="main-nav" id="main-nav" aria-label="Menu principale">${nav.map(([h, l]) => `<a href="${h}"${h === path ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
  <div class="header-cta">${phoneHref ? `<a class="icon-btn" href="${phoneHref}" aria-label="Chiama">${icon('phone')}</a>` : ''}
  ${t.modules.booking && s.booking.enabled ? `<a class="btn btn-primary" href="/prenota">Prenota ora</a>` : ''}
  <button class="icon-btn menu-toggle" aria-controls="main-nav" aria-expanded="false" aria-label="Apri menu">${icon('menu')}</button></div>
</div></header>
<main id="main">${body}</main>
<footer class="site-footer" id="contatti-footer"><div class="wrap footer-grid">
  <div><div class="footer-brand">${e(b.name)}</div><p class="muted">${e(b.tagline)}</p>
    <p>${e(address)}</p>${c.phone ? `<p><a href="${phoneHref}">${e(c.phone)}</a></p>` : ''}${c.email ? `<p><a href="mailto:${e(c.email)}">${e(c.email)}</a></p>` : ''}
    <div class="social">${c.instagram ? `<a href="${e(c.instagram)}" rel="noopener" target="_blank" aria-label="Instagram">${icon('instagram')}</a>` : ''}${c.facebook ? `<a href="${e(c.facebook)}" rel="noopener" target="_blank" aria-label="Facebook">${icon('facebook')}</a>` : ''}${c.tiktok ? `<a href="${e(c.tiktok)}" rel="noopener" target="_blank" aria-label="TikTok">${icon('tiktok')}</a>` : ''}${wa ? `<a href="${e(wa)}" rel="noopener" target="_blank" aria-label="WhatsApp">${icon('whatsapp')}</a>` : ''}</div></div>
  <div><div class="footer-title">Orari</div><table class="hours">${hoursRows(s.hours)}</table></div>
  <div><div class="footer-title">Informazioni</div><p><a href="/servizi">Servizi e prezzi</a></p><p><a href="/prenota">Prenota online</a></p>
    <p><a href="/privacy">Privacy</a> · <a href="/cookie">Cookie</a> · <a href="/termini">Condizioni</a></p>
    <p class="muted small">${e(c.legal_name || b.name)}${c.vat ? ` · P.IVA ${e(c.vat)}` : ''}</p><p class="muted small"><a href="/admin">Area riservata</a> · Realizzato da PromoApp</p></div>
</div></footer>
${t.modules.booking && s.booking.enabled ? `<div class="mobile-bar"><a class="btn btn-primary" href="/prenota">${icon('calendar')} Prenota ora</a>${wa ? `<a class="btn btn-wa" href="${e(wa)}" target="_blank" rel="noopener">${icon('whatsapp')}</a>` : ''}${phoneHref ? `<a class="btn btn-ghost" href="${phoneHref}">${icon('phone')}</a>` : ''}</div>` : ''}
<script src="/assets/site.js" defer></script>${scripts.map(s => `<script src="${s}" defer></script>`).join('')}
</body></html>`;
}

const ICONS = {
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  whatsapp: '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.5A8.4 8.4 0 1 1 21 11.5z"/><path d="M9 9.5c.3 1.6 1.7 3.6 3.6 4.4l1.2-1 1.8.8-.4 1.6c-3 .3-6.5-2.8-6.9-5.8l1.5-.6.9 1.6z"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  tiktok: '<path d="M9 12a4 4 0 1 0 4 4V2a5 5 0 0 0 5 5"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
};
function icon(n) { return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`; }

async function home(t) {
  const s = t.settings;
  const cat = await publicCatalog(t);
  const staff = s.site.show_staff ? await db.many('SELECT name, role_title, bio, specialties, photo_url FROM staff WHERE tenant_id=$1 AND active AND show_on_site ORDER BY sort, id', [t.id]) : [];
  const gallery = s.site.show_gallery && t.modules.gallery ? await db.many('SELECT url, caption FROM gallery WHERE tenant_id=$1 AND active ORDER BY sort, id LIMIT 12', [t.id]) : [];
  const reviews = s.site.show_reviews && t.modules.reviews ? await db.many('SELECT author, rating, body FROM reviews WHERE tenant_id=$1 AND approved ORDER BY created_at DESC LIMIT 6', [t.id]) : [];
  const today = U.todayLocal();
  const promos = s.site.show_promotions && t.modules.marketing ? await db.many(`SELECT title, description, kind, value, code, ends_on FROM promotions WHERE tenant_id=$1 AND active AND public AND NOT birthday
      AND (starts_on IS NULL OR starts_on <= $2) AND (ends_on IS NULL OR ends_on >= $2) ORDER BY id DESC LIMIT 6`, [t.id, today]) : [];
  const packages = t.modules.packages ? await db.many('SELECT name, description, sessions, price_cents FROM packages WHERE tenant_id=$1 AND active AND public ORDER BY price_cents LIMIT 6', [t.id]) : [];
  const c = s.contact;
  const booking = t.modules.booking && s.booking.enabled;
  const auds = ['donna', 'uomo', 'bambino'].filter(a => cat.services.some(x => x.audience === a));
  const mapsQ = encodeURIComponent([s.brand.name, c.address, c.zip, c.city].filter(Boolean).join(' '));
  const body = `
<section class="hero"><div class="hero-media">${s.site.hero_image ? `<img src="${e(s.site.hero_image)}" alt="" fetchpriority="high">` : ''}</div>
  <div class="wrap hero-content"><p class="eyebrow">${e(s.brand.tagline)} · ${e(c.city)}</p>
  <h1>${e(s.site.hero_title || s.brand.name)}</h1><p class="lead">${e(s.site.hero_subtitle)}</p>
  <div class="hero-actions">${booking ? '<a class="btn btn-primary btn-lg" href="/prenota">Prenota ora</a>' : ''}<a class="btn btn-light btn-lg" href="/servizi">Servizi e prezzi</a></div>
  <ul class="hero-facts"><li>${icon('pin')} ${e(c.address)}${c.city ? ', ' + e(c.city) : ''}</li>${c.phone ? `<li>${icon('phone')} <a href="tel:${U.normPhone(c.phone)}">${e(c.phone)}</a></li>` : ''}</ul></div>
</section>

<section class="section"><div class="wrap"><div class="section-head"><p class="eyebrow">I nostri servizi</p><h2>Per lei, per lui, per i più piccoli</h2></div>
<div class="aud-grid">${auds.map(a => {
    const list = cat.services.filter(x => x.audience === a).slice(0, 5);
    return `<article class="aud-card"><h3>${AUD_LABEL[a]}</h3><ul class="price-list">${list.map(x => `<li><span>${e(x.name)}</span><span class="dots"></span><strong>${money(x.price_cents, x.price_from)}</strong></li>`).join('')}</ul>
      <a class="link-arrow" href="/servizi#${a}">Listino completo →</a></article>`;
  }).join('')}</div></div></section>

<section class="section about"><div class="wrap about-grid"><div class="about-media">${s.site.about_image ? `<img src="${e(s.site.about_image)}" alt="Il salone ${e(s.brand.name)}" loading="lazy">` : ''}</div>
  <div><p class="eyebrow">Il salone</p><h2>${e(s.site.about_title)}</h2>${paragraphs(s.site.about_text)}${booking ? '<a class="btn btn-primary" href="/prenota">Prenota il tuo appuntamento</a>' : ''}</div></div></section>

${promos.length ? `<section class="section promos"><div class="wrap"><div class="section-head"><p class="eyebrow">Offerte</p><h2>Promozioni attive</h2></div><div class="card-grid">
${promos.map(p => `<article class="promo-card"><div class="promo-value">${p.kind === 'percent' ? `-${+p.value}%` : `-${U.euro(p.value * 100)}`}</div><h3>${e(p.title)}</h3>${p.description ? `<p>${e(p.description)}</p>` : ''}
${p.code ? `<p class="small">Codice: <strong>${e(p.code)}</strong></p>` : ''}${p.ends_on ? `<p class="small muted">Valida fino al ${new Date(p.ends_on + 'T12:00:00Z').toLocaleDateString('it-IT')}</p>` : ''}</article>`).join('')}</div></div></section>` : ''}

${packages.length ? `<section class="section"><div class="wrap"><div class="section-head"><p class="eyebrow">Pacchetti</p><h2>Pacchetti e abbonamenti</h2></div><div class="card-grid">
${packages.map(p => `<article class="card"><h3>${e(p.name)}</h3>${p.description ? `<p>${e(p.description)}</p>` : ''}<p><strong>${U.euro(p.price_cents)}</strong> · ${p.sessions} sedute</p><p class="small muted">Acquistabile in salone</p></article>`).join('')}</div></div></section>` : ''}

${staff.length ? `<section class="section" id="team"><div class="wrap"><div class="section-head"><p class="eyebrow">Il team</p><h2>Le mani esperte di Turn Over</h2></div><div class="team-grid">
${staff.map(m => `<article class="team-card">${m.photo_url ? `<img src="${e(m.photo_url)}" alt="${e(m.name)}" loading="lazy">` : `<div class="avatar-lg">${e(m.name.slice(0, 1))}</div>`}
<h3>${e(m.name)}</h3><p class="muted">${e(m.role_title || '')}</p>${m.specialties ? `<p class="small">${e(m.specialties)}</p>` : ''}${m.bio ? `<p>${e(m.bio)}</p>` : ''}</article>`).join('')}</div></div></section>` : ''}

${gallery.length ? `<section class="section" id="galleria"><div class="wrap"><div class="section-head"><p class="eyebrow">Galleria</p><h2>I nostri lavori</h2></div>
<div class="gallery">${gallery.map(g => `<figure><img src="${e(g.url)}" alt="${e(g.caption || 'Lavoro del salone')}" loading="lazy">${g.caption ? `<figcaption>${e(g.caption)}</figcaption>` : ''}</figure>`).join('')}</div></div></section>` : ''}

${reviews.length ? `<section class="section reviews"><div class="wrap"><div class="section-head"><p class="eyebrow">Dicono di noi</p><h2>Recensioni</h2></div><div class="card-grid">
${reviews.map(r => `<blockquote class="review"><div class="stars" aria-label="${r.rating} su 5">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div><p>${e(r.body)}</p><cite>${e(r.author)}</cite></blockquote>`).join('')}</div></div></section>` : ''}

${s.site.show_giftcards && t.modules.giftcards ? `<section class="section gift"><div class="wrap gift-inner">${icon('gift')}<div><h2>Gift card</h2><p>${e(s.site.giftcard_text)}</p></div>
${c.whatsapp || c.phone ? `<a class="btn btn-light" href="${e(waUrl(c.whatsapp || c.phone, 'Ciao, vorrei informazioni su una gift card'))}" target="_blank" rel="noopener">Chiedi su WhatsApp</a>` : ''}</div></section>` : ''}

<section class="section" id="contatti"><div class="wrap contact-grid">
  <div><p class="eyebrow">Vieni a trovarci</p><h2>Contatti e orari</h2>
    <p class="contact-line">${icon('pin')} <span>${e(c.address)}<br>${e(c.zip)} ${e(c.city)} ${c.province ? '(' + e(c.province) + ')' : ''}</span></p>
    ${c.phone ? `<p class="contact-line">${icon('phone')} <a href="tel:${U.normPhone(c.phone)}">${e(c.phone)}</a></p>` : ''}
    ${c.whatsapp || c.phone ? `<p class="contact-line">${icon('whatsapp')} <a href="${e(waUrl(c.whatsapp || c.phone, 'Ciao!'))}" target="_blank" rel="noopener">Scrivici su WhatsApp</a></p>` : ''}
    <table class="hours">${hoursRows(s.hours)}</table>
    <p><a class="btn btn-ghost" href="${e(c.maps_url || `https://www.google.com/maps/search/?api=1&query=${mapsQ}`)}" target="_blank" rel="noopener">${icon('pin')} Apri in Google Maps</a></p></div>
  <div class="map"><iframe title="Mappa" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${mapsQ}&output=embed"></iframe></div>
</div></section>`;
  return layout(t, { body, path: '/' });
}

async function services(t) {
  const cat = await publicCatalog(t);
  const auds = ['donna', 'uomo', 'bambino'].filter(a => cat.services.some(x => x.audience === a));
  const booking = t.modules.booking && t.settings.booking.enabled;
  const body = `<section class="page-head"><div class="wrap"><p class="eyebrow">Listino</p><h1>Servizi e prezzi</h1><p class="lead">Prezzi indicativi: per trattamenti tecnici il preventivo definitivo dipende da lunghezza e quantità dei capelli.</p>
  <nav class="tabs">${auds.map(a => `<a href="#${a}">${AUD_LABEL[a]}</a>`).join('')}</nav></div></section>
  <section class="section"><div class="wrap">${auds.map(a => `<div class="aud-block" id="${a}"><h2>${AUD_LABEL[a]}</h2>
  ${cat.categories.filter(c => c.audience === a).concat([{ id: null, name: 'Altri servizi' }]).map(c => {
    const list = cat.services.filter(x => x.audience === a && (x.category_id === c.id || (c.id === null && !cat.categories.some(k => k.id === x.category_id))));
    if (!list.length) return '';
    return `<h3 class="cat-title">${e(c.name)}</h3><div class="service-list">${list.map(x => `<article class="service-row"><div><h4>${e(x.name)}</h4>${x.description ? `<p>${e(x.description)}</p>` : ''}
      <span class="small muted">${icon('clock')} ${dur(x.duration_min)}</span></div><div class="service-side"><strong>${money(x.price_cents, x.price_from)}</strong>
      ${booking && x.online_bookable ? `<a class="btn btn-sm btn-ghost" href="/prenota?servizio=${x.id}">Prenota</a>` : ''}</div></article>`).join('')}</div>`;
  }).join('')}</div>`).join('')}</div></section>`;
  return layout(t, { title: 'Servizi e prezzi', description: `Listino prezzi di ${t.settings.brand.name}: servizi donna, uomo e bambino a ${t.settings.contact.city}.`, body, path: '/servizi' });
}

function bookPage(t) {
  if (!(t.modules.booking && t.settings.booking.enabled)) {
    return layout(t, { title: 'Prenota', body: `<section class="page-head"><div class="wrap"><h1>Prenotazioni</h1><p class="lead">Le prenotazioni online sono momentaneamente disattivate. Chiamaci o scrivici su WhatsApp.</p></div></section>` });
  }
  const body = `<section class="page-head compact"><div class="wrap"><p class="eyebrow">Prenotazione online</p><h1>Prenota il tuo appuntamento</h1></div></section>
  <section class="section"><div class="wrap narrow"><div id="booking-app" class="booking-app" aria-live="polite"><div class="loading">Caricamento…</div></div>
  <noscript><p>Per prenotare online è necessario JavaScript. In alternativa chiamaci al ${e(t.settings.contact.phone)}.</p></noscript></div></section>`;
  return layout(t, { title: 'Prenota online', description: `Prenota online da ${t.settings.brand.name}: scegli servizio, giorno e orario disponibili.`, body, path: '/prenota', bodyClass: 'page-book', scripts: ['/assets/booking.js'] });
}

function managePage(t) {
  const body = `<section class="page-head compact"><div class="wrap"><p class="eyebrow">La tua prenotazione</p><h1>Gestisci prenotazione</h1></div></section>
  <section class="section"><div class="wrap narrow"><div id="manage-app" class="booking-app" aria-live="polite"><div class="loading">Caricamento…</div></div></div></section>`;
  return layout(t, { title: 'La tua prenotazione', body, bodyClass: 'page-book', scripts: ['/assets/booking.js'] });
}

function legal(t, kind) {
  const s = t.settings; const c = s.contact;
  const owner = c.legal_name || s.brand.name;
  const addr = [c.address, c.zip, c.city, c.province].filter(Boolean).join(' ');
  const defaults = {
    privacy: `## Informativa sul trattamento dei dati personali\n\nAi sensi degli artt. 13 e 14 del Regolamento (UE) 2016/679 (GDPR).\n\n### Titolare del trattamento\n\n${owner}, ${addr}${c.vat ? ', P.IVA ' + c.vat : ''}. Contatti: ${[c.phone, c.email].filter(Boolean).join(' – ')}.\n\n### Dati trattati e finalità\n\n- Dati di contatto (nome, cognome, telefono, email) per gestire prenotazioni, promemoria e comunicazioni di servizio (base giuridica: esecuzione di un contratto o di misure precontrattuali).\n- Dati relativi ai trattamenti eseguiti, preferenze e note tecniche (es. formule colore) per erogare il servizio richiesto (base giuridica: contratto).\n- Data di nascita e recapiti per comunicazioni promozionali e auguri, solo con il tuo consenso facoltativo e revocabile (base giuridica: consenso).\n- Fotografie prima/dopo, solo con specifico consenso.\n- Dati contabili per adempimenti fiscali (base giuridica: obbligo di legge).\n\n### Conservazione\n\nI dati sono conservati per il tempo necessario alla gestione del rapporto e, per i dati contabili, per i termini previsti dalla legge. I dati per finalità promozionali sono conservati fino alla revoca del consenso.\n\n### Destinatari\n\nFornitori che supportano il salone nella gestione del software (hosting, invio email/WhatsApp), nominati responsabili del trattamento. I dati non sono diffusi.\n\n### I tuoi diritti\n\nPuoi chiedere in qualsiasi momento accesso, rettifica, cancellazione, limitazione, portabilità dei dati e opporti al trattamento, oltre a revocare i consensi, contattando il titolare. Hai diritto di proporre reclamo al Garante per la protezione dei dati personali (www.garanteprivacy.it).`,
    cookie: `## Cookie policy\n\nQuesto sito utilizza esclusivamente cookie tecnici necessari al funzionamento (ad esempio per mantenere l’accesso all’area riservata). Non utilizziamo cookie di profilazione o di marketing.\n\nLa pagina Contatti incorpora una mappa di Google Maps, che può impostare cookie propri secondo la privacy policy di Google. I caratteri tipografici sono forniti da Google Fonts.\n\nPuoi gestire o eliminare i cookie dalle impostazioni del tuo browser.`,
    termini: `## Condizioni di prenotazione\n\n${s.booking.terms}\n\nLa prenotazione online è gratuita. In caso di mancata presentazione senza preavviso il salone potrà richiedere conferma telefonica per le prenotazioni successive.${s.booking.no_show_policy ? '\n\n' + s.booking.no_show_policy : ''}\n\nI prezzi indicati sul sito sono indicativi e possono variare in base alla lunghezza dei capelli e ai prodotti utilizzati.`,
  };
  const text = (kind === 'privacy' ? s.site.privacy_html : kind === 'cookie' ? s.site.cookie_html : s.site.terms_html) || defaults[kind];
  const title = { privacy: 'Privacy', cookie: 'Cookie', termini: 'Condizioni di prenotazione' }[kind];
  return layout(t, { title, body: `<section class="section"><div class="wrap narrow legal">${paragraphs(text)}</div></section>`, path: '/' + kind });
}

function manifest(t) {
  const b = t.settings.brand;
  return JSON.stringify({
    name: b.name, short_name: b.name.slice(0, 20), start_url: '/admin/', scope: '/', display: 'standalone', background_color: b.background, theme_color: b.primary, lang: 'it',
    icons: [{ src: b.favicon_url || '/favicon.svg', sizes: 'any', type: b.favicon_url ? 'image/png' : 'image/svg+xml', purpose: 'any' }],
    shortcuts: [{ name: 'Agenda', url: '/admin/#/agenda' }, { name: 'Prenota', url: '/prenota' }],
  });
}

async function render(req, res, pathname) {
  const t = req.tenant;
  if (pathname === '/manifest.webmanifest') return H.send(res, 200, manifest(t), { 'Content-Type': 'application/manifest+json' });
  if (pathname === '/robots.txt') return H.send(res, 200, `User-agent: *\nDisallow: /admin\nDisallow: /api\nDisallow: /prenotazione/\nSitemap: https://${req.headers.host}/sitemap.xml\n`, { 'Content-Type': 'text/plain' });
  if (pathname === '/sitemap.xml') {
    const base = `https://${req.headers.host}`;
    return H.send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/servizi', '/prenota', '/privacy'].map(p => `<url><loc>${base}${p}</loc></url>`).join('')}</urlset>`, { 'Content-Type': 'application/xml' });
  }
  let page;
  if (pathname === '/' || pathname === '/index.html') page = await home(t);
  else if (pathname === '/servizi') page = await services(t);
  else if (pathname === '/prenota') page = bookPage(t);
  else if (/^\/prenotazione\/[\w-]{10,64}$/.test(pathname)) page = managePage(t);
  else if (['/privacy', '/cookie', '/termini'].includes(pathname)) page = legal(t, pathname.slice(1));
  else return errorPage(req, res, 404, 'Pagina non trovata');
  H.html(res, 200, page, req);
}

function errorPage(req, res, status, message) {
  const t = req.tenant;
  if (!t) return H.html(res, status, `<h1>${status}</h1><p>${e(message)}</p>`);
  H.html(res, status, layout(t, { title: String(status), body: `<section class="section"><div class="wrap narrow center"><h1>${status === 404 ? 'Pagina non trovata' : 'Ops!'}</h1><p class="lead">${e(message)}</p><a class="btn btn-primary" href="/">Torna alla home</a></div></section>` }), req);
}

module.exports = { render, errorPage };
