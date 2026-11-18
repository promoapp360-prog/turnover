import { h, icon, get, post, put, del, can, card, table, tabs, form, formModal, toast, toastErr, busy, fmtDate, loading } from '../lib.js';

export default async function ({ content, actions }) {
  let tab = 'contenuti';
  actions.append(h('a', { class: 'btn', href: '/', target: '_blank' }, icon('external'), 'Apri il sito'));
  const body = h('div'); content.append(body);
  async function render() {
    body.innerHTML = '';
    body.append(tabs([['contenuti', 'Testi e immagini'], ['galleria', 'Galleria'], ['recensioni', 'Recensioni'], can('settings.manage') ? ['brand', 'Logo e colori'] : null, ['legale', 'Privacy e condizioni']].filter(Boolean), tab, k => { tab = k; render(); }));
    const box = h('div'); body.append(box); box.appendChild(loading());
    try { await ({ contenuti, galleria, recensioni, brand, legale })[tab](box); } catch (e) { toastErr(e); }
  }
  async function settingsForm(box, section, fields, title, note) {
    const st = await get('/api/admin/settings');
    const f = form(fields, st.settings[section]);
    const save = h('button', { class: 'btn primary' }, 'Salva e pubblica');
    save.addEventListener('click', busy(save, async () => { await put('/api/admin/settings', { settings: { [section]: f.values() } }); toast('Sito aggiornato', 'ok'); }));
    box.innerHTML = '';
    box.append(card(title, [note ? h('p', { class: 'muted', text: note }) : null, f.el, h('div', { class: 'row end', style: { marginTop: '14px' } }, save)]));
  }
  const contenuti = box => settingsForm(box, 'site', [
    { name: 'hero_title', label: 'Titolo principale', full: true }, { name: 'hero_subtitle', label: 'Sottotitolo', type: 'textarea', rows: 2 }, { name: 'hero_image', label: 'Immagine di copertina', type: 'image' },
    { name: 'about_title', label: 'Titolo sezione “Chi siamo”', full: true }, { name: 'about_text', label: 'Testo “Chi siamo” (riga vuota = nuovo paragrafo)', type: 'textarea', rows: 6 }, { name: 'about_image', label: 'Immagine “Chi siamo”', type: 'image' },
    { name: 'giftcard_text', label: 'Testo gift card', type: 'textarea', rows: 2 }, { name: 'seo_description', label: 'Descrizione per Google (max 160 caratteri)', type: 'textarea', rows: 2 },
    { type: 'section', label: 'Sezioni visibili' },
    { name: 'show_staff', label: 'Team', type: 'checkbox' }, { name: 'show_gallery', label: 'Galleria', type: 'checkbox' }, { name: 'show_reviews', label: 'Recensioni', type: 'checkbox' },
    { name: 'show_promotions', label: 'Promozioni', type: 'checkbox' }, { name: 'show_giftcards', label: 'Gift card', type: 'checkbox' },
  ], 'Contenuti della home', 'Listino, orari, staff e promozioni si aggiornano automaticamente dalle altre sezioni del gestionale.');
  const brand = box => settingsForm(box, 'brand', [
    { name: 'name', label: 'Nome del salone', required: true }, { name: 'tagline', label: 'Slogan' }, { name: 'logo_url', label: 'Logo (se vuoto si usa il nome)', type: 'image' }, { name: 'favicon_url', label: 'Icona app / favicon (PNG quadrato)', type: 'image' },
    { name: 'primary', label: 'Colore principale', type: 'color' }, { name: 'accent', label: 'Colore di accento', type: 'color' }, { name: 'background', label: 'Colore di sfondo', type: 'color' },
    { name: 'font_heading', label: 'Font titoli (Google Fonts)', type: 'select', empty: false, options: ['Playfair Display', 'Cormorant Garamond', 'DM Serif Display', 'Lora', 'Montserrat', 'Poppins'].map(x => [x, x]) },
    { name: 'font_body', label: 'Font testo', type: 'select', empty: false, options: ['Inter', 'DM Sans', 'Lato', 'Nunito Sans', 'Montserrat', 'Poppins'].map(x => [x, x]) },
  ], 'Identità grafica');
  const legale = box => settingsForm(box, 'site', [
    { name: 'privacy_html', label: 'Informativa privacy (vuoto = testo standard generato con i dati del salone)', type: 'textarea', rows: 8 },
    { name: 'cookie_html', label: 'Cookie policy (vuoto = testo standard)', type: 'textarea', rows: 5 }, { name: 'terms_html', label: 'Condizioni di prenotazione (vuoto = testo standard)', type: 'textarea', rows: 5 },
  ], 'Pagine legali', 'Formattazione semplice: “## ” per i titoli, “- ” per gli elenchi, riga vuota per nuovo paragrafo. Fai verificare i testi da un consulente privacy.');
  async function galleria(box) {
    const list = await get('/api/admin/r/gallery');
    box.innerHTML = '';
    const add = () => formModal({ title: 'Nuova foto', values: { active: true }, fields: [{ name: 'url', label: 'Immagine', type: 'image', required: true }, { name: 'caption', label: 'Didascalia' }, { name: 'sort', label: 'Ordine', type: 'number' }, { name: 'active', label: 'Visibile', type: 'checkbox' }], onSave: async v => { await post('/api/admin/r/gallery', v); render(); } });
    box.append(h('div', { class: 'row end', style: { marginBottom: '10px' } }, h('button', { class: 'btn primary', onclick: add }, icon('plus'), 'Aggiungi foto')),
      list.length ? h('div', { class: 'photo-grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))' } }, list.map(g => h('figure', { style: { margin: 0, cursor: 'pointer', opacity: g.active ? 1 : 0.4 }, onclick: () => formModal({ title: 'Modifica foto', values: g,
        fields: [{ name: 'url', label: 'Immagine', type: 'image', required: true }, { name: 'caption', label: 'Didascalia' }, { name: 'sort', label: 'Ordine', type: 'number' }, { name: 'active', label: 'Visibile', type: 'checkbox' }],
        onSave: async v => { await put(`/api/admin/r/gallery/${g.id}`, v); render(); }, deleteFn: async () => { await del(`/api/admin/r/gallery/${g.id}`); render(); } }) },
      h('img', { src: g.url, alt: g.caption || '' }), h('figcaption', { class: 'small', text: g.caption || '' })))) : h('div', { class: 'card empty', text: 'Nessuna foto' }));
  }
  async function recensioni(box) {
    const list = await get('/api/admin/r/reviews');
    box.innerHTML = '';
    const fields = [{ name: 'author', label: 'Nome cliente', required: true }, { name: 'rating', label: 'Voto (1-5)', type: 'number', min: 1, max: 5, required: true }, { name: 'source', label: 'Fonte', placeholder: 'Google, Treatwell, in salone…' },
      { name: 'body', label: 'Testo', type: 'textarea', required: true }, { name: 'approved', label: 'Pubblica sul sito (solo con autorizzazione del cliente)', type: 'checkbox', full: true }];
    box.append(h('div', { class: 'row between', style: { marginBottom: '10px' } }, h('p', { class: 'muted', style: { margin: 0 }, text: 'Pubblica solo recensioni reali, di cui hai l’autorizzazione dell’autore.' }),
      h('button', { class: 'btn primary', onclick: () => formModal({ title: 'Nuova recensione', values: { rating: 5 }, fields, onSave: async v => { await post('/api/admin/r/reviews', v); render(); } }) }, icon('plus'), 'Aggiungi')),
    card(null, table([{ label: 'Autore', key: 'author' }, { label: 'Voto', render: r => '★'.repeat(r.rating) }, { label: 'Testo', render: r => h('span', { class: 'small', text: r.body.slice(0, 120) }) }, { label: 'Fonte', key: 'source' },
      { label: 'Stato', render: r => h('span', { class: `badge ${r.approved ? 'ok' : ''}`, text: r.approved ? 'Pubblicata' : 'Non pubblicata' }) }, { label: 'Data', render: r => fmtDate(r.created_at) }],
    list, { onRow: r => formModal({ title: 'Recensione', values: r, fields, onSave: async v => { await put(`/api/admin/r/reviews/${r.id}`, v); render(); }, deleteFn: async () => { await del(`/api/admin/r/reviews/${r.id}`); render(); } }), empty: 'Nessuna recensione' })));
  }
  render();
}
