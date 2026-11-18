import { h, icon, get, post, put, del, can, card, table, tabs, form, formModal, modal, toast, toastErr, busy, confirmDialog, fmtDateTime, invalidate, AUD, loading, today } from '../lib.js';

const DAYS = [[1, 'Lunedì'], [2, 'Martedì'], [3, 'Mercoledì'], [4, 'Giovedì'], [5, 'Venerdì'], [6, 'Sabato'], [0, 'Domenica']];
const KINDS = [['ferie', 'Ferie'], ['malattia', 'Malattia'], ['permesso', 'Permesso'], ['ritardo', 'Ritardo'], ['chiusura', 'Chiusura straordinaria'], ['altro', 'Altro']];

export default async function ({ content, actions }) {
  let tab = 'staff', staff = [], services = [], absences = [];
  const body = h('div');
  content.append(body);
  actions.append(h('button', { class: 'btn primary', onclick: () => (tab === 'staff' ? editStaff() : editAbsence()) }, icon('plus'), 'Nuovo'));
  async function load() {
    body.innerHTML = ''; body.appendChild(loading());
    try { [staff, services, absences] = await Promise.all([get('/api/admin/staff'), get('/api/admin/r/services?active=1'), get('/api/admin/r/absences?future=1')]); } catch (e) { return toastErr(e); }
    invalidate('staff'); render();
  }
  function render() {
    body.innerHTML = '';
    body.append(tabs([['staff', 'Operatori'], ['assenze', `Ferie, assenze e chiusure (${absences.length})`]], tab, k => { tab = k; render(); }));
    if (tab === 'staff') {
      body.append(h('div', { class: 'grid g3' }, staff.map(s => h('div', { class: 'card', style: { cursor: 'pointer' }, onclick: () => editStaff(s) }, h('div', { class: 'card-b row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } },
        s.photo_url ? h('img', { src: s.photo_url, alt: '', style: { width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' } }) : h('div', { class: 'avatar', style: { width: '56px', height: '56px', fontSize: '1.4rem', background: s.color }, text: s.name[0] }),
        h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'row' }, h('strong', { text: s.name }), s.active ? null : h('span', { class: 'badge err', text: 'Disattivo' })),
          h('div', { class: 'small muted', text: s.role_title || '' }), h('div', { class: 'small', style: { marginTop: '6px' }, text: s.service_ids.length ? `${s.service_ids.length} servizi abilitati` : 'Tutti i servizi' }),
          h('div', { class: 'small muted', text: scheduleSummary(s) }),
          h('div', { class: 'row', style: { marginTop: '6px', gap: '6px' } }, s.online_bookable ? h('span', { class: 'badge ok', text: 'Prenotabile online' }) : null, s.commission_pct ? h('span', { class: 'badge', text: `Provvigione ${s.commission_pct}%` }) : null)))))),
      !staff.length ? h('div', { class: 'card empty', text: 'Nessun operatore' }) : null);
    } else {
      body.append(card(null, table([
        { label: 'Chi', render: a => a.staff_id ? (staff.find(s => s.id === a.staff_id) || {}).name : h('strong', { text: 'Tutto il salone' }) },
        { label: 'Tipo', render: a => (KINDS.find(k => k[0] === a.kind) || [0, a.kind])[1] }, { label: 'Dal', render: a => fmtDateTime(a.starts_at) }, { label: 'Al', render: a => fmtDateTime(a.ends_at) }, { label: 'Note', key: 'reason' },
      ], absences, { onRow: editAbsence, empty: 'Nessuna assenza o chiusura programmata' })));
    }
  }
  function scheduleSummary(s) {
    const keys = Object.keys(s.schedule || {});
    if (!keys.length) return 'Turni: come orario del salone';
    return 'Turni personalizzati: ' + DAYS.filter(([d]) => keys.includes(String(d))).map(([d, l]) => `${l.slice(0, 3)} ${(s.schedule[d] || []).length ? s.schedule[d].map(r => r.join('–')).join(', ') : 'riposo'}`).join(' · ');
  }
  function editStaff(s) {
    const f = form([
      { name: 'name', label: 'Nome', required: true }, { name: 'role_title', label: 'Ruolo / qualifica' },
      { name: 'phone', label: 'Telefono', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'specialties', label: 'Specializzazioni (sul sito)', full: true }, { name: 'bio', label: 'Presentazione (sul sito)', type: 'textarea' },
      { name: 'photo_url', label: 'Fotografia', type: 'image' },
      { name: 'color', label: 'Colore in agenda', type: 'color' }, { name: 'commission_pct', label: 'Provvigione sui servizi (%)', type: 'number', min: 0, max: 100 },
      { name: 'sort', label: 'Ordine', type: 'number' }, { name: 'online_bookable', label: 'Prenotabile online', type: 'checkbox' }, { name: 'show_on_site', label: 'Mostra sul sito', type: 'checkbox' }, { name: 'active', label: 'Attivo', type: 'checkbox' },
      { name: 'service_ids', label: 'Servizi che può eseguire (nessuno selezionato = tutti)', type: 'multi', options: services.map(x => [x.id, `${AUD[x.audience]} · ${x.name}`]) },
    ], s || { color: '#b08968', online_bookable: true, show_on_site: true, active: true, commission_pct: 0 });
    // editor turni
    const sched = JSON.parse(JSON.stringify((s && s.schedule) || {}));
    const schedBox = h('div');
    function drawSched() {
      schedBox.innerHTML = '';
      schedBox.append(h('h3', { style: { margin: '16px 0 4px' }, text: 'Turni di lavoro' }), h('p', { class: 'small muted', text: '“Orario salone” = lavora negli orari di apertura. Puoi impostare fasce diverse o giorni di riposo.' }));
      for (const [d, l] of DAYS) {
        const has = Object.prototype.hasOwnProperty.call(sched, String(d));
        const mode = !has ? 'salon' : (sched[d].length ? 'custom' : 'off');
        const sel = h('select', { style: { width: 'auto' }, onchange: () => { if (sel.value === 'salon') delete sched[d]; else if (sel.value === 'off') sched[d] = []; else sched[d] = [['09:00', '13:00'], ['14:00', '18:00']]; drawSched(); } },
          h('option', { value: 'salon' }, 'Orario salone'), h('option', { value: 'custom' }, 'Personalizzato'), h('option', { value: 'off' }, 'Riposo'));
        sel.value = mode;
        const ranges = h('div', { class: 'ranges' }, sel);
        if (mode === 'custom') {
          sched[d].forEach((r, i) => {
            const a = h('input', { type: 'time', value: r[0], onchange: () => { r[0] = a.value; } }); const b = h('input', { type: 'time', value: r[1], onchange: () => { r[1] = b.value; } });
            ranges.append(h('span', { class: 'rg' }, a, '–', b, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { sched[d].splice(i, 1); drawSched(); } }, icon('x'))));
          });
          ranges.append(h('button', { class: 'btn sm', type: 'button', onclick: () => { sched[d].push(['15:00', '19:00']); drawSched(); } }, '+ fascia'));
        }
        schedBox.append(h('div', { class: 'sched-row' }, h('strong', { text: l }), ranges));
      }
    }
    drawSched();
    const save = h('button', { class: 'btn primary' }, 'Salva');
    const m = modal({ title: s ? `Modifica ${s.name}` : 'Nuovo operatore', size: 'wide', body: [f.el, schedBox],
      footer: [s ? h('button', { class: 'btn danger', style: { marginRight: 'auto' }, onclick: async () => { if (await confirmDialog('Eliminare l’operatore? Se ha appuntamenti registrati, disattivalo invece.', { danger: true, ok: 'Elimina' })) { try { await del(`/api/admin/staff/${s.id}`); m.close(); load(); } catch (e) { toastErr(e); } } } }, 'Elimina') : null, save] });
    save.addEventListener('click', busy(save, async () => {
      const v = { ...f.values(), schedule: sched };
      if (s) await put(`/api/admin/staff/${s.id}`, v); else await post('/api/admin/staff', v);
      m.close(); toast('Salvato', 'ok'); load();
    }));
  }
  function editAbsence(a) {
    formModal({ title: a ? 'Modifica assenza' : 'Nuova assenza o chiusura', values: a || { kind: 'ferie', starts_at: `${today()}T09:00`, ends_at: `${today()}T18:00` },
      fields: [{ name: 'staff_id', label: 'Operatore', type: 'select', options: staff.map(s => [s.id, s.name]), emptyLabel: 'Tutto il salone (chiusura)' },
        { name: 'kind', label: 'Tipo', type: 'select', options: KINDS, empty: false }, { name: 'starts_at', label: 'Dal', type: 'datetime', required: true }, { name: 'ends_at', label: 'Al', type: 'datetime', required: true },
        { name: 'reason', label: 'Note', full: true }],
      onSave: async v => { if (a) await put(`/api/admin/r/absences/${a.id}`, v); else await post('/api/admin/r/absences', v); load(); },
      extra: h('p', { class: 'small muted', style: { marginTop: '10px' }, text: 'Durante assenze e chiusure gli orari non sono prenotabili online. Gli appuntamenti già presenti restano: spostali dall’agenda.' }),
      deleteFn: a ? async () => { await del(`/api/admin/r/absences/${a.id}`); load(); } : null });
  }
  load();
}
