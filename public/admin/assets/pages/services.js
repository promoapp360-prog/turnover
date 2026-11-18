import { h, icon, get, post, put, del, euro, dur, table, tabs, card, formModal, toast, toastErr, invalidate, AUD, loading } from '../lib.js';

export default async function ({ content, actions }) {
  let tab = 'servizi';
  const body = h('div');
  const addBtn = h('button', { class: 'btn primary', onclick: () => (tab === 'servizi' ? editService() : editCategory()) }, icon('plus'), 'Nuovo');
  actions.append(addBtn);
  content.append(body);
  let cats = [], svcs = [];
  async function load() {
    body.innerHTML = ''; body.appendChild(loading());
    try { [cats, svcs] = await Promise.all([get('/api/admin/r/categories'), get('/api/admin/r/services')]); } catch (e) { return toastErr(e); }
    invalidate('services');
    render();
  }
  function render() {
    body.innerHTML = '';
    body.append(tabs([['servizi', 'Servizi e prezzi'], ['categorie', 'Categorie']], tab, k => { tab = k; render(); }));
    if (tab === 'categorie') {
      body.append(card(null, table([{ label: 'Categoria', key: 'name' }, { label: 'Per', render: c => AUD[c.audience] }, { label: 'Ordine', key: 'sort', class: 'right' },
        { label: 'Servizi', render: c => svcs.filter(s => s.category_id === c.id).length, class: 'right' }], cats, { onRow: editCategory })));
      return;
    }
    body.append(h('div', { class: 'alert', style: { marginBottom: '14px' } }, 'Prezzi e durate qui impostati si aggiornano subito sul sito e nel sistema di prenotazione. La ', h('strong', { text: 'posa' }), ' è il tempo in cui il cliente attende (es. colore): l’operatore resta libero per altri clienti.'));
    for (const aud of ['donna', 'uomo', 'bambino']) {
      const list = svcs.filter(s => s.audience === aud);
      if (!list.length) continue;
      body.append(h('div', { style: { marginBottom: '16px' } }, card(AUD[aud], table([
        { label: 'Servizio', render: s => h('div', null, h('strong', { text: s.name }), h('div', { class: 'small muted', text: (cats.find(c => c.id === s.category_id) || {}).name || '' })) },
        { label: 'Prezzo', render: s => (s.price_from ? 'da ' : '') + euro(s.price_cents), class: 'right mono' },
        { label: 'Durata', render: s => dur(s.duration_min) },
        { label: 'Posa', render: s => s.processing_min ? `${s.processing_min} min (dopo ${s.processing_start_min})` : '—' },
        { label: 'Pausa dopo', render: s => s.buffer_min ? `${s.buffer_min} min` : '—' },
        { label: 'Online', render: s => h('span', { class: `badge ${s.online_bookable ? 'ok' : ''}`, text: s.online_bookable ? 'Sì' : 'No' }) },
        { label: 'Stato', render: s => h('span', { class: `badge ${s.active ? 'ok' : 'err'}`, text: s.active ? 'Attivo' : 'Disattivo' }) },
      ], list, { onRow: editService }))));
    }
    if (!svcs.length) body.append(h('div', { class: 'card empty', text: 'Nessun servizio: crea il primo con “Nuovo”.' }));
  }
  function editService(s) {
    formModal({ title: s ? 'Modifica servizio' : 'Nuovo servizio', values: s || { audience: 'donna', active: true, online_bookable: true, duration_min: 30, processing_min: 0, processing_start_min: 0, buffer_min: 0 },
      fields: [
        { name: 'name', label: 'Nome', required: true }, { name: 'audience', label: 'Per', type: 'select', options: Object.entries(AUD), empty: false, required: true },
        { name: 'category_id', label: 'Categoria', type: 'select', options: cats.map(c => [c.id, `${c.name} (${AUD[c.audience]})`]) },
        { name: 'price_cents', label: 'Prezzo (€)', type: 'money', required: true }, { name: 'price_from', label: 'Mostra come “da …” (prezzo minimo)', type: 'checkbox' },
        { name: 'duration_min', label: 'Durata totale (min)', type: 'number', min: 5, max: 600, step: 5, required: true },
        { name: 'processing_start_min', label: 'Posa: inizia dopo (min)', type: 'number', min: 0, step: 5, hint: 'Minuti di lavoro prima della posa' },
        { name: 'processing_min', label: 'Durata posa (min)', type: 'number', min: 0, step: 5, hint: 'L’operatore è libero durante la posa' },
        { name: 'buffer_min', label: 'Pausa/pulizia dopo (min)', type: 'number', min: 0, step: 5 }, { name: 'sort', label: 'Ordine', type: 'number' },
        { name: 'description', label: 'Descrizione (visibile sul sito)', type: 'textarea' },
        { name: 'online_bookable', label: 'Prenotabile online', type: 'checkbox' }, { name: 'active', label: 'Attivo', type: 'checkbox' }],
      onSave: async v => { if (s) await put(`/api/admin/r/services/${s.id}`, v); else await post('/api/admin/r/services', v); load(); },
      deleteFn: s ? async () => { await del(`/api/admin/r/services/${s.id}`); load(); } : null });
  }
  function editCategory(c) {
    formModal({ title: c ? 'Modifica categoria' : 'Nuova categoria', size: 'narrow', values: c || { audience: 'donna' },
      fields: [{ name: 'name', label: 'Nome', required: true, full: true }, { name: 'audience', label: 'Per', type: 'select', options: Object.entries(AUD), empty: false }, { name: 'sort', label: 'Ordine', type: 'number' }],
      onSave: async v => { if (c) await put(`/api/admin/r/categories/${c.id}`, v); else await post('/api/admin/r/categories', v); load(); },
      deleteFn: c ? async () => { await del(`/api/admin/r/categories/${c.id}`); load(); } : null });
  }
  load();
}
