import { h, get, put, post, state, card, table, tabs, form, toast, toastErr, busy, fmtDateTime, fullName, loading } from '../lib.js';

const ST = { inviato: ['Inviato', 'ok'], errore: ['Errore', 'err'], non_configurato: ['Provider non configurato', 'warn'], senza_consenso: ['Senza consenso marketing', ''], senza_recapito: ['Senza recapito', ''] };
const VARS = ['nome', 'cognome', 'salone', 'data', 'ora', 'servizi', 'operatore', 'link', 'sito', 'recensione', 'telefono', 'totale'];

export default async function ({ content }) {
  let tab = 'canali';
  const body = h('div'); content.append(body);
  async function render() {
    body.innerHTML = '';
    body.append(tabs([['canali', 'Canali e automazioni'], ['testi', 'Testi dei messaggi'], ['registro', 'Registro invii']], tab, k => { tab = k; render(); }));
    const box = h('div'); body.append(box); box.appendChild(loading());
    try { await ({ canali, testi, registro })[tab](box); } catch (e) { toastErr(e); }
  }
  async function canali(box) {
    const st = await get('/api/admin/settings');
    const p = st.providers; const ns = st.settings.notifications;
    const prov = (ok, name, how) => h('div', { class: `alert ${ok ? 'ok' : 'warn'}` }, h('strong', { text: `${name}: ${ok ? 'collegato' : 'non collegato'}` }), ok ? '' : h('div', { class: 'small', text: how }));
    const f = form([
      { type: 'section', label: 'Canali' },
      { name: 'email_enabled', label: 'Invia email ai clienti', type: 'checkbox', full: true }, { name: 'whatsapp_enabled', label: 'Invia messaggi WhatsApp ai clienti', type: 'checkbox', full: true },
      { type: 'section', label: 'Automazioni' },
      { name: 'reminder_hours', label: 'Promemoria: ore prima dell’appuntamento', type: 'number', min: 1, max: 168 },
      { name: 'review_request', label: 'Chiedi una recensione dopo il servizio', type: 'checkbox' }, { name: 'review_delay_hours', label: 'Ore dopo il servizio', type: 'number', min: 1 },
      { name: 'review_url', label: 'Link per la recensione (es. Google)', full: true, placeholder: 'https://g.page/r/…' },
      { name: 'birthday', label: 'Auguri di compleanno automatici (solo con consenso)', type: 'checkbox' }, { name: 'birthday_hour', label: 'Ora di invio auguri', type: 'number', min: 7, max: 21 },
      { type: 'section', label: 'Avvisi al salone' },
      { name: 'owner_email', label: 'Email del salone per le nuove prenotazioni', type: 'email' }, { name: 'notify_owner_new_booking', label: 'Avvisami a ogni prenotazione online', type: 'checkbox' },
    ], ns);
    const save = h('button', { class: 'btn primary' }, 'Salva');
    save.addEventListener('click', busy(save, async () => { await put('/api/admin/settings', { settings: { notifications: f.values() } }); toast('Impostazioni salvate', 'ok'); }));
    const testEmail = h('input', { type: 'email', placeholder: 'tua@email.it' }); const testPhone = h('input', { type: 'tel', placeholder: '+39…' });
    const testBtn = h('button', { class: 'btn' }, 'Invia prova');
    testBtn.addEventListener('click', busy(testBtn, async () => {
      const r = await post('/api/admin/notifications/test', { email: testEmail.value, phone: testPhone.value });
      toast(r.map(x => `${x.channel}: ${(ST[x.status] || [x.status])[0]}${x.error ? ' – ' + x.error : ''}`).join(' · ') || 'Inserisci email o telefono', r.every(x => x.status === 'inviato') ? 'ok' : 'err');
    }));
    box.innerHTML = '';
    box.append(h('div', { class: 'grid g2' },
      h('div', { class: 'stack' }, card('Stato integrazioni', h('div', { class: 'stack' },
        prov(!!p.email, `Email (${p.email || 'Resend o Brevo'})`, 'Serve un account Resend o Brevo e la chiave API nei Secrets di Replit (RESEND_API_KEY o BREVO_API_KEY, più EMAIL_FROM).'),
        prov(!!p.whatsapp, 'WhatsApp Business Platform', 'Serve un account Meta WhatsApp Business verificato, numero dedicato, template approvati e i Secrets WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID.'),
        h('p', { class: 'small muted', text: 'Senza provider, nessun messaggio viene inviato: gli invii risultano “Provider non configurato” nel registro. Puoi sempre scrivere al cliente con il pulsante WhatsApp dell’agenda (apre WhatsApp sul tuo telefono).' }))),
      card('Messaggio di prova', h('div', { class: 'stack' }, testEmail, testPhone, testBtn))),
      card('Impostazioni', [f.el, h('div', { class: 'row end', style: { marginTop: '12px' } }, save)])));
  }
  async function testi(box) {
    const list = await get('/api/admin/notifications/templates');
    box.innerHTML = '';
    box.append(h('div', { class: 'alert', style: { marginBottom: '12px' } }, 'Variabili disponibili: ', VARS.map(v => h('span', { class: 'kbd', style: { margin: '0 3px' }, text: `{{${v}}}` }))));
    const keys = [...new Set(list.map(t => t.key))];
    for (const key of keys) {
      const items = list.filter(t => t.key === key);
      box.append(card(items[0].label + (items[0].marketing ? ' · richiede consenso marketing' : ''), h('div', { class: 'grid g2' }, items.map(t => {
        const f = form([t.channel === 'email' ? { name: 'subject', label: 'Oggetto email', full: true } : { name: 'wa_template', label: 'Nome template WhatsApp approvato (facoltativo)', full: true, hint: 'Parametri: {{1}} nome, {{2}} data, {{3}} ora, {{4}} servizi, {{5}} link' },
          { name: 'body', label: t.channel === 'email' ? 'Testo email' : 'Testo WhatsApp', type: 'textarea', rows: 4, required: true }, { name: 'active', label: 'Attivo', type: 'checkbox' }], t);
        const save = h('button', { class: 'btn sm primary' }, 'Salva');
        save.addEventListener('click', busy(save, async () => { await put(`/api/admin/notifications/templates/${t.id}`, f.values()); toast('Testo salvato', 'ok'); }));
        return h('div', { class: 'tpl' }, h('strong', { text: t.channel === 'email' ? 'Email' : 'WhatsApp' }), f.el, h('div', { class: 'row end', style: { marginTop: '8px' } }, save));
      }))), h('div', { style: { height: '14px' } }));
    }
  }
  async function registro(box) {
    const list = await get('/api/admin/notifications/log');
    box.innerHTML = '';
    box.append(card(null, table([{ label: 'Data', render: l => fmtDateTime(l.created_at) }, { label: 'Cliente', render: l => fullName(l) }, { label: 'Messaggio', key: 'template_key' },
      { label: 'Canale', key: 'channel' }, { label: 'Destinatario', key: 'to_addr' }, { label: 'Esito', render: l => h('span', { class: `badge ${(ST[l.status] || ['', ''])[1]}`, text: (ST[l.status] || [l.status])[0] }) },
      { label: 'Dettaglio', render: l => h('span', { class: 'small muted', text: l.error || (l.body || '').slice(0, 80) }) }], list, { empty: 'Nessun messaggio registrato' })));
  }
  render();
}
