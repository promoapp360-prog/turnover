import { h, icon, get, post, put, del, can, state, euro, num, fmtDate, card, table, tabs, form, formModal, modal, toast, toastErr, busy, button, cached, loading, AUD } from '../lib.js';

export default async function ({ content, actions, params }) {
  let tab = params[0] || 'promozioni';
  const body = h('div'); content.append(body);
  const addBtn = h('button', { class: 'btn primary' }, icon('plus'), 'Nuovo');
  actions.append(addBtn);
  const services = await cached('services', '/api/admin/r/services?active=1');
  const svcOpts = services.map(s => [s.id, `${AUD[s.audience]} · ${s.name}`]);
  async function render() {
    body.innerHTML = '';
    body.append(tabs([['promozioni', 'Promozioni e coupon'], ['pacchetti', 'Pacchetti e abbonamenti'], ['giftcard', 'Gift card'], ['fedelta', 'Programma fedeltà'], ['campagne', 'Campagne e recupero clienti']], tab, k => { tab = k; history.replaceState(null, '', `#/marketing/${k}`); render(); }));
    addBtn.style.display = ['promozioni', 'pacchetti', 'giftcard'].includes(tab) ? '' : 'none';
    const box = h('div'); body.append(box); box.appendChild(loading());
    try { await ({ promozioni, pacchetti, giftcard, fedelta, campagne })[tab](box); } catch (e) { toastErr(e); }
  }
  async function promozioni(box) {
    const list = await get('/api/admin/r/promotions');
    addBtn.onclick = () => editPromo();
    box.innerHTML = '';
    box.append(card(null, table([
      { label: 'Promozione', render: p => h('div', null, h('strong', { text: p.title }), h('div', { class: 'small muted', text: p.description || '' })) },
      { label: 'Sconto', render: p => p.kind === 'percent' ? `${+p.value}%` : euro(p.value * 100) },
      { label: 'Codice', render: p => p.code ? h('span', { class: 'kbd', text: p.code }) : '—' },
      { label: 'Validità', render: p => p.birthday ? 'Mese del compleanno' : `${p.starts_on ? fmtDate(p.starts_on) : 'sempre'} → ${p.ends_on ? fmtDate(p.ends_on) : '…'}` },
      { label: 'Su', render: p => p.service_ids.length ? `${p.service_ids.length} servizi` : 'Tutto il conto' },
      { label: 'Utilizzi', render: p => `${p.uses}${p.max_uses ? ' / ' + p.max_uses : ''}`, class: 'right' },
      { label: 'Stato', render: p => h('span', { class: `badge ${p.active ? 'ok' : ''}`, text: p.active ? (p.public ? 'Attiva · sul sito' : 'Attiva') : 'Disattiva' }) },
    ], list, { onRow: editPromo, empty: 'Nessuna promozione. Creane una: comparirà sul sito e potrà essere applicata in cassa.' })));
    function editPromo(p) {
      formModal({ title: p ? 'Modifica promozione' : 'Nuova promozione', values: p || { kind: 'percent', active: true, public: true },
        fields: [{ name: 'title', label: 'Titolo', required: true, full: true }, { name: 'description', label: 'Descrizione (sul sito)', type: 'textarea' },
          { name: 'kind', label: 'Tipo di sconto', type: 'select', empty: false, options: [['percent', 'Percentuale (%)'], ['fixed', 'Importo fisso (€)']] }, { name: 'value', label: 'Valore', type: 'number', min: 0, step: '0.5', required: true },
          { name: 'starts_on', label: 'Dal', type: 'date' }, { name: 'ends_on', label: 'Al', type: 'date' },
          { name: 'code', label: 'Codice coupon (facoltativo)', placeholder: 'ES. ESTATE20' }, { name: 'max_uses', label: 'Utilizzi massimi', type: 'number', min: 1 },
          { name: 'service_ids', label: 'Valida solo su questi servizi (nessuno = tutto il conto)', type: 'multi', options: svcOpts },
          { name: 'birthday', label: 'Promo compleanno (valida nel mese di nascita del cliente)', type: 'checkbox', full: true },
          { name: 'public', label: 'Mostra sul sito', type: 'checkbox' }, { name: 'active', label: 'Attiva', type: 'checkbox' }],
        onSave: async v => { if (p) await put(`/api/admin/r/promotions/${p.id}`, v); else await post('/api/admin/r/promotions', v); render(); },
        deleteFn: p ? async () => { await del(`/api/admin/r/promotions/${p.id}`); render(); } : null });
    }
  }
  async function pacchetti(box) {
    const list = await get('/api/admin/r/packages');
    addBtn.onclick = () => edit();
    box.innerHTML = '';
    box.append(h('p', { class: 'muted', text: 'I pacchetti si vendono in cassa: il cliente riceve le sedute, che vengono scalate automaticamente quando le usa.' }),
      card(null, table([{ label: 'Pacchetto', render: p => h('div', null, h('strong', { text: p.name }), h('div', { class: 'small muted', text: p.description || '' })) },
        { label: 'Servizio', render: p => (services.find(s => s.id === p.service_id) || {}).name || 'Qualsiasi' }, { label: 'Sedute', key: 'sessions', class: 'right' },
        { label: 'Prezzo', render: p => euro(p.price_cents), class: 'right mono' }, { label: 'Validità', render: p => p.validity_days ? `${p.validity_days} giorni` : 'Senza scadenza' },
        { label: 'Stato', render: p => h('span', { class: `badge ${p.active ? 'ok' : ''}`, text: p.active ? 'Attivo' : 'Disattivo' }) }], list, { onRow: edit, empty: 'Nessun pacchetto' })));
    function edit(p) {
      formModal({ title: p ? 'Modifica pacchetto' : 'Nuovo pacchetto', values: p || { sessions: 5, active: true, public: true },
        fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'service_id', label: 'Servizio incluso', type: 'select', options: svcOpts, emptyLabel: 'Qualsiasi servizio' },
          { name: 'sessions', label: 'Numero di sedute', type: 'number', min: 1, required: true }, { name: 'price_cents', label: 'Prezzo (€)', type: 'money', required: true },
          { name: 'validity_days', label: 'Validità (giorni)', type: 'number', min: 1 }, { name: 'description', label: 'Descrizione', type: 'textarea' },
          { name: 'public', label: 'Mostra sul sito', type: 'checkbox' }, { name: 'active', label: 'Attivo', type: 'checkbox' }],
        onSave: async v => { if (p) await put(`/api/admin/r/packages/${p.id}`, v); else await post('/api/admin/r/packages', v); render(); },
        deleteFn: p ? async () => { await del(`/api/admin/r/packages/${p.id}`); render(); } : null });
    }
  }
  async function giftcard(box) {
    const list = await get('/api/admin/r/giftcards');
    addBtn.onclick = () => formModal({ title: 'Nuova gift card (omaggio o già pagata)', size: 'narrow', values: {},
      fields: [{ name: 'initial_cents', label: 'Valore (€)', type: 'money', required: true }, { name: 'recipient_name', label: 'Intestata a' }, { name: 'expires_on', label: 'Scadenza', type: 'date' }, { name: 'message', label: 'Messaggio', type: 'textarea' }],
      extra: h('p', { class: 'small muted', text: 'Per vendere una gift card con incasso usa la Cassa → Gift card.' }),
      onSave: async v => { const g = await post('/api/admin/r/giftcards', v); toast(`Codice: ${g.code}`, 'ok'); render(); } });
    box.innerHTML = '';
    box.append(card(null, table([{ label: 'Codice', render: g => h('span', { class: 'kbd', text: g.code }) }, { label: 'Intestata a', key: 'recipient_name' },
      { label: 'Saldo', render: g => `${euro(g.balance_cents)} / ${euro(g.initial_cents)}`, class: 'mono' }, { label: 'Scadenza', render: g => g.expires_on ? fmtDate(g.expires_on) : '—' },
      { label: 'Stato', render: g => h('span', { class: `badge ${g.status === 'attiva' ? 'ok' : g.status === 'esaurita' ? '' : 'err'}`, text: g.status }) }, { label: 'Emessa', render: g => fmtDate(g.created_at) }],
    list, { onRow: g => formModal({ title: `Gift card ${g.code}`, size: 'narrow', values: g, fields: [{ name: 'recipient_name', label: 'Intestata a' }, { name: 'expires_on', label: 'Scadenza', type: 'date' },
      { name: 'status', label: 'Stato', type: 'select', empty: false, options: [['attiva', 'Attiva'], ['esaurita', 'Esaurita'], ['scaduta', 'Scaduta'], ['annullata', 'Annullata']] }, { name: 'message', label: 'Messaggio', type: 'textarea' }],
    onSave: async v => { await put(`/api/admin/r/giftcards/${g.id}`, v); render(); } }), empty: 'Nessuna gift card emessa' })));
  }
  async function fedelta(box) {
    const st = await get('/api/admin/settings');
    const l = st.settings.loyalty;
    const f = form([{ name: 'enabled', label: 'Programma fedeltà attivo', type: 'checkbox', full: true },
      { name: 'points_per_euro', label: 'Punti per ogni € speso', type: 'number', min: 0, step: '0.5' }, { name: 'euro_per_point_cents', label: 'Valore di 1 punto (centesimi di €)', type: 'number', min: 0 },
      { name: 'min_redeem_points', label: 'Punti minimi per usare lo sconto', type: 'number', min: 0 }, { name: 'birthday_points', label: 'Punti regalo al compleanno', type: 'number', min: 0 }], l);
    const ex = h('div', { class: 'alert', style: { marginTop: '12px' } });
    const upd = () => { try { const v = f.values(); ex.textContent = `Esempio: spesa di 50 € → ${Math.floor(50 * (+v.points_per_euro || 0))} punti. ${v.min_redeem_points || 0} punti valgono ${euro((+v.min_redeem_points || 0) * (+v.euro_per_point_cents || 0))} di sconto.`; } catch { /* */ } };
    f.el.addEventListener('input', upd); upd();
    const save = h('button', { class: 'btn primary' }, 'Salva');
    save.addEventListener('click', busy(save, async () => { await put('/api/admin/settings', { settings: { loyalty: f.values() } }); toast('Programma fedeltà aggiornato', 'ok'); }));
    box.innerHTML = '';
    box.append(card('Regole punti', [f.el, ex, h('div', { class: 'row end', style: { marginTop: '12px' } }, save)]),
      h('p', { class: 'small muted', style: { marginTop: '10px' }, text: 'I punti si accumulano automaticamente alla chiusura del conto (escluse le parti pagate con gift card) e si usano in cassa come sconto.' }));
  }
  async function campagne(box) {
    const prov = state.providers;
    const st = await get('/api/admin/settings');
    const ns = st.settings.notifications;
    const f = form([{ name: 'segment', label: 'Destinatari (solo clienti con consenso marketing)', type: 'select', empty: false,
      options: [['tutti', 'Tutti i clienti con consenso'], ['inattivi', `Clienti inattivi da più di ${st.settings.crm.inactive_days} giorni`], ['donna', 'Clienti donna'], ['uomo', 'Clienti uomo'], ['bambino', 'Bambini (genitori)']] },
      { name: 'title', label: 'Oggetto / titolo', required: true }, { name: 'message', label: 'Messaggio', type: 'textarea', required: true, placeholder: 'Es. questo mese il trattamento ristrutturante è scontato del 20%. Prenota online!' }], { segment: 'inattivi' });
    const send = h('button', { class: 'btn primary' }, 'Invia campagna');
    send.addEventListener('click', busy(send, async () => { const r = await post('/api/admin/notifications/campaign', f.values()); toast(`Campagna elaborata: ${r.recipients} destinatari. Dettagli in Messaggi → Registro.`, 'ok'); }));
    const ready = (ns.email_enabled && prov.email) || (ns.whatsapp_enabled && prov.whatsapp);
    box.innerHTML = '';
    box.append(h('div', { class: 'grid g2' },
      card('Nuova campagna', [!ready ? h('div', { class: 'alert warn', style: { marginBottom: '12px' } }, 'Nessun canale di invio attivo. Configura email o WhatsApp in ', h('a', { href: '#/notifiche' }, 'Messaggi'), ': fino ad allora le campagne verranno registrate come “non configurato” e non inviate.') : null,
        f.el, h('div', { class: 'row end', style: { marginTop: '12px' } }, send)]),
      card('Recupero clienti inattivi', [h('p', { class: 'muted', text: 'Trova chi non torna da tempo e contattalo personalmente o con una campagna dedicata.' }),
        h('a', { class: 'btn', href: '#/clienti' }, 'Apri elenco clienti → filtro “Inattivi”')])));
  }
  render();
}
