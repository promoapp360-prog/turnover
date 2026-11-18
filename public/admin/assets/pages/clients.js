import { h, icon, get, post, put, del, can, euro, num, fmtDate, fmtDateTime, fullName, statusBadge, table, searchBox, tabs, card, kpi, form, formModal, modal, toast, toastErr, confirmDialog, promptDialog, busy, button, download, uploadImage, AUD, loading, state } from '../lib.js';

const FIELDS = [
  { name: 'first_name', label: 'Nome', required: true }, { name: 'last_name', label: 'Cognome' },
  { name: 'phone', label: 'Telefono', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
  { name: 'birth_date', label: 'Data di nascita (facoltativa)', type: 'date' }, { name: 'audience', label: 'Categoria', type: 'select', options: Object.entries(AUD) },
  { name: 'preferences', label: 'Preferenze', type: 'textarea', rows: 2, placeholder: 'Es. preferisce il pomeriggio, piega mossa, caffè senza zucchero…' },
  { name: 'notes', label: 'Note importanti (visibili in agenda)', type: 'textarea', rows: 2, placeholder: 'Es. allergie a prodotti, cuoio capelluto sensibile' },
  { type: 'section', label: 'Consensi privacy' },
  { name: 'consent_privacy', label: 'Informativa privacy accettata', type: 'checkbox', full: true },
  { name: 'consent_marketing', label: 'Consenso a comunicazioni promozionali e auguri', type: 'checkbox', full: true },
  { name: 'consent_photos', label: 'Consenso a fotografie prima/dopo', type: 'checkbox', full: true },
];

export default async function (ui) {
  if (ui.params[0]) return detail(ui, +ui.params[0]);
  return list(ui);
}

async function list({ content, actions }) {
  const S = { q: '', filter: '', audience: '', offset: 0 };
  if (can('clients.edit')) actions.append(h('button', { class: 'btn primary', onclick: () => formModal({ title: 'Nuovo cliente', fields: FIELDS, values: { consent_privacy: true },
    onSave: async v => { const c = await post('/api/admin/customers', v); location.hash = `#/clienti/${c.id}`; } }) }, icon('plus'), 'Nuovo cliente'));
  if (can('clients.export')) actions.append(button([icon('download'), 'Esporta CSV'], () => download('/api/admin/customers-export.csv', 'clienti.csv')));
  const audSel = h('select', { style: { width: 'auto' }, onchange: () => { S.audience = audSel.value; S.offset = 0; load(); } }, h('option', { value: '' }, 'Tutte le categorie'), Object.entries(AUD).map(([k, v]) => h('option', { value: k }, v)));
  const tabsBox = h('div');
  const res = h('div');
  content.append(h('div', { class: 'row', style: { marginBottom: '12px' } }, searchBox('Cerca per nome, telefono, email…', q => { S.q = q; S.offset = 0; load(); }), audSel), tabsBox, card(null, res));
  const FILTERS = [['', 'Tutti'], ['inactive', `Non tornano da ${state.tenant.modules ? '' : ''}tempo`], ['never', 'Mai venuti'], ['new', 'Nuovi (30 gg)'], ['birthday', 'Compleanno nel mese'], ['marketing', 'Con consenso marketing']];
  function drawTabs() { tabsBox.innerHTML = ''; tabsBox.append(tabs(FILTERS.map(([k, l]) => [k, k === 'inactive' ? 'Inattivi' : l]), S.filter, k => { S.filter = k; S.offset = 0; drawTabs(); load(); })); }
  drawTabs();
  async function load() {
    res.innerHTML = ''; res.appendChild(loading());
    try {
      const r = await get(`/api/admin/customers?${new URLSearchParams({ q: S.q, filter: S.filter, audience: S.audience, offset: S.offset, limit: 100 })}`);
      res.innerHTML = '';
      res.append(h('div', { class: 'small muted', style: { marginBottom: '8px' }, text: `${num(r.total)} clienti` }),
        table([
          { label: 'Cliente', render: c => h('div', null, h('strong', { text: fullName(c) }), c.notes ? h('div', { class: 'small', style: { color: 'var(--warn)' }, text: '⚠ ' + c.notes.slice(0, 60) }) : null) },
          { label: 'Contatti', render: c => h('div', { class: 'small' }, c.phone || '', c.email ? h('div', { class: 'muted', text: c.email }) : null) },
          { label: 'Categoria', render: c => c.audience ? AUD[c.audience] : '' },
          { label: 'Visite', key: 'visits', class: 'right mono' },
          { label: 'Speso', render: c => euro(c.spent_cents), class: 'right mono' },
          { label: 'Ultima visita', render: c => c.last_visit_at ? fmtDate(c.last_visit_at) : h('span', { class: 'muted', text: 'mai' }) },
          { label: 'Prossimo', render: c => c.next_appointment ? fmtDateTime(c.next_appointment) : '' },
          { label: 'Punti', key: 'points', class: 'right mono' },
        ], r.rows, { onRow: c => { location.hash = `#/clienti/${c.id}`; }, empty: 'Nessun cliente trovato' }),
        r.total > 100 ? h('div', { class: 'row end', style: { marginTop: '10px' } },
          h('button', { class: 'btn sm', disabled: S.offset === 0, onclick: () => { S.offset -= 100; load(); } }, '← Precedenti'),
          h('span', { class: 'small muted', text: `${S.offset + 1}–${Math.min(S.offset + 100, r.total)}` }),
          h('button', { class: 'btn sm', disabled: S.offset + 100 >= r.total, onclick: () => { S.offset += 100; load(); } }, 'Successivi →')) : null);
    } catch (e) { res.innerHTML = ''; toastErr(e); }
  }
  load();
}

async function detail({ content, actions, setTitle }, id) {
  let tab = 'profilo';
  let D;
  const body = h('div');
  actions.append(h('a', { class: 'btn', href: '#/clienti' }, '← Clienti'));
  content.append(body);
  async function load() {
    body.innerHTML = ''; body.appendChild(loading());
    try { D = await get(`/api/admin/customers/${id}`); } catch (e) { body.innerHTML = ''; return toastErr(e); }
    setTitle(fullName(D.customer));
    render();
  }
  function render() {
    const c = D.customer;
    body.innerHTML = '';
    body.append(
      h('div', { class: 'grid g4', style: { marginBottom: '16px' } },
        h('div', { class: 'card kpi' }, h('div', { class: 'lbl', text: 'Contatti' }), h('div', { style: { fontWeight: 600, marginTop: '6px' }, text: c.phone || '—' }), h('div', { class: 'small muted', text: c.email || '' }),
          h('div', { class: 'row', style: { marginTop: '8px' } }, c.phone ? h('a', { class: 'btn sm', href: `tel:${c.phone}` }, icon('phone')) : null,
            c.phone ? h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: `https://wa.me/${c.phone.replace(/[^\d]/g, '').replace(/^(?!39)/, '39')}` }, icon('whatsapp')) : null,
            can('agenda.edit') ? h('a', { class: 'btn sm primary', href: '#/agenda' }, icon('calendar'), 'Prenota') : null)),
        kpi('Visite completate', num(c.visits), D.avg_days_between_visits ? `ogni ~${D.avg_days_between_visits} giorni` : ''),
        kpi('Totale speso', euro(c.spent_cents), c.last_visit_at ? `ultima visita ${fmtDate(c.last_visit_at)}` : 'nessuna visita'),
        kpi('Punti fedeltà', num(c.points), c.next_appointment ? `prossimo: ${fmtDateTime(c.next_appointment)}` : '')),
      c.anonymized ? h('div', { class: 'alert warn', style: { marginBottom: '12px' }, text: 'Cliente anonimizzato (diritto all’oblio GDPR): i dati personali sono stati cancellati.' }) : null,
      tabs([['profilo', 'Profilo'], ['storico', `Appuntamenti (${D.appointments.length})`], ['tecnica', `Schede tecniche (${D.notes.length})`], ['foto', `Foto (${D.photos.length})`],
        ['acquisti', 'Acquisti e pacchetti'], ['punti', 'Fedeltà'], can('clients.export') ? ['gdpr', 'Privacy / GDPR'] : null].filter(Boolean), tab, k => { tab = k; render(); }),
      ({ profilo, storico, tecnica, foto, acquisti, punti, gdpr })[tab]());
  }
  function profilo() {
    const f = form(FIELDS, D.customer);
    const save = h('button', { class: 'btn primary' }, 'Salva modifiche');
    save.addEventListener('click', busy(save, async () => { await put(`/api/admin/customers/${id}`, f.values()); toast('Cliente aggiornato', 'ok'); load(); }));
    const c = D.customer;
    return card('Dati anagrafici', [f.el, h('div', { class: 'row between', style: { marginTop: '14px' } },
      h('span', { class: 'small muted', text: `Cliente dal ${fmtDate(c.created_at)}${c.consent_updated_at ? ' · consensi aggiornati il ' + fmtDateTime(c.consent_updated_at) : ''}` }), can('clients.edit') ? save : null)]);
  }
  function storico() {
    return card(null, table([
      { label: 'Data', render: a => fmtDateTime(a.starts_at) }, { label: 'Servizi', key: 'services' }, { label: 'Operatore', key: 'staff_name' },
      { label: 'Stato', render: a => statusBadge(a.status) }, { label: 'Importo', render: a => euro(a.total_cents), class: 'right mono' },
      { label: 'Note', render: a => h('span', { class: 'small muted', text: [a.customer_notes, a.internal_notes].filter(Boolean).join(' · ') }) },
    ], D.appointments, { empty: 'Nessun appuntamento' }));
  }
  function tecnica() {
    const kind = h('select', { style: { width: 'auto' } }, [['formula', 'Formula colore'], ['tecnica', 'Annotazione tecnica'], ['prodotti', 'Prodotti utilizzati'], ['nota', 'Nota']].map(([v, l]) => h('option', { value: v }, l)));
    const txt = h('textarea', { rows: 3, placeholder: 'Es. 6.0 + 7.3 (1:1) ossigeno 20 vol, posa 35 min. Radici: 30g…' });
    const add = h('button', { class: 'btn primary' }, 'Aggiungi');
    add.addEventListener('click', busy(add, async () => { await post(`/api/admin/customers/${id}/notes`, { kind: kind.value, body: txt.value }); toast('Salvato', 'ok'); load(); }));
    const LBL = { formula: 'Formula colore', tecnica: 'Tecnica', prodotti: 'Prodotti', nota: 'Nota' };
    return h('div', { class: 'grid g2' },
      can('clients.edit') || can('clients.notes') ? card('Nuova annotazione', h('div', { class: 'stack' }, kind, txt, h('div', { class: 'row end' }, add))) : null,
      card('Storico schede tecniche', D.notes.length ? h('div', null, D.notes.map(n => h('div', { class: 'list-row' }, h('div', { class: 'grow' },
        h('div', { class: 'row' }, h('span', { class: `badge ${n.kind === 'formula' ? 'info' : ''}`, text: LBL[n.kind] }), h('span', { class: 'small muted', text: `${fmtDateTime(n.created_at)} · ${n.staff_name || n.username || ''}` })),
        h('div', { style: { whiteSpace: 'pre-wrap', marginTop: '6px' }, text: n.body })),
        can('clients.edit') ? h('button', { class: 'btn sm ghost', 'aria-label': 'Elimina', onclick: async () => { if (await confirmDialog('Eliminare questa annotazione?', { danger: true })) { await del(`/api/admin/customers/${id}/notes/${n.id}`); load(); } } }, icon('trash')) : null))) : h('div', { class: 'empty', text: 'Nessuna annotazione' })));
  }
  function foto() {
    const c = D.customer;
    const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
    const lbl = h('select', { style: { width: 'auto' } }, ['Prima', 'Dopo', 'Altro'].map(x => h('option', { value: x }, x)));
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      try { const m = await uploadImage(file.files[0], true); await post(`/api/admin/customers/${id}/photos`, { media_id: m.id, label: lbl.value }); toast('Foto salvata', 'ok'); load(); } catch (e) { toastErr(e); }
    });
    return card('Foto prima / dopo', [
      !c.consent_photos ? h('div', { class: 'alert warn', text: 'Per salvare fotografie serve il consenso del cliente: registralo nel Profilo.' }) :
        h('div', { class: 'row', style: { marginBottom: '12px' } }, lbl, h('button', { class: 'btn primary', onclick: () => file.click() }, icon('plus'), 'Aggiungi foto'), file),
      D.photos.length ? h('div', { class: 'photo-grid' }, D.photos.map(p => h('figure', { style: { margin: 0 } }, h('img', { src: `/api/media/${p.media_id}`, alt: p.label || '' }),
        h('figcaption', { class: 'row between small' }, h('span', { text: `${p.label || ''} · ${fmtDate(p.created_at)}` }),
          can('clients.edit') ? h('button', { class: 'btn sm ghost', onclick: async () => { if (await confirmDialog('Eliminare la foto?', { danger: true })) { await del(`/api/admin/customers/${id}/photos/${p.id}`); load(); } } }, icon('trash')) : null)))) : h('div', { class: 'empty', text: 'Nessuna foto' })]);
  }
  function acquisti() {
    return h('div', { class: 'stack' },
      card('Pacchetti', table([{ label: 'Pacchetto', key: 'name' }, { label: 'Sedute', render: p => `${p.sessions_used} / ${p.sessions_total}` }, { label: 'Scadenza', render: p => p.expires_on ? fmtDate(p.expires_on) : '—' }, { label: 'Acquistato', render: p => fmtDate(p.created_at) }], D.packages, { empty: 'Nessun pacchetto' })),
      card('Gift card', table([{ label: 'Codice', render: g => h('span', { class: 'kbd', text: g.code }) }, { label: 'Saldo', render: g => `${euro(g.balance_cents)} / ${euro(g.initial_cents)}` }, { label: 'Stato', key: 'status' }, { label: 'Scadenza', render: g => g.expires_on ? fmtDate(g.expires_on) : '—' }], D.giftcards, { empty: 'Nessuna gift card' })),
      can('cash.use') || can('cash.reports') ? card('Acquisti', table([{ label: 'Data', render: s => fmtDateTime(s.closed_at) }, { label: 'Dettaglio', key: 'items' }, { label: 'Promo', key: 'promo' }, { label: 'Sconto', render: s => s.discount_cents ? euro(s.discount_cents) : '', class: 'right' }, { label: 'Totale', render: s => euro(s.total_cents), class: 'right mono' }], D.sales, { empty: 'Nessun acquisto registrato' })) : null);
  }
  function punti() {
    return card(`Saldo: ${num(D.customer.points)} punti`, table([{ label: 'Data', render: l => fmtDateTime(l.created_at) }, { label: 'Motivo', key: 'reason' }, { label: 'Punti', render: l => h('strong', { style: { color: l.points >= 0 ? 'var(--ok)' : 'var(--err)' }, text: (l.points > 0 ? '+' : '') + l.points }), class: 'right' }], D.ledger, { empty: 'Nessun movimento' }),
      can('marketing.manage') ? h('button', { class: 'btn sm', onclick: async () => {
        const p = await promptDialog('Rettifica punti', 'Punti da aggiungere (usa il segno meno per togliere)', '10'); if (p === null) return;
        const r = await promptDialog('Rettifica punti', 'Motivo', 'Rettifica manuale'); if (r === null) return;
        try { await post(`/api/admin/customers/${id}/points`, { points: parseInt(p, 10), reason: r }); toast('Punti aggiornati', 'ok'); load(); } catch (e) { toastErr(e); }
      } }, 'Rettifica punti') : null);
  }
  function gdpr() {
    return h('div', { class: 'grid g2' },
      card('Diritto di accesso e portabilità', [h('p', { class: 'muted', text: 'Scarica tutti i dati personali del cliente in formato leggibile (JSON) da consegnare su richiesta.' }),
        button([icon('download'), 'Esporta dati del cliente'], () => download(`/api/admin/customers/${id}/gdpr-export`, `dati-cliente-${id}.json`))]),
      card('Diritto all’oblio', [h('p', { class: 'muted', text: 'Cancella nome, contatti, note, foto e preferenze. Restano solo i dati contabili anonimi richiesti dalla legge.' }),
        h('button', { class: 'btn danger', disabled: D.customer.anonymized, onclick: async () => {
          if (!(await confirmDialog('Anonimizzare definitivamente il cliente? L’operazione non è reversibile.', { danger: true, ok: 'Anonimizza' }))) return;
          try { await post(`/api/admin/customers/${id}/anonymize`); toast('Cliente anonimizzato', 'ok'); load(); } catch (e) { toastErr(e); }
        } }, 'Anonimizza cliente'),
        h('button', { class: 'btn', style: { marginLeft: '8px' }, onclick: async () => {
          if (!(await confirmDialog('Eliminare il cliente? Possibile solo se non ha movimenti di cassa.', { danger: true, ok: 'Elimina' }))) return;
          try { await del(`/api/admin/customers/${id}`); toast('Cliente eliminato'); location.hash = '#/clienti'; } catch (e) { toastErr(e); }
        } }, 'Elimina')]),
      card('Unisci duplicato', [h('p', { class: 'muted', text: 'Se lo stesso cliente è registrato due volte, unisci lo storico in questa scheda.' }), h('button', { class: 'btn', onclick: mergeDialog }, 'Cerca duplicato')]));
  }
  function mergeDialog() {
    const res = h('div');
    const m = modal({ title: 'Unisci cliente duplicato', body: [searchBox('Cerca il duplicato…', async q => {
      res.innerHTML = ''; if (q.length < 2) return;
      const r = await get(`/api/admin/customers?q=${encodeURIComponent(q)}&limit=10`);
      r.rows.filter(c => c.id !== id).forEach(c => res.append(h('div', { class: 'list-row' }, h('div', { class: 'grow' }, h('strong', { text: fullName(c) }), h('div', { class: 'small muted', text: [c.phone, c.email].filter(Boolean).join(' · ') })),
        h('button', { class: 'btn sm primary', onclick: async () => { if (!(await confirmDialog(`Unire ${fullName(c)} in questa scheda? Il duplicato verrà eliminato.`))) return; try { await post(`/api/admin/customers/${id}/merge`, { merge_id: c.id }); m.close(); toast('Clienti uniti', 'ok'); load(); } catch (e) { toastErr(e); } } }, 'Unisci'))));
    }), res] });
  }
  load();
}
