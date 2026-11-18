import { h, icon, get, post, put, del, can, state, card, table, tabs, form, formModal, modal, toast, toastErr, busy, confirmDialog, fmtDateTime, cached, loading } from '../lib.js';

const DAYS = [[1, 'Lunedì'], [2, 'Martedì'], [3, 'Mercoledì'], [4, 'Giovedì'], [5, 'Venerdì'], [6, 'Sabato'], [0, 'Domenica']];
const ROLES = [['admin', 'Amministratore'], ['manager', 'Responsabile salone'], ['receptionist', 'Receptionist'], ['operator', 'Operatore']];
const MODULES = [['booking', 'Prenotazioni online'], ['cash', 'Cassa'], ['inventory', 'Magazzino'], ['marketing', 'Promozioni e marketing'], ['loyalty', 'Programma fedeltà'], ['giftcards', 'Gift card'],
  ['packages', 'Pacchetti'], ['waitlist', 'Lista d’attesa'], ['notifications', 'Messaggi automatici'], ['gallery', 'Galleria sul sito'], ['reviews', 'Recensioni sul sito']];

export default async function ({ content, params }) {
  const admin = can('settings.manage');
  let tab = params[0] || (admin ? 'salone' : 'orari');
  const body = h('div'); content.append(body);
  let st;
  async function render() {
    body.innerHTML = '';
    const list = [admin && ['salone', 'Salone e contatti'], ['orari', 'Orari di apertura'], ['prenotazioni', 'Regole prenotazione'], admin && ['moduli', 'Moduli'], admin && ['utenti', 'Utenti e ruoli'],
      admin && ['dominio', 'Dominio'], admin && ['demo', 'Dati e backup'], admin && ['registro', 'Registro attività']].filter(Boolean);
    body.append(tabs(list, tab, k => { tab = k; history.replaceState(null, '', `#/impostazioni/${k}`); render(); }));
    const box = h('div'); body.append(box); box.appendChild(loading());
    try { st = await get('/api/admin/settings'); await ({ salone, orari, prenotazioni, moduli, utenti, dominio, demo, registro })[tab](box); } catch (e) { toastErr(e); }
  }
  function saveSection(section, f, extra = {}) {
    const b = h('button', { class: 'btn primary' }, 'Salva');
    b.addEventListener('click', busy(b, async () => { await put('/api/admin/settings', { settings: { [section]: f.values() }, ...extra }); toast('Impostazioni salvate', 'ok'); }));
    return h('div', { class: 'row end', style: { marginTop: '14px' } }, b);
  }
  async function salone(box) {
    const f = form([{ name: 'address', label: 'Indirizzo', full: true }, { name: 'zip', label: 'CAP' }, { name: 'city', label: 'Città' }, { name: 'province', label: 'Provincia' },
      { name: 'phone', label: 'Telefono' }, { name: 'whatsapp', label: 'WhatsApp' }, { name: 'email', label: 'Email' },
      { name: 'maps_url', label: 'Link Google Maps', full: true }, { name: 'instagram', label: 'Instagram (URL)' }, { name: 'facebook', label: 'Facebook (URL)' }, { name: 'tiktok', label: 'TikTok (URL)' },
      { type: 'section', label: 'Dati legali (pagina privacy e piè di pagina)' }, { name: 'legal_name', label: 'Ragione sociale' }, { name: 'vat', label: 'Partita IVA' }], st.settings.contact);
    const nameI = h('input', { type: 'text', value: st.name });
    box.innerHTML = '';
    box.append(card('Salone', [h('label', { class: 'field', style: { marginBottom: '14px' } }, h('span', { text: 'Nome attività (interno)' }), nameI), f.el,
      (() => { const b = h('button', { class: 'btn primary' }, 'Salva'); b.addEventListener('click', busy(b, async () => { await put('/api/admin/settings', { name: nameI.value, settings: { contact: f.values() } }); toast('Salvato', 'ok'); })); return h('div', { class: 'row end', style: { marginTop: '14px' } }, b); })()]));
  }
  async function orari(box) {
    const hours = JSON.parse(JSON.stringify(st.settings.hours));
    const wrap = h('div');
    function draw() {
      wrap.innerHTML = '';
      for (const [d, l] of DAYS) {
        const list = hours[d] || hours[String(d)] || []; hours[d] = list;
        const ranges = h('div', { class: 'ranges' });
        if (!list.length) ranges.append(h('span', { class: 'badge', text: 'Chiuso' }));
        list.forEach((r, i) => {
          const a = h('input', { type: 'time', value: r[0], onchange: () => { r[0] = a.value; } }); const b = h('input', { type: 'time', value: r[1], onchange: () => { r[1] = b.value; } });
          ranges.append(h('span', { class: 'rg' }, a, '–', b, h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': 'Rimuovi', onclick: () => { list.splice(i, 1); draw(); } }, icon('x'))));
        });
        ranges.append(h('button', { class: 'btn sm', type: 'button', onclick: () => { list.push(list.length ? ['15:00', '19:00'] : ['09:00', '18:00']); draw(); } }, list.length ? '+ fascia' : 'Apri'));
        wrap.append(h('div', { class: 'sched-row' }, h('strong', { text: l }), ranges));
      }
    }
    draw();
    const b = h('button', { class: 'btn primary' }, 'Salva orari');
    b.addEventListener('click', busy(b, async () => { await put('/api/admin/settings', { settings: { hours } }); toast('Orari salvati: sito e prenotazioni aggiornati', 'ok'); }));
    box.innerHTML = '';
    box.append(card('Orari di apertura del salone', [h('p', { class: 'muted', text: 'Per la pausa pranzo crea due fasce (es. 09:00–13:00 e 14:00–19:00). I turni dei singoli operatori si impostano in Staff. Le chiusure straordinarie in Staff → Assenze.' }), wrap, h('div', { class: 'row end', style: { marginTop: '14px' } }, b)]));
  }
  async function prenotazioni(box) {
    const f = form([{ name: 'enabled', label: 'Prenotazioni online attive', type: 'checkbox', full: true },
      { name: 'slot_step_min', label: 'Intervallo tra gli orari proposti (min)', type: 'select', empty: false, options: [[5, '5'], [10, '10'], [15, '15'], [20, '20'], [30, '30']] },
      { name: 'min_notice_min', label: 'Preavviso minimo (minuti)', type: 'number', min: 0, hint: 'Es. 120 = non si può prenotare per le prossime 2 ore' },
      { name: 'max_advance_days', label: 'Prenotabile fino a (giorni)', type: 'number', min: 1, max: 365 },
      { name: 'cancel_min_hours', label: 'Annullamento/spostamento online fino a (ore prima)', type: 'number', min: 0 },
      { name: 'require_approval', label: 'Le prenotazioni online vanno confermate dal salone', type: 'checkbox', full: true },
      { name: 'allow_staff_choice', label: 'Il cliente può scegliere l’operatore', type: 'checkbox', full: true },
      { name: 'terms', label: 'Regole mostrate al cliente', type: 'textarea' }, { name: 'no_show_policy', label: 'Regole per mancata presentazione', type: 'textarea' },
      { type: 'section', label: 'Acconto online' }],
    { ...st.settings.booking, slot_step_min: String(st.settings.booking.slot_step_min) });
    box.innerHTML = '';
    box.append(card('Regole di prenotazione', [f.el,
      h('div', { class: 'alert warn', style: { marginTop: '8px' } }, 'Acconto/pagamento anticipato online: richiede un account di pagamento (es. Stripe) con chiavi dedicate. L’integrazione non è ancora attiva: vedi docs/INTEGRAZIONI.md.'),
      saveSection('booking', { values: () => { const v = f.values(); v.slot_step_min = +v.slot_step_min; return v; } })]));
  }
  async function moduli(box) {
    const f = form(MODULES.map(([k, l]) => ({ name: k, label: l, type: 'checkbox' })), st.modules);
    const b = h('button', { class: 'btn primary' }, 'Salva');
    b.addEventListener('click', busy(b, async () => { await put('/api/admin/settings', { modules: f.values() }); toast('Moduli aggiornati: ricarico…', 'ok'); setTimeout(() => location.reload(), 800); }));
    box.innerHTML = '';
    box.append(card('Moduli attivi', [h('p', { class: 'muted', text: 'Disattiva le funzioni che il salone non usa: spariranno dal menu e dal sito. I dati restano conservati.' }), f.el, h('div', { class: 'row end', style: { marginTop: '14px' } }, b)]));
  }
  async function utenti(box) {
    const [users, staff] = await Promise.all([get('/api/admin/users'), cached('staff', '/api/admin/staff')]);
    const edit = u => formModal({ title: u ? `Utente ${u.username}` : 'Nuovo utente', values: u || { role: 'operator', active: true },
      fields: [{ name: 'username', label: 'Nome utente', required: true }, { name: 'display_name', label: 'Nome visualizzato' }, { name: 'email', label: 'Email', type: 'email' },
        { name: 'role', label: 'Ruolo', type: 'select', options: ROLES, empty: false }, { name: 'staff_id', label: 'Collegato all’operatore', type: 'select', options: staff.map(s => [s.id, s.name]), hint: 'Gli operatori vedono e gestiscono i propri appuntamenti' },
        { name: 'password', label: u ? 'Nuova password (lascia vuoto per non cambiarla)' : 'Password', type: 'password', required: !u }, { name: 'active', label: 'Attivo', type: 'checkbox' }],
      onSave: async v => { if (!v.password) delete v.password; if (u) await put(`/api/admin/users/${u.id}`, v); else await post('/api/admin/users', v); render(); },
      deleteFn: u && u.id !== state.me.id ? async () => { await del(`/api/admin/users/${u.id}`); render(); } : null });
    box.innerHTML = '';
    box.append(h('div', { class: 'row end', style: { marginBottom: '10px' } }, h('button', { class: 'btn primary', onclick: () => edit() }, icon('plus'), 'Nuovo utente')),
      card(null, table([{ label: 'Utente', render: u => h('div', null, h('strong', { text: u.username }), h('div', { class: 'small muted', text: u.display_name || '' })) },
        { label: 'Ruolo', render: u => (ROLES.find(r => r[0] === u.role) || [0, u.role])[1] }, { label: 'Operatore', render: u => (staff.find(s => s.id === u.staff_id) || {}).name || '' },
        { label: 'Ultimo accesso', render: u => u.last_login_at ? fmtDateTime(u.last_login_at) : 'mai' }, { label: 'Stato', render: u => h('span', { class: `badge ${u.active ? 'ok' : 'err'}`, text: u.active ? 'Attivo' : 'Disattivo' }) }],
      users, { onRow: edit })),
      card('Cosa può fare ogni ruolo', h('ul', { class: 'small' }, h('li', { text: 'Amministratore: tutto, compresi utenti, impostazioni e dati.' }),
        h('li', { text: 'Responsabile salone: agenda, clienti, cassa e report, staff, servizi, magazzino, marketing, orari.' }),
        h('li', { text: 'Receptionist: agenda, clienti, cassa (senza report economici).' }), h('li', { text: 'Operatore: agenda (modifica stato dei propri appuntamenti), schede clienti e note tecniche.' }))));
  }
  async function dominio(box) {
    const ta = h('textarea', { rows: 3, placeholder: 'turnoverbyzaira.it\nwww.turnoverbyzaira.it' }); ta.value = st.domains.map(d => d.host).join('\n');
    const b = h('button', { class: 'btn primary' }, 'Salva');
    b.addEventListener('click', busy(b, async () => { await put('/api/admin/settings', { domains: ta.value.split(/\s+/).filter(Boolean) }); toast('Domini salvati', 'ok'); }));
    box.innerHTML = '';
    box.append(card('Domini personalizzati', [h('p', { class: 'muted', text: 'Collega il dominio in Replit (Deployments → Settings → Custom domain), poi elencalo qui: ogni dominio mostra i dati di questo salone. Un dominio per riga.' }), ta, h('div', { class: 'row end', style: { marginTop: '12px' } }, b)]));
  }
  async function demo(box) {
    box.innerHTML = '';
    box.append(h('div', { class: 'grid g2' },
      card('Dati dimostrativi', [h('p', { class: 'muted', text: st.is_demo ? 'Sono presenti clienti e appuntamenti di prova (marcati come demo). Eliminali prima di iniziare a lavorare con i clienti reali.' : 'Nessun dato dimostrativo presente.' }),
        h('button', { class: 'btn danger', disabled: !st.is_demo, onclick: async () => {
          if (!(await confirmDialog('Eliminare tutti i clienti, gli appuntamenti e gli incassi dimostrativi? I dati reali non vengono toccati.', { danger: true, ok: 'Elimina dati demo' }))) return;
          try { await post('/api/admin/demo/clear'); toast('Dati demo eliminati', 'ok'); setTimeout(() => location.reload(), 600); } catch (e) { toastErr(e); }
        } }, 'Elimina dati demo')]),
      card('Backup', [h('p', { class: 'muted', text: 'Il database PostgreSQL di Replit ha backup automatici e ripristino a un punto nel tempo (pannello Database). Per una copia esterna è disponibile lo script npm run backup (vedi docs/BACKUP.md).' })]),
      card('Esportazioni', [h('p', { class: 'muted', text: 'Esporta l’elenco clienti in CSV da Clienti → Esporta. I dati di un singolo cliente (GDPR) dalla sua scheda.' })])));
  }
  async function registro(box) {
    const list = await get('/api/admin/audit');
    box.innerHTML = '';
    box.append(card('Ultime attività', table([{ label: 'Data', render: a => fmtDateTime(a.created_at) }, { label: 'Utente', render: a => a.username || '—' }, { label: 'Azione', key: 'action' }, { label: 'Elemento', render: a => [a.entity, a.entity_id].filter(Boolean).join(' #') }, { label: 'IP', key: 'ip' }], list)));
  }
  render();
}
