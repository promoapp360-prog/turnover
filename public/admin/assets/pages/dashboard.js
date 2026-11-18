import { h, get, can, euro, num, kpi, card, lineChart, barList, today, addDays, fmtTime, fullName, statusBadge, loading, cached, toastErr, AUD } from '../lib.js';

export default async function ({ content, actions }) {
  let f = { from: addDays(today(), -29), to: today(), staff_id: '', audience: '' };
  const staff = await cached('staff', '/api/admin/staff').catch(() => []);
  const fromI = h('input', { type: 'date', value: f.from }); const toI = h('input', { type: 'date', value: f.to });
  const stI = h('select', null, h('option', { value: '' }, 'Tutti gli operatori'), staff.map(s => h('option', { value: s.id }, s.name)));
  const audI = h('select', null, h('option', { value: '' }, 'Tutte le categorie'), Object.entries(AUD).map(([k, v]) => h('option', { value: k }, v)));
  const quick = (d) => () => { fromI.value = addDays(today(), -d + 1); toI.value = today(); load(); };
  actions.append(h('div', { class: 'row' }, h('div', { class: 'seg' }, h('button', { onclick: quick(7) }, '7 gg'), h('button', { onclick: quick(30) }, '30 gg'), h('button', { onclick: quick(90) }, '90 gg'))));
  const filters = h('div', { class: 'row', style: { marginBottom: '16px' } }, fromI, toI, stI, audI);
  [fromI, toI, stI, audI].forEach(i => i.addEventListener('change', load));
  const body = h('div');
  content.append(filters, body);

  async function load() {
    f = { from: fromI.value, to: toI.value, staff_id: stI.value, audience: audI.value };
    body.innerHTML = ''; body.appendChild(loading());
    try {
      const d = await get(`/api/admin/dashboard?${new URLSearchParams(f)}`);
      body.innerHTML = '';
      const fin = d.finance;
      const delta = (a, b) => { if (!b) return null; const p = Math.round((a - b) / b * 100); return h('span', { class: `delta ${p >= 0 ? 'up' : 'down'}`, text: `${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% ` }); };
      body.append(
        h('div', { class: 'grid g4' },
          kpi('Appuntamenti oggi', num(d.kpi.today), h('a', { href: '#/agenda' }, 'Apri agenda →')),
          kpi('Questa settimana', num(d.kpi.week)),
          kpi('Da confermare', num(d.kpi.pending), d.kpi.pending ? h('a', { href: '#/agenda' }, 'Gestisci →') : 'Nessuna richiesta in sospeso'),
          kpi('Clienti in salone ora', num(d.kpi.present))),
        fin ? h('div', { class: 'grid g4', style: { marginTop: '16px' } },
          kpi('Incasso di oggi', euro(fin.today)),
          kpi('Incasso del mese', euro(fin.month), [delta(fin.month, fin.prev_month_same_period), 'vs stesso periodo mese scorso']),
          kpi('Incasso nel periodo', euro(fin.period), [delta(fin.period, fin.prev_period), 'vs periodo precedente']),
          kpi('Scontrino medio', euro(fin.avg_ticket), `${num(fin.period_sales)} conti chiusi`)) : null,
        h('div', { class: 'grid g4', style: { marginTop: '16px' } },
          kpi('Clienti nuovi', num(d.clients.new_clients), 'nel periodo'),
          kpi('Clienti abituali', num(d.clients.returning_clients), `su ${num(d.clients.served_clients)} serviti`),
          kpi('Tasso cancellazione', `${d.period.cancel_rate}%`, `${d.period.cancelled} su ${d.period.total}`),
          kpi('Appuntamenti mancati', num(d.period.no_show), `${d.period.no_show_rate}% · online: ${d.period.online}`)),
        fin ? h('div', { style: { marginTop: '16px' } }, card('Andamento incassi registrati', lineChart(fin.series.map(p => ({ ...p, label: p.d.slice(8, 10) + '/' + p.d.slice(5, 7) })), { format: v => euro(Math.round(v)) }))) : null,
        h('div', { class: 'grid g3', style: { marginTop: '16px' } },
          card('Servizi più richiesti', barList(d.top_services, { value: i => i.n, label: i => i.name, format: v => `${v}×` })),
          card('Operatori più impegnati', barList(d.busy_staff, { value: i => i.minutes, label: i => `${i.name} · ${i.n} app.`, format: v => `${Math.round(v / 60)} h` })),
          fin ? card('Prodotti più venduti', barList(fin.top_products, { value: i => i.qty, label: i => i.name, format: v => `${v} pz` })) : card('Prossimi di oggi', todayList(d.today))),
        fin ? h('div', { style: { marginTop: '16px' } }, card('Appuntamenti di oggi', todayList(d.today), h('a', { class: 'btn sm', href: '#/agenda' }, 'Agenda'))) : null);
    } catch (e) { body.innerHTML = ''; toastErr(e); }
  }
  function todayList(list) {
    if (!list.length) return h('div', { class: 'empty', text: 'Nessun appuntamento oggi' });
    return h('div', null, list.map(a => h('div', { class: 'list-row' }, h('span', { class: 'dot', style: { background: a.color } }), h('strong', { class: 'mono', text: fmtTime(a.starts_at) }),
      h('div', { class: 'grow' }, h('div', { text: fullName(a) }), h('div', { class: 'small muted', text: `${a.services || ''} · ${a.staff_name}` })), statusBadge(a.status))));
  }
  load();
  const onChange = () => load();
  window.addEventListener('pa:appointments', onChange);
  return { destroy: () => window.removeEventListener('pa:appointments', onChange) };
}
