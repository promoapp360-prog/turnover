import { h, icon, get, post, put, del, can, euro, num, fmtDateTime, card, kpi, table, tabs, searchBox, formModal, modal, form, toast, toastErr, busy, barList, loading } from '../lib.js';

export default async function ({ content, actions }) {
  let tab = 'prodotti', q = '';
  const edit = can('inventory.manage');
  const body = h('div'); content.append(body);
  if (edit) actions.append(h('button', { class: 'btn primary', onclick: () => (tab === 'fornitori' ? editSupplier() : editProduct()) }, icon('plus'), 'Nuovo'));
  let products = [], suppliers = [], summary = null, movements = [];
  async function load() {
    body.innerHTML = ''; body.appendChild(loading());
    try {
      [products, suppliers, summary] = await Promise.all([get('/api/admin/r/products'), get('/api/admin/r/suppliers'), get('/api/admin/inventory/summary')]);
      if (tab === 'movimenti') movements = await get('/api/admin/stock/movements');
    } catch (e) { return toastErr(e); }
    render();
  }
  function render() {
    body.innerHTML = '';
    body.append(h('div', { class: 'grid g4', style: { marginBottom: '16px' } },
      kpi('Prodotti attivi', num(summary.products)), kpi('Valore a costo', euro(summary.cost_value)), kpi('Valore a listino', euro(summary.retail_value)),
      kpi('Sotto scorta', num(summary.low_count), summary.low_count ? summary.low.slice(0, 3).map(p => p.name).join(', ') : 'Tutto ok')));
    if (summary.low_count) body.append(h('div', { class: 'alert warn', style: { marginBottom: '14px' } }, h('strong', { text: 'Da riordinare: ' }), summary.low.map(p => `${p.name} (${+p.stock} ${p.unit})`).join(', ')));
    body.append(tabs([['prodotti', 'Prodotti'], ['movimenti', 'Movimenti'], ['fornitori', 'Fornitori'], ['top', 'Più venduti']], tab, async k => { tab = k; if (k === 'movimenti') { movements = await get('/api/admin/stock/movements'); } render(); }));
    if (tab === 'prodotti') {
      const list = products.filter(p => !q || `${p.name} ${p.brand || ''} ${p.sku || ''} ${p.category || ''}`.toLowerCase().includes(q.toLowerCase()));
      body.append(h('div', { style: { marginBottom: '10px' } }, searchBox('Cerca prodotto…', v => { q = v; render(); }, q)), card(null, table([
        { label: 'Prodotto', render: p => h('div', null, h('strong', { text: p.name }), h('div', { class: 'small muted', text: [p.brand, p.category, p.sku].filter(Boolean).join(' · ') })) },
        { label: 'Fornitore', render: p => (suppliers.find(s => s.id === p.supplier_id) || {}).name || '' },
        { label: 'Costo', render: p => euro(p.cost_cents), class: 'right mono' }, { label: 'Prezzo', render: p => p.retail ? euro(p.price_cents) : h('span', { class: 'muted', text: 'uso interno' }), class: 'right mono' },
        { label: 'Giacenza', render: p => h('strong', { style: { color: p.stock <= p.min_stock ? 'var(--err)' : '' }, text: `${+p.stock} ${p.unit}` }), class: 'right' },
        { label: 'Scorta min.', render: p => `${+p.min_stock}`, class: 'right' },
        { label: '', render: p => edit ? h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
          h('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); moveDialog(p, 'carico'); } }, '+ Carico'), h('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); moveDialog(p, 'uso'); } }, '− Scarico')) : '' },
      ], list, { onRow: edit ? editProduct : null, empty: 'Nessun prodotto' })));
    } else if (tab === 'movimenti') {
      const LBL = { carico: 'Carico', scarico: 'Scarico', vendita: 'Vendita', uso: 'Uso in trattamento', rettifica: 'Rettifica', reso: 'Reso/storno' };
      body.append(card(null, table([{ label: 'Data', render: m => fmtDateTime(m.created_at) }, { label: 'Prodotto', key: 'product_name' }, { label: 'Tipo', render: m => LBL[m.kind] || m.kind },
        { label: 'Quantità', render: m => h('strong', { style: { color: m.qty > 0 ? 'var(--ok)' : 'var(--err)' }, text: `${m.qty > 0 ? '+' : ''}${+m.qty} ${m.unit}` }), class: 'right' },
        { label: 'Note', key: 'note' }, { label: 'Utente', key: 'username' }], movements, { empty: 'Nessun movimento' })));
    } else if (tab === 'fornitori') {
      body.append(card(null, table([{ label: 'Fornitore', key: 'name' }, { label: 'Telefono', key: 'phone' }, { label: 'Email', key: 'email' }, { label: 'Prodotti', render: s => products.filter(p => p.supplier_id === s.id).length, class: 'right' }], suppliers, { onRow: edit ? editSupplier : null, empty: 'Nessun fornitore' })));
    } else {
      body.append(card('Prodotti più venduti (ultimi 90 giorni)', barList(summary.top, { value: i => i.qty, label: i => `${i.name} · ${euro(i.revenue)}`, format: v => `${v} pz` })));
    }
  }
  function editProduct(p) {
    formModal({ title: p ? 'Modifica prodotto' : 'Nuovo prodotto', values: p || { unit: 'pz', retail: true, active: true, min_stock: 1 },
      fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'brand', label: 'Marca' }, { name: 'category', label: 'Categoria', placeholder: 'Shampoo, colore, styling…' }, { name: 'sku', label: 'Codice / EAN' },
        { name: 'supplier_id', label: 'Fornitore', type: 'select', options: suppliers.map(s => [s.id, s.name]) }, { name: 'unit', label: 'Unità', type: 'select', empty: false, options: [['pz', 'pezzi'], ['ml', 'ml'], ['g', 'grammi'], ['tubo', 'tubi'], ['flac', 'flaconi']] },
        { name: 'cost_cents', label: 'Prezzo di acquisto (€)', type: 'money' }, { name: 'price_cents', label: 'Prezzo di vendita (€)', type: 'money' },
        p ? null : { name: 'stock', label: 'Giacenza iniziale', type: 'number', min: 0 }, { name: 'min_stock', label: 'Scorta minima (avviso)', type: 'number', min: 0 },
        { name: 'retail', label: 'In vendita al banco', type: 'checkbox' }, { name: 'active', label: 'Attivo', type: 'checkbox' }].filter(Boolean),
      onSave: async v => { if (p) await put(`/api/admin/r/products/${p.id}`, v); else await post('/api/admin/r/products', v); load(); },
      deleteFn: p ? async () => { await del(`/api/admin/r/products/${p.id}`); load(); } : null });
  }
  function editSupplier(s) {
    formModal({ title: s ? 'Modifica fornitore' : 'Nuovo fornitore', values: s || {}, fields: [{ name: 'name', label: 'Nome', required: true, full: true }, { name: 'phone', label: 'Telefono' }, { name: 'email', label: 'Email' }, { name: 'notes', label: 'Note', type: 'textarea' }],
      onSave: async v => { if (s) await put(`/api/admin/r/suppliers/${s.id}`, v); else await post('/api/admin/r/suppliers', v); load(); },
      deleteFn: s ? async () => { await del(`/api/admin/r/suppliers/${s.id}`); load(); } : null });
  }
  function moveDialog(p, kind) {
    const f = form([{ name: 'kind', label: 'Tipo', type: 'select', empty: false, options: [['carico', 'Carico (acquisto)'], ['uso', 'Uso nei trattamenti'], ['scarico', 'Scarico (rotto/scaduto)'], ['rettifica', 'Rettifica inventario (+/-)']] },
      { name: 'qty', label: `Quantità (${p.unit})`, type: 'number', required: true }, { name: 'unit_cost_euro', label: 'Costo unitario (€, solo carichi)', type: 'text' }, { name: 'note', label: 'Note', full: true }], { kind });
    const save = h('button', { class: 'btn primary' }, 'Registra');
    const m = modal({ title: `${p.name} · giacenza ${+p.stock} ${p.unit}`, body: f.el, footer: [save] });
    save.addEventListener('click', busy(save, async () => { const v = f.values(); await post('/api/admin/stock/move', { product_id: p.id, ...v, unit_cost_euro: v.unit_cost_euro ? v.unit_cost_euro.replace(',', '.') : undefined }); m.close(); toast('Movimento registrato', 'ok'); load(); }));
  }
  load();
}
