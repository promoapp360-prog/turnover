import { h, icon, get, euro, num, card, kpi, table, lineChart, barList, today, addDays, fmtDateTime, fmtDate, toastErr, loading } from '../lib.js';

const MLBL = { contanti: 'Contanti', carta: 'Carta', bancomat: 'Bancomat', satispay: 'Satispay', bonifico: 'Bonifico', giftcard: 'Gift card', acconto: 'Acconto', altro: 'Altro' };
const KLBL = { servizio: 'Servizi', prodotto: 'Prodotti', pacchetto: 'Pacchetti', giftcard: 'Gift card' };

export default async function ({ content, actions }) {
  const fromI = h('input', { type: 'date', value: today().slice(0, 8) + '01' }); const toI = h('input', { type: 'date', value: today() });
  const body = h('div');
  let last;
  actions.append(h('button', { class: 'btn', onclick: () => exportCsv() }, icon('download'), 'Esporta CSV'));
  content.append(h('div', { class: 'row', style: { marginBottom: '16px' } }, fromI, toI,
    h('div', { class: 'seg' }, h('button', { onclick: () => { fromI.value = today().slice(0, 8) + '01'; toI.value = today(); load(); } }, 'Mese'),
      h('button', { onclick: () => { const d = addDays(today().slice(0, 8) + '01', -1); fromI.value = d.slice(0, 8) + '01'; toI.value = d; load(); } }, 'Mese scorso'),
      h('button', { onclick: () => { fromI.value = today().slice(0, 4) + '-01-01'; toI.value = today(); load(); } }, 'Anno'))), body);
  [fromI, toI].forEach(i => i.addEventListener('change', load));
  async function load() {
    body.innerHTML = ''; body.appendChild(loading());
    try {
      const [r, sessions] = await Promise.all([get(`/api/admin/reports?from=${fromI.value}&to=${toI.value}`), get('/api/admin/cash/sessions')]);
      last = r;
      const pts = []; const map = new Map(r.by_day.map(x => [x.d, x.v]));
      for (let d = r.range.from; d <= r.range.to; d = addDays(d, 1)) pts.push({ d, v: map.get(d) || 0, label: d.slice(8, 10) + '/' + d.slice(5, 7) });
      body.innerHTML = '';
      body.append(h('div', { class: 'grid g4' }, kpi('Incassi registrati', euro(r.totals.revenue), `${num(r.totals.sales)} conti`), kpi('Sconti concessi', euro(r.totals.discounts)),
        kpi('Spese registrate', euro(r.expenses_total)), kpi('Risultato (incassi − spese)', euro(r.net_cents))),
      h('div', { style: { marginTop: '16px' } }, card('Incassi per giorno', lineChart(pts, { format: v => euro(Math.round(v)) }))),
      h('div', { class: 'grid g2', style: { marginTop: '16px' } },
        card('Per servizio', table([{ label: 'Servizio', key: 'name' }, { label: 'Quantità', key: 'n', class: 'right' }, { label: 'Incasso', render: x => euro(x.revenue), class: 'right mono' }], r.by_service, { empty: 'Nessun dato' })),
        card('Per operatore e provvigioni', table([{ label: 'Operatore', key: 'name' }, { label: 'Servizi', render: x => euro(x.services_revenue), class: 'right mono' }, { label: 'Prodotti', render: x => euro(x.products_revenue), class: 'right mono' },
          { label: 'Provvigione', render: x => x.commission_pct ? `${euro(x.commission_cents)} (${x.commission_pct}%)` : '—', class: 'right' }], r.by_staff, { empty: 'Nessun dato' })),
        card('Per metodo di pagamento', barList(r.by_method, { value: x => x.total, label: x => MLBL[x.method] || x.method, format: euro })),
        card('Per tipologia', barList(r.by_kind, { value: x => x.total, label: x => KLBL[x.kind] || x.kind, format: euro })),
        card('Spese per categoria', barList(r.expenses, { value: x => x.total, label: x => x.category, format: euro })),
        card('Chiusure di cassa', table([{ label: 'Apertura', render: s => fmtDateTime(s.opened_at) }, { label: 'Chiusura', render: s => s.closed_at ? fmtDateTime(s.closed_at) : h('span', { class: 'badge ok', text: 'aperta' }) },
          { label: 'Incassato', render: s => euro(s.total_cents), class: 'right mono' }, { label: 'Differenza contanti', render: s => s.closed_at ? euro((s.counted_cents || 0) - (s.expected_cents || 0)) : '', class: 'right mono' }], sessions.slice(0, 15), { empty: 'Nessuna sessione' }))),
      h('p', { class: 'small muted', style: { marginTop: '14px' }, text: 'I valori riflettono gli incassi registrati nel gestionale e non sostituiscono la contabilità fiscale.' }));
    } catch (e) { body.innerHTML = ''; toastErr(e); }
  }
  function exportCsv() {
    if (!last) return;
    const lines = [['Sezione', 'Voce', 'Quantità', 'Importo €']];
    last.by_service.forEach(x => lines.push(['Servizio', x.name, x.n, (x.revenue / 100).toFixed(2)]));
    last.by_staff.forEach(x => lines.push(['Operatore', x.name, x.sales, (x.services_revenue / 100).toFixed(2)]));
    last.by_method.forEach(x => lines.push(['Pagamento', MLBL[x.method] || x.method, '', (x.total / 100).toFixed(2)]));
    last.expenses.forEach(x => lines.push(['Spesa', x.category, '', (x.total / 100).toFixed(2)]));
    lines.push(['Totale', 'Incassi', last.totals.sales, (last.totals.revenue / 100).toFixed(2)], ['Totale', 'Spese', '', (last.expenses_total / 100).toFixed(2)]);
    const csv = '﻿' + lines.map(l => l.map(c => `"${String(c).replace(/"/g, '""').replace('.', ',')}"`).join(';')).join('\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `report-${fromI.value}-${toI.value}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
  }
  load();
}
