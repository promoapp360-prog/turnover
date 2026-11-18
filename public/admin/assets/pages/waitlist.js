import { h, icon, get, post, put, card, table, tabs, form, modal, toast, toastErr, busy, cached, fmtDate, fmtDateTime, fullName, today, addDays, AUD, loading } from '../lib.js';

export default async function ({ content, actions }) {
  let status = 'attesa';
  const services = await cached('services', '/api/admin/r/services?active=1');
  const staff = await cached('staff', '/api/admin/staff');
  const body = h('div'); content.append(body);
  actions.append(h('button', { class: 'btn primary', onclick: addDialog }, icon('plus'), 'Aggiungi'));
  const LBL = { attesa: ['In attesa', 'warn'], avvisato: ['Avvisato', 'info'], prenotato: ['Prenotato', 'ok'], chiuso: ['Chiuso', ''] };
  async function load() {
    body.innerHTML = '';
    body.append(tabs(Object.entries(LBL).map(([k, [l]]) => [k, l]), status, k => { status = k; load(); }));
    const box = h('div'); body.append(box); box.appendChild(loading());
    try {
      const list = await get(`/api/admin/waitlist?status=${status}`);
      box.innerHTML = '';
      box.append(h('p', { class: 'muted', text: 'Quando un appuntamento viene cancellato, i clienti in attesa per quel giorno vengono avvisati automaticamente (se è attivo un canale di invio).' }),
        card(null, table([
          { label: 'Cliente', render: w => h('div', null, h('strong', { text: fullName(w) }), h('div', { class: 'small muted', text: w.phone || '' })) },
          { label: 'Servizi', render: w => w.service_ids.map(id => (services.find(s => s.id === id) || {}).name).filter(Boolean).join(', ') || 'Qualsiasi' },
          { label: 'Operatore', render: w => (staff.find(s => s.id === w.staff_id) || {}).name || 'Qualsiasi' },
          { label: 'Periodo', render: w => `${fmtDate(w.date_from)} → ${fmtDate(w.date_to)}` }, { label: 'Note', key: 'notes' },
          { label: 'Iscritto', render: w => fmtDateTime(w.created_at) },
          { label: '', render: w => h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
            w.phone ? h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: `https://wa.me/${w.phone.replace(/[^\d]/g, '').replace(/^(?!39)/, '39')}?text=${encodeURIComponent(`Ciao ${w.first_name}, si è liberato un posto! Vuoi prenotare?`)}` }, icon('whatsapp')) : null,
            ['attesa', 'avvisato'].includes(w.status) ? h('button', { class: 'btn sm', onclick: () => setStatus(w, 'prenotato') }, 'Prenotato') : null,
            w.status !== 'chiuso' ? h('button', { class: 'btn sm ghost', onclick: () => setStatus(w, 'chiuso') }, 'Chiudi') : h('button', { class: 'btn sm', onclick: () => setStatus(w, 'attesa') }, 'Riapri')) },
        ], list, { empty: 'Nessun cliente in questo stato' })));
    } catch (e) { toastErr(e); }
  }
  async function setStatus(w, s) { try { await put(`/api/admin/waitlist/${w.id}`, { status: s }); toast('Aggiornato', 'ok'); load(); } catch (e) { toastErr(e); } }
  function addDialog() {
    let customer = null;
    const res = h('div'); const inp = h('input', { type: 'search', placeholder: 'Cerca cliente…' });
    let t; inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { res.innerHTML = ''; if (inp.value.length < 2) return; const r = await get(`/api/admin/customers?q=${encodeURIComponent(inp.value)}&limit=6`); r.rows.forEach(c => res.append(h('button', { class: 'pick', style: { width: '100%', marginTop: '4px' }, onclick: () => { customer = c; inp.value = fullName(c); res.innerHTML = ''; } }, fullName(c), h('small', { text: c.phone || '' })))); }, 250); });
    const f = form([{ name: 'date_from', label: 'Dal', type: 'date', required: true }, { name: 'date_to', label: 'Al', type: 'date', required: true },
      { name: 'staff_id', label: 'Operatore', type: 'select', options: staff.map(s => [s.id, s.name]), emptyLabel: 'Qualsiasi' },
      { name: 'service_ids', label: 'Servizi', type: 'multi', options: services.map(s => [s.id, `${AUD[s.audience]} · ${s.name}`]) }, { name: 'notes', label: 'Note', full: true }], { date_from: today(), date_to: addDays(today(), 7) });
    const save = h('button', { class: 'btn primary' }, 'Aggiungi');
    const m = modal({ title: 'Aggiungi alla lista d’attesa', body: [h('label', { class: 'field' }, h('span', { text: 'Cliente *' }), inp), res, h('div', { style: { height: '12px' } }), f.el], footer: [save] });
    save.addEventListener('click', busy(save, async () => { if (!customer) throw new Error('Seleziona un cliente'); await post('/api/admin/waitlist', { customer_id: customer.id, ...f.values() }); m.close(); toast('Aggiunto', 'ok'); load(); }));
  }
  load();
}
