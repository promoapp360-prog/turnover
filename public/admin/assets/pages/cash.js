import { h, icon, get, post, put, del, can, state, euro, euroIn, fmtDateTime, fmtTime, fullName, card, kpi, table, tabs, modal, form, formModal, toast, toastErr, confirmDialog, busy, button, cached, loading, today } from '../lib.js';

const METHODS = [['contanti', 'Contanti'], ['carta', 'Carta di credito'], ['bancomat', 'Bancomat'], ['satispay', 'Satispay'], ['bonifico', 'Bonifico'], ['giftcard', 'Gift card'], ['altro', 'Altro']];
const MLBL = Object.fromEntries(METHODS);

export default async function (ui) {
  if (ui.params[0]) return saleEditor(ui, +ui.params[0]);
  return overview(ui);
}

async function overview({ content, actions }) {
  actions.append(h('button', { class: 'btn primary', onclick: async () => { try { const s = await post('/api/admin/sales', {}); location.hash = `#/cassa/${s.id}`; } catch (e) { toastErr(e); } } }, icon('plus'), 'Nuovo conto'));
  if (can('cash.reports')) actions.append(h('button', { class: 'btn', onclick: expenseDialog }, 'Registra spesa'));
  const body = h('div'); content.append(body);
  async function load() {
    body.innerHTML = ''; body.appendChild(loading());
    let d; try { d = await get('/api/admin/cash/session'); } catch (e) { body.innerHTML = ''; return toastErr(e); }
    body.innerHTML = '';
    const s = d.session;
    body.append(h('div', { class: 'alert', style: { marginBottom: '14px' } }, 'La cassa registra gli incassi a fini gestionali. ', h('strong', { text: 'Non emette scontrini o documenti fiscali' }), ': continua a usare il registratore telematico (integrazione certificata prevista in futuro).'));
    if (!s) {
      const amt = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', style: { width: '140px' } });
      const b = button('Apri cassa', async () => { await post('/api/admin/cash/open', { opening: amt.value.replace(',', '.') || 0 }); toast('Cassa aperta', 'ok'); load(); }, 'btn primary');
      body.append(card('Cassa chiusa', h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', { text: 'Fondo cassa iniziale (€)' }), amt), b)));
    } else {
      const sum = d.summary;
      body.append(h('div', { class: 'grid g4' },
        kpi('Cassa aperta', fmtTime(s.opened_at), `da ${s.opened_by_name || ''} · fondo ${euro(s.opening_cents)}`),
        kpi('Incassato', euro(sum.total_cents), `${sum.sales} conti chiusi`),
        kpi('Contanti', euro((sum.by_method.find(m => m.method === 'contanti') || {}).total || 0)),
        kpi('Elettronico', euro(sum.by_method.filter(m => m.method !== 'contanti').reduce((a, m) => a + m.total, 0)), sum.by_method.filter(m => m.method !== 'contanti').map(m => `${MLBL[m.method] || m.method} ${euro(m.total)}`).join(' · '))),
      h('div', { class: 'row end', style: { margin: '12px 0' } }, h('button', { class: 'btn', onclick: () => closeDialog(s) }, 'Chiusura cassa')));
    }
    body.append(h('div', { class: 'grid g2' },
      card('Conti aperti', table([{ label: 'Aperto', render: x => fmtTime(x.created_at) }, { label: 'Cliente', render: x => x.first_name ? fullName(x) : h('span', { class: 'muted', text: 'Cliente occasionale' }) },
        { label: 'Totale', render: x => euro(x.total_cents), class: 'right mono' }], d.open_sales, { onRow: x => { location.hash = `#/cassa/${x.id}`; }, empty: 'Nessun conto aperto' })),
      card('Incassi di oggi', table([{ label: 'Ora', render: x => fmtTime(x.closed_at) }, { label: 'Cliente', render: x => x.first_name ? fullName(x) : '—' }, { label: 'Pagamento', render: x => (x.methods || '').split(', ').map(m => MLBL[m] || m).join(', ') },
        { label: 'Totale', render: x => euro(x.total_cents), class: 'right mono' }], d.closed_today, { onRow: x => { location.hash = `#/cassa/${x.id}`; }, empty: 'Nessun incasso oggi' }))));
  }
  function closeDialog(s) {
    const counted = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00' });
    const notes = h('textarea', { rows: 2 });
    const b = h('button', { class: 'btn primary' }, 'Chiudi cassa');
    const m = modal({ title: 'Chiusura cassa', size: 'narrow', body: h('div', { class: 'stack' }, h('label', { class: 'field' }, h('span', { text: 'Contanti contati nel cassetto (€)' }), counted), h('label', { class: 'field' }, h('span', { text: 'Note' }), notes)), footer: [b] });
    b.addEventListener('click', busy(b, async () => {
      const r = await post('/api/admin/cash/close', { counted: counted.value.replace(',', '.'), notes: notes.value });
      m.close();
      const diff = r.difference_cents;
      modal({ title: 'Cassa chiusa', size: 'narrow', body: h('div', { class: 'stack' }, h('div', { class: 'row between' }, 'Atteso in contanti', h('strong', { text: euro(r.session.expected_cents) })),
        h('div', { class: 'row between' }, 'Contato', h('strong', { text: euro(r.session.counted_cents) })),
        h('div', { class: `alert ${diff === 0 ? 'ok' : 'warn'}`, text: diff === 0 ? 'Cassa quadrata ✓' : `Differenza: ${euro(diff)}` }),
        h('div', { class: 'row between' }, 'Totale incassato', h('strong', { text: euro(r.summary.total_cents) }))) });
      load();
    }));
  }
  load();
  const onCash = () => load();
  window.addEventListener('pa:cash', onCash);
  return { destroy: () => window.removeEventListener('pa:cash', onCash) };
}

function expenseDialog() {
  formModal({ title: 'Registra spesa', fields: [
    { name: 'spent_on', label: 'Data', type: 'date', required: true }, { name: 'amount_cents', label: 'Importo (€)', type: 'money', required: true },
    { name: 'category', label: 'Categoria', type: 'select', empty: false, options: ['prodotti', 'affitto', 'utenze', 'personale', 'attrezzature', 'marketing', 'tasse', 'altro'].map(x => [x, x[0].toUpperCase() + x.slice(1)]) },
    { name: 'method', label: 'Pagata con', type: 'select', options: METHODS.filter(m => m[0] !== 'giftcard') }, { name: 'description', label: 'Descrizione', required: true, full: true }],
  values: { spent_on: today(), category: 'prodotti' }, onSave: v => post('/api/admin/r/expenses', v) });
}

async function saleEditor({ content, actions, setTitle }, id) {
  actions.append(h('a', { class: 'btn', href: '#/cassa' }, '← Cassa'));
  const [services, products, packages, staff] = await Promise.all([
    cached('services', '/api/admin/r/services?active=1'), get('/api/admin/r/products?active=1').catch(() => []), get('/api/admin/r/packages?active=1').catch(() => []), cached('staff', '/api/admin/staff')]);
  let S; let addTab = 'servizio';
  const body = h('div'); content.append(body);
  async function load() { try { S = await get(`/api/admin/sales/${id}`); setTitle(`Conto #${id}`); render(); } catch (e) { toastErr(e); } }
  async function act(fn) { try { S = await fn(); render(); } catch (e) { toastErr(e); } }
  function render() {
    body.innerHTML = '';
    const open = S.status === 'aperta';
    // --- colonna sinistra: voci e aggiunta
    const left = h('div', { class: 'stack' });
    const custRow = h('div', { class: 'row between' }, h('div', null, h('div', { class: 'small muted', text: 'Cliente' }), h('strong', { text: S.customer_id ? fullName(S) : 'Cliente occasionale' }),
      S.customer_id && state.tenant.modules.loyalty !== false ? h('span', { class: 'badge', style: { marginLeft: '8px' }, text: `${S.customer_points} punti` }) : null),
      open ? h('button', { class: 'btn sm', onclick: pickCustomer }, S.customer_id ? 'Cambia' : 'Associa cliente') : null);
    left.append(card(null, custRow));
    left.append(card('Voci del conto', S.items.length ? h('div', null, S.items.map(it => h('div', { class: 'line-item' },
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 }, text: it.name }), h('div', { class: 'small muted', text: `${+it.qty} × ${euro(it.unit_cents)}${it.discount_cents ? ' − ' + euro(it.discount_cents) : ''}${it.staff_name ? ' · ' + it.staff_name : ''}` })),
      h('strong', { class: 'mono', text: euro(it.total_cents) }),
      open ? h('button', { class: 'btn sm ghost', 'aria-label': 'Rimuovi', onclick: () => act(() => del(`/api/admin/sales/${id}/items/${it.id}`)) }, icon('trash')) : null))) : h('div', { class: 'empty', text: 'Aggiungi servizi o prodotti' })));
    if (open) {
      const pick = h('div');
      const drawPick = () => {
        pick.innerHTML = '';
        const staffSel = h('select', { style: { width: 'auto' } }, h('option', { value: '' }, 'Operatore: nessuno'), staff.map(s => h('option', { value: s.id }, s.name)));
        if (S.appointment_id && S.items[0] && S.items[0].staff_id) staffSel.value = S.items[0].staff_id;
        const add = body => act(() => post(`/api/admin/sales/${id}/items`, { ...body, staff_id: staffSel.value || null }));
        let grid;
        if (addTab === 'servizio') grid = h('div', { class: 'pick-grid' }, services.map(s => h('button', { class: 'pick', onclick: () => usePackageOr(s, add) }, s.name, h('small', { text: euro(s.price_cents) }))));
        else if (addTab === 'prodotto') grid = products.filter(p => p.retail).length ? h('div', { class: 'pick-grid' }, products.filter(p => p.retail).map(p => h('button', { class: 'pick', onclick: () => add({ kind: 'prodotto', ref_id: p.id, qty: 1 }) }, p.name, h('small', { text: `${euro(p.price_cents)} · disp. ${+p.stock}` })))) : h('div', { class: 'empty', text: 'Nessun prodotto in vendita: aggiungili in Magazzino' });
        else if (addTab === 'pacchetto') grid = packages.length ? h('div', { class: 'pick-grid' }, packages.map(p => h('button', { class: 'pick', onclick: () => add({ kind: 'pacchetto', ref_id: p.id }) }, p.name, h('small', { text: `${euro(p.price_cents)} · ${p.sessions} sedute` })))) : h('div', { class: 'empty', text: 'Nessun pacchetto: creali in Promo e fedeltà' });
        else {
          const amt = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Importo €', style: { width: '140px' } });
          grid = h('div', { class: 'row' }, [25, 50, 100].map(v => h('button', { class: 'btn', onclick: () => add({ kind: 'giftcard', unit_euro: v }) }, euro(v * 100))), amt, h('button', { class: 'btn primary', onclick: () => add({ kind: 'giftcard', unit_euro: amt.value.replace(',', '.') }) }, 'Aggiungi'));
        }
        pick.append(h('div', { class: 'row between', style: { marginBottom: '10px' } }, tabs([['servizio', 'Servizi'], ['prodotto', 'Prodotti'], ['pacchetto', 'Pacchetti'], ['giftcard', 'Gift card']], addTab, k => { addTab = k; drawPick(); }), staffSel), grid);
      };
      drawPick();
      left.append(card('Aggiungi', pick));
    }
    // --- colonna destra: totali e pagamento
    const right = h('div', { class: 'stack' });
    const tot = h('div', null,
      h('div', { class: 'total-row' }, h('span', { text: 'Subtotale' }), h('span', { class: 'mono', text: euro(S.subtotal_cents) })),
      S.promo_discount_cents ? h('div', { class: 'total-row' }, h('span', { text: `Promozione: ${S.promo_title}` }), h('span', { class: 'mono', text: '− ' + euro(S.promo_discount_cents) })) : null,
      S.discount_cents ? h('div', { class: 'total-row' }, h('span', { text: 'Sconto' }), h('span', { class: 'mono', text: '− ' + euro(S.discount_cents) })) : null,
      S.points_value_cents ? h('div', { class: 'total-row' }, h('span', { text: `Sconto fedeltà (${S.points_redeemed} punti)` }), h('span', { class: 'mono', text: '− ' + euro(S.points_value_cents) })) : null,
      h('div', { class: 'total-row big' }, h('span', { text: 'Totale' }), h('span', { class: 'mono', text: euro(S.total_cents) })));
    right.append(card(open ? 'Totale' : `Conto ${S.status}`, tot));
    if (open) {
      const disc = h('input', { type: 'text', inputmode: 'decimal', value: S.discount_cents ? euroIn(S.discount_cents) : '', placeholder: '0,00' });
      const code = h('input', { type: 'text', value: S.promo_code || '', placeholder: 'Codice promo' });
      const pts = h('input', { type: 'number', min: 0, value: S.points_redeemed || '', placeholder: `min ${S.loyalty.min_redeem_points}` });
      right.append(card('Sconti', h('div', { class: 'stack' },
        h('div', { class: 'row' }, h('label', { class: 'field', style: { flex: 1 } }, h('span', { text: 'Sconto manuale (€)' }), disc), h('button', { class: 'btn', style: { alignSelf: 'flex-end' }, onclick: () => act(() => put(`/api/admin/sales/${id}`, { discount_euro: disc.value.replace(',', '.') || 0 })) }, 'Applica')),
        h('div', { class: 'row' }, h('label', { class: 'field', style: { flex: 1 } }, h('span', { text: 'Promozione' }), code), h('button', { class: 'btn', style: { alignSelf: 'flex-end' }, onclick: () => act(() => put(`/api/admin/sales/${id}`, { promotion_code: code.value.trim() || null })) }, code.value ? 'Applica' : 'Applica')),
        S.customer_id && S.loyalty.enabled ? h('div', { class: 'row' }, h('label', { class: 'field', style: { flex: 1 } }, h('span', { text: `Usa punti (1 punto = ${euro(S.loyalty.euro_per_point_cents)})` }), pts), h('button', { class: 'btn', style: { alignSelf: 'flex-end' }, onclick: () => act(() => put(`/api/admin/sales/${id}`, { points_redeemed: +pts.value || 0 })) }, 'Applica')) : null)));
      // pagamenti
      const rows = h('div', { class: 'stack' });
      const addRow = (method = 'contanti', amount = '') => {
        const m = h('select', { style: { flex: 1 } }, METHODS.map(([v, l]) => h('option', { value: v }, l))); m.value = method;
        const a = h('input', { type: 'text', inputmode: 'decimal', value: amount, placeholder: '0,00', style: { width: '110px' } });
        const ref = h('input', { type: 'text', placeholder: 'Codice gift card', style: { display: method === 'giftcard' ? 'block' : 'none' } });
        m.addEventListener('change', () => { ref.style.display = m.value === 'giftcard' ? 'block' : 'none'; });
        const row = h('div', { class: 'stack', style: { gap: '6px' } }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, m, a, h('button', { class: 'btn sm ghost', onclick: () => { row.remove(); } }, icon('x'))), ref);
        row.read = () => ({ method: m.value, amount_euro: a.value.replace(',', '.'), ref: ref.value.trim() });
        rows.appendChild(row);
      };
      addRow('contanti', euroIn(S.total_cents));
      const closeBtn = h('button', { class: 'btn primary', style: { width: '100%', padding: '12px', fontSize: '1rem' } }, icon('cash'), `Incassa ${euro(S.total_cents)}`);
      closeBtn.addEventListener('click', busy(closeBtn, async () => {
        const payments = [...rows.children].map(r => r.read()).filter(p => +p.amount_euro > 0);
        const r = await post(`/api/admin/sales/${id}/close`, { payments });
        toast('Conto chiuso', 'ok');
        if (r.created.giftcards.length) modal({ title: 'Gift card emesse', size: 'narrow', body: h('div', { class: 'stack' }, r.created.giftcards.map(g => h('div', { class: 'row between alert ok' }, h('span', { class: 'kbd', style: { fontSize: '1.1rem' }, text: g.code }), h('strong', { text: euro(g.initial_cents) }))), h('p', { class: 'small muted', text: 'Consegna il codice al cliente: è valido 12 mesi.' })) });
        S = r; render();
      }));
      right.append(card('Pagamento', h('div', { class: 'stack' }, rows, h('button', { class: 'btn sm', onclick: () => addRow('carta', '') }, icon('plus'), 'Pagamento misto'), closeBtn,
        h('button', { class: 'btn danger sm', onclick: async () => { if (await confirmDialog('Annullare questo conto?', { danger: true })) { try { await post(`/api/admin/sales/${id}/void`, {}); location.hash = '#/cassa'; } catch (e) { toastErr(e); } } } }, 'Annulla conto'))));
    } else {
      right.append(card('Pagamenti', h('div', null, S.payments.map(p => h('div', { class: 'total-row' }, h('span', { text: `${MLBL[p.method] || p.method}${p.ref ? ' · ' + p.ref : ''}` }), h('span', { class: 'mono', text: euro(p.amount_cents) }))),
        S.points_earned ? h('div', { class: 'small muted', style: { marginTop: '8px' }, text: `Punti fedeltà accumulati: +${S.points_earned}` }) : null,
        h('div', { class: 'small muted', text: `Chiuso il ${fmtDateTime(S.closed_at)}` }))));
      if (S.status === 'chiusa' && can('cash.reports')) right.append(h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmDialog('Stornare il conto? Verranno ripristinati magazzino, gift card e punti.', { danger: true, ok: 'Storna' }))) return;
        try { await post(`/api/admin/sales/${id}/void`, { reason: 'Storno da gestionale' }); toast('Conto stornato'); load(); } catch (e) { toastErr(e); }
      } }, 'Storna conto'));
    }
    body.append(h('div', { class: 'pos' }, left, right));
  }
  function usePackageOr(svc, add) {
    const usable = (S.packages || []).filter(p => !p.service_id || p.service_id === svc.id);
    if (!usable.length) return add({ kind: 'servizio', ref_id: svc.id });
    const m = modal({ title: svc.name, size: 'narrow', body: h('div', { class: 'stack' }, h('p', { text: 'Il cliente ha un pacchetto utilizzabile per questo servizio.' }),
      usable.map(p => h('button', { class: 'btn', onclick: () => { m.close(); add({ kind: 'servizio', ref_id: svc.id, customer_package_id: p.id }); } }, `Usa “${p.name}” (${p.sessions_total - p.sessions_used} sedute rimaste)`)),
      h('button', { class: 'btn primary', onclick: () => { m.close(); add({ kind: 'servizio', ref_id: svc.id }); } }, `Paga ${euro(svc.price_cents)}`)) });
  }
  function pickCustomer() {
    const res = h('div');
    const inp = h('input', { type: 'search', placeholder: 'Nome o telefono…' });
    let t;
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
      res.innerHTML = ''; if (inp.value.trim().length < 2) return;
      const r = await get(`/api/admin/customers?q=${encodeURIComponent(inp.value.trim())}&limit=10`);
      r.rows.forEach(c => res.append(h('button', { class: 'pick', style: { width: '100%', marginTop: '6px' }, onclick: () => { m.close(); act(() => put(`/api/admin/sales/${id}`, { customer_id: c.id })); } }, h('strong', { text: fullName(c) }), h('small', { text: `${c.phone || ''} · ${c.points} punti` }))));
    }, 250); });
    const m = modal({ title: 'Associa cliente', size: 'narrow', body: [inp, res, S.customer_id ? h('button', { class: 'btn sm', style: { marginTop: '10px' }, onclick: () => { m.close(); act(() => put(`/api/admin/sales/${id}`, { customer_id: null })); } }, 'Rimuovi cliente') : null] });
  }
  load();
}
