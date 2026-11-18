import { h, icon, get, post, patch, can, state, euro, today, addDays, weekday, toMin, minToT, localParts, fmtTime, longDate, fullName, statusBadge, STATUS, modal, form, toast, toastErr, confirmDialog, busy, button, cached, invalidate, dur, AUD, pref, loading, searchBox, fmtDateTime } from '../lib.js';

const PPM = 1.6; // pixel per minuto
const WD = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

export default async function ({ content, actions, params }) {
  const S = { view: pref('agenda_view') || (innerWidth < 700 ? 'day' : 'day'), date: params[0] && /^\d{4}-\d{2}-\d{2}$/.test(params[0]) ? params[0] : today(), staffFilter: pref('agenda_staff') || '', data: null };
  const services = await cached('services', '/api/admin/r/services?active=1');
  const editable = can('agenda.edit');

  const dateI = h('input', { type: 'date', value: S.date, style: { width: 'auto' }, onchange: () => { S.date = dateI.value; load(); } });
  const viewSeg = h('div', { class: 'seg' }, [['day', 'Giorno'], ['week', 'Settimana'], ['month', 'Mese']].map(([k, l]) => h('button', { 'data-v': k, onclick: () => { S.view = k; pref('agenda_view', k); load(); } }, l)));
  const staffSel = h('select', { style: { width: 'auto' }, onchange: () => { S.staffFilter = staffSel.value; pref('agenda_staff', S.staffFilter); render(); } });
  const label = h('strong', { style: { fontSize: '1.05rem', minWidth: '180px' } });
  const pendingBtn = h('button', { class: 'btn', onclick: showPending });
  const toolbar = h('div', { class: 'agenda-toolbar' },
    h('button', { class: 'btn icon', 'aria-label': 'Precedente', onclick: () => shift(-1) }, icon('chevL')), h('button', { class: 'btn', onclick: () => { S.date = today(); load(); } }, 'Oggi'),
    h('button', { class: 'btn icon', 'aria-label': 'Successivo', onclick: () => shift(1) }, icon('chevR')), label, h('div', { class: 'spacer' }), dateI, staffSel, viewSeg, pendingBtn);
  if (editable) actions.append(h('button', { class: 'btn primary', onclick: () => newAppointment({}) }, icon('plus'), 'Nuovo'));
  actions.append(h('button', { class: 'btn', onclick: searchDialog }, icon('search'), 'Cerca'));
  const cal = h('div');
  content.append(toolbar, cal);

  function shift(n) {
    if (S.view === 'day') S.date = addDays(S.date, n);
    else if (S.view === 'week') S.date = addDays(S.date, 7 * n);
    else { const [y, m] = S.date.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); S.date = d.toISOString().slice(0, 10); }
    load();
  }
  function range() {
    if (S.view === 'day') return [S.date, S.date];
    if (S.view === 'week') { const mon = addDays(S.date, -((weekday(S.date) + 6) % 7)); return [mon, addDays(mon, 6)]; }
    const first = S.date.slice(0, 8) + '01'; const start = addDays(first, -((weekday(first) + 6) % 7));
    return [start, addDays(start, 41)];
  }

  let loadSeq = 0;
  async function load() {
    const seq = ++loadSeq;
    dateI.value = S.date;
    [...viewSeg.children].forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
    const [from, to] = range();
    if (!S.data) { cal.innerHTML = ''; cal.appendChild(loading()); }
    try {
      const d = await get(`/api/admin/agenda?from=${from}&to=${to}`);
      if (seq !== loadSeq) return;
      S.data = d; S.from = from; S.to = to;
      render();
    } catch (e) { toastErr(e); }
  }

  function render() {
    const d = S.data; if (!d) return;
    staffSel.innerHTML = '';
    staffSel.append(h('option', { value: '' }, 'Tutto lo staff'), d.staff.map(s => h('option', { value: s.id }, s.name)));
    staffSel.value = S.staffFilter;
    const pend = d.appointments.filter(a => a.status === 'in_attesa').length;
    pendingBtn.textContent = ''; pendingBtn.append(icon('bell'), `Da confermare: ${pend}`); pendingBtn.classList.toggle('primary', pend > 0);
    if (S.view === 'day') label.textContent = longDate(S.date);
    else if (S.view === 'week') label.textContent = `${longDate(S.from).replace(/ \d{4}$/, '')} – ${longDate(S.to)}`;
    else label.textContent = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(S.date.slice(0, 8) + '15T00:00:00Z'));
    cal.innerHTML = '';
    if (S.view === 'month') return cal.appendChild(monthView());
    cal.appendChild(gridView());
  }

  // ------------------------------------------------------------ vista mese
  function monthView() {
    const d = S.data; const grid = h('div', { class: 'month' });
    ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].forEach(x => grid.appendChild(h('div', { class: 'mh', text: x })));
    const month = S.date.slice(0, 7);
    for (let i = 0; i < 42; i++) {
      const day = addDays(S.from, i);
      const list = d.appointments.filter(a => localParts(a.starts_at).date === day && (!S.staffFilter || String(a.staff_id) === S.staffFilter));
      const closed = !(d.hours[weekday(day)] || []).length;
      grid.appendChild(h('div', { class: `md${day.slice(0, 7) !== month ? ' out' : ''}${day === today() ? ' today' : ''}`, onclick: () => { S.date = day; S.view = 'day'; pref('agenda_view', 'day'); load(); } },
        h('b', { text: String(+day.slice(8)) }), closed ? h('div', { class: 'small muted', text: 'Chiuso' }) : null,
        list.length ? h('div', null, h('span', { class: 'cnt', text: `${list.length} app.` })) : null,
        list.slice(0, 3).map(a => h('div', { class: 'small', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, h('span', { class: 'dot', style: { background: a.staff_color, marginRight: '4px' } }), `${fmtTime(a.starts_at)} ${a.first_name || ''}`))));
    }
    return grid;
  }

  // ------------------------------------------------------------ vista giorno/settimana
  function gridView() {
    const d = S.data;
    let cols;
    const staffList = d.staff.filter(s => !S.staffFilter || String(s.id) === S.staffFilter);
    if (S.view === 'day') cols = staffList.map(s => ({ key: `s${s.id}`, date: S.date, staffId: s.id, title: [h('span', { class: 'dot', style: { background: s.color } }), s.name], staff: s }));
    else cols = Array.from({ length: 7 }, (_, i) => { const day = addDays(S.from, i); return { key: `d${day}`, date: day, staffId: S.staffFilter ? +S.staffFilter : null, title: `${WD[weekday(day)]} ${+day.slice(8)}/${+day.slice(5, 7)}`, today: day === today() }; });
    if (!cols.length) return h('div', { class: 'card empty', text: 'Nessun operatore attivo: aggiungilo in “Staff e turni”.' });

    // fascia oraria visualizzata
    let minS = 24 * 60, maxE = 0;
    for (let w = 0; w < 7; w++) for (const [a, b] of d.hours[w] || []) { minS = Math.min(minS, toMin(a)); maxE = Math.max(maxE, toMin(b)); }
    for (const a of d.appointments) { const s = toMin(localParts(a.starts_at).time); const e = toMin(localParts(a.ends_at).time) || 1440; minS = Math.min(minS, s); maxE = Math.max(maxE, e); }
    if (minS >= maxE) { minS = 8 * 60; maxE = 20 * 60; }
    minS = Math.max(0, Math.floor(minS / 60) * 60 - 60); maxE = Math.min(24 * 60, Math.ceil(maxE / 60) * 60 + 60);
    const height = (maxE - minS) * PPM;
    const step = d.step || 15;
    const colW = S.view === 'day' ? 'minmax(170px,1fr)' : 'minmax(120px,1fr)';
    const tpl = `60px repeat(${cols.length}, ${colW})`;

    const head = h('div', { class: 'cal-head', style: { gridTemplateColumns: tpl } }, h('div'), cols.map(c => h('div', { style: c.today ? { color: 'var(--accent)' } : null }, c.title)));
    const times = h('div', { class: 'cal-times', style: { height: `${height}px` } });
    for (let m = minS; m <= maxE; m += 60) times.appendChild(h('span', { style: { top: `${(m - minS) * PPM}px` }, text: minToT(m) }));
    const body = h('div', { class: 'cal-body', style: { gridTemplateColumns: tpl } }, times);
    const colEls = [];
    for (const c of cols) {
      const col = h('div', { class: 'cal-col', style: { height: `${height}px` }, 'data-key': c.key });
      for (let m = minS; m < maxE; m += step) col.appendChild(h('div', { class: `slot${m % 60 === 0 ? ' hour' : ''}`, style: { top: `${(m - minS) * PPM}px`, height: `${step * PPM}px` } }));
      // orari di chiusura (salone ∩ turno operatore)
      const open = openWindows(c);
      let cur = minS;
      for (const [a, b] of open.concat([[maxE, maxE]])) { if (a > cur) col.appendChild(h('div', { class: 'closed', style: { top: `${(cur - minS) * PPM}px`, height: `${(a - cur) * PPM}px` } })); cur = Math.max(cur, b); }
      // assenze
      for (const ab of d.absences) {
        if (ab.staff_id && c.staffId && ab.staff_id !== c.staffId) continue;
        if (ab.staff_id && !c.staffId && S.view === 'week') continue;
        const s = new Date(ab.starts_at), e = new Date(ab.ends_at);
        const ds = localParts(s), de = localParts(e);
        if (ds.date > c.date || de.date < c.date) continue;
        const sm = ds.date < c.date ? minS : toMin(ds.time), em = de.date > c.date ? maxE : toMin(de.time);
        col.appendChild(h('div', { class: 'absence', style: { top: `${(Math.max(sm, minS) - minS) * PPM}px`, height: `${(Math.min(em, maxE) - Math.max(sm, minS)) * PPM}px` }, text: `${ab.kind}${ab.staff_name ? ' · ' + ab.staff_name : ' · salone'}${ab.reason ? ' – ' + ab.reason : ''}` }));
      }
      // appuntamenti con corsie per le sovrapposizioni (es. durante la posa)
      const list = d.appointments.filter(a => localParts(a.starts_at).date === c.date && (!c.staffId || a.staff_id === c.staffId) && (S.view === 'day' || !S.staffFilter || String(a.staff_id) === S.staffFilter))
        .map(a => ({ a, s: toMin(localParts(a.starts_at).time), e: Math.max(toMin(localParts(a.starts_at).time) + 10, toMin(localParts(a.ends_at).time) || 1440) })).sort((x, y) => x.s - y.s);
      layoutLanes(list);
      for (const it of list) col.appendChild(apptEl(it, minS, c));
      if (c.date === today()) { const nm = toMin(localParts(new Date()).time); if (nm > minS && nm < maxE) col.appendChild(h('div', { class: 'now-line', style: { top: `${(nm - minS) * PPM}px` } })); }
      if (editable) col.addEventListener('click', ev => {
        if (ev.target.closest('.appt')) return;
        const r = col.getBoundingClientRect();
        const m = Math.floor(((ev.clientY - r.top) / PPM + minS) / step) * step;
        newAppointment({ date: c.date, time: minToT(m), staff_id: c.staffId || (S.staffFilter ? +S.staffFilter : (d.staff[0] || {}).id) });
      });
      colEls.push({ el: col, c });
      body.appendChild(col);
    }
    const wrap = h('div', { class: 'cal' }, h('div', { class: 'cal-grid' }, head, body));
    S.geom = { minS, step, colEls };
    // scorri all'orario attuale o all'apertura
    requestAnimationFrame(() => { const nm = toMin(localParts(new Date()).time); const target = (S.date === today() ? nm - 60 : (openWindows(cols[0])[0] || [minS])[0]) - minS; wrap.scrollTop = Math.max(0, target * PPM - 20); });
    return wrap;
  }

  function openWindows(c) {
    const salon = (S.data.hours[weekday(c.date)] || []).map(([a, b]) => [toMin(a), toMin(b)]);
    if (!c.staffId) return salon;
    const st = S.data.staff.find(s => s.id === c.staffId);
    const sch = st && st.schedule && Object.prototype.hasOwnProperty.call(st.schedule, String(weekday(c.date))) ? st.schedule[String(weekday(c.date))].map(([a, b]) => [toMin(a), toMin(b)]) : salon;
    const out = [];
    for (const [a, b] of salon) for (const [x, y] of sch) { const s = Math.max(a, x), e = Math.min(b, y); if (e > s) out.push([s, e]); }
    return out.sort((p, q) => p[0] - q[0]);
  }

  function layoutLanes(list) {
    let group = [], end = -1;
    const flush = () => { const lanes = []; for (const it of group) { let l = lanes.findIndex(x => x <= it.s); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = it.e; it.lane = l; } group.forEach(it => { it.lanes = lanes.length; }); group = []; };
    for (const it of list) { if (it.s >= end && group.length) flush(); group.push(it); end = Math.max(end, it.e); }
    if (group.length) flush();
  }

  function apptEl(it, minS, col) {
    const a = it.a;
    const color = a.staff_color || '#b0835a';
    const el = h('div', { class: `appt st-${a.status}`, tabindex: '0', role: 'button', 'aria-label': `${fmtTime(a.starts_at)} ${fullName(a)}`,
      style: { top: `${(it.s - minS) * PPM}px`, height: `${Math.max(18, (it.e - it.s) * PPM - 2)}px`, left: `calc(${it.lane / it.lanes * 100}% + 3px)`, width: `calc(${100 / it.lanes}% - 6px)`, right: 'auto',
        background: `color-mix(in srgb, ${color} 22%, #fff)`, borderLeftColor: color } },
      h('b', { text: `${fmtTime(a.starts_at)} ${fullName(a)}` }), h('div', { class: 's', text: a.services.map(s => s.name).join(', ') }),
      S.view === 'week' && !S.staffFilter ? h('div', { class: 's', text: a.staff_name }) : null);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') openAppt(a.id); });
    const movable = editable && !['completato', 'cancellato', 'assente'].includes(a.status);
    if (movable) { const rz = h('div', { class: 'resize', title: 'Trascina per cambiare la durata' }); el.appendChild(rz); enableResize(rz, el, it); }
    enableDrag(el, it, col, movable);
    return el;
  }

  // ------------------------------------------------------------ drag & drop
  function enableDrag(el, it, col, movable) {
    el.addEventListener('pointerdown', ev => {
      if (ev.target.classList.contains('resize') || ev.button !== 0) return;
      const sx = ev.clientX, sy = ev.clientY; let dragging = false; let target = null;
      const { step, colEls } = S.geom;
      const move = e => {
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (!dragging && Math.hypot(dx, dy) > 6 && movable) { dragging = true; el.classList.add('dragging'); el.setPointerCapture(ev.pointerId); }
        if (!dragging) return;
        const snap = Math.round(dy / PPM / step) * step;
        el.style.transform = `translate(${dx}px, ${snap * PPM}px)`;
        const over = colEls.find(x => { const r = x.el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right; });
        colEls.forEach(x => x.el.classList.toggle('drop', x === over));
        target = over ? { c: over.c, delta: snap } : null;
      };
      const up = async () => {
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        S.geom.colEls.forEach(x => x.el.classList.remove('drop'));
        if (!dragging) { openAppt(it.a.id); return; }
        el.classList.remove('dragging');
        if (!target || (target.delta === 0 && target.c.key === col.key)) { el.style.transform = ''; return; }
        const newMin = it.s + target.delta;
        const body = { date: target.c.date, time: minToT(newMin), version: it.a.version };
        if (target.c.staffId && target.c.staffId !== it.a.staff_id) body.staff_id = target.c.staffId;
        try {
          await patch(`/api/admin/appointments/${it.a.id}`, body);
          toast(`Spostato alle ${minToT(newMin)}`, 'ok');
        } catch (e) { toastErr(e); }
        load();
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  }
  function enableResize(handle, el, it) {
    handle.addEventListener('pointerdown', ev => {
      ev.stopPropagation(); handle.setPointerCapture(ev.pointerId);
      const sy = ev.clientY; const h0 = el.offsetHeight; let newDur = it.e - it.s;
      const move = e => { const step = S.geom.step; newDur = Math.max(step, Math.round((h0 + e.clientY - sy) / PPM / step) * step); el.style.height = `${newDur * PPM - 2}px`; };
      const up = async () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
        if (newDur === it.e - it.s) return;
        try { await patch(`/api/admin/appointments/${it.a.id}`, { duration_min: newDur, version: it.a.version }); toast(`Durata: ${dur(newDur)}`, 'ok'); } catch (e) { toastErr(e); }
        load();
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });
  }
  // ------------------------------------------------------------ dettaglio appuntamento
  async function openAppt(id) {
    let a;
    try { a = await get(`/api/admin/appointments/${id}`); } catch (e) { return toastErr(e); }
    const own = can('agenda.edit') || (can('agenda.own') && state.me.staff_id === a.staff_id);
    const lp = localParts(a.starts_at);
    const statusBtns = ['confermato', 'arrivato', 'in_lavorazione', 'completato', 'assente', 'cancellato'].filter(s => s !== a.status).map(s =>
      h('button', { class: `btn sm${s === 'cancellato' || s === 'assente' ? ' danger' : ''}`, onclick: async () => {
        if (s === 'cancellato' && !(await confirmDialog('Cancellare l’appuntamento? L’orario tornerà disponibile.', { danger: true, ok: 'Cancella' }))) return;
        try { await post(`/api/admin/appointments/${id}/status`, { status: s, version: a.version, notify: true }); m.close(); toast('Stato aggiornato', 'ok'); load(); } catch (e) { toastErr(e); }
      } }, STATUS[s][0]));
    const notesI = h('textarea', { rows: 2 }); notesI.value = a.internal_notes || '';
    const body = h('div', { class: 'stack' },
      h('div', { class: 'row between' }, h('div', null, h('h2', { text: fullName(a) }), h('div', { class: 'muted', text: `${longDate(lp.date)} · ${lp.time}–${fmtTime(a.ends_at)} · ${a.staff_name}` })), statusBadge(a.status)),
      h('div', { class: 'row' },
        a.customer_id ? h('a', { class: 'btn sm', href: `#/clienti/${a.customer_id}` }, icon('user'), 'Scheda cliente') : null,
        a.phone ? h('a', { class: 'btn sm', href: `tel:${a.phone}` }, icon('phone'), a.phone) : null,
        a.wa_link ? h('a', { class: 'btn sm', href: a.wa_link, target: '_blank', rel: 'noopener' }, icon('whatsapp'), 'WhatsApp') : null,
        h('span', { class: 'badge', text: a.source === 'online' ? 'Prenotato online' : 'Inserito dallo staff' })),
      h('div', { class: 'card', style: { boxShadow: 'none' } }, h('div', { class: 'card-b' }, a.services.map(s => h('div', { class: 'row between' }, h('span', { text: `${fmtTime(s.starts_at)} · ${s.name}` }), h('strong', { text: euro(s.price_cents) }))),
        h('div', { class: 'row between', style: { borderTop: '1px solid var(--line)', marginTop: '8px', paddingTop: '8px' } }, h('strong', { text: 'Totale' }), h('strong', { text: euro(a.total_cents) })))),
      a.customer_notes ? h('div', { class: 'alert' }, h('strong', { text: 'Note del cliente: ' }), a.customer_notes) : null,
      a.customer_profile_notes ? h('div', { class: 'alert warn' }, h('strong', { text: 'Dalla scheda cliente: ' }), a.customer_profile_notes) : null,
      h('label', { class: 'field' }, h('span', { text: 'Note interne' }), notesI),
      own ? h('div', null, h('div', { class: 'small muted', style: { marginBottom: '6px' }, text: 'Cambia stato' }), h('div', { class: 'row' }, statusBtns)) : null,
      h('div', { class: 'small muted', text: `Link cliente per gestire la prenotazione: ${a.manage_url}` }));
    const footer = [
      h('button', { class: 'btn', onclick: async () => { try { await patch(`/api/admin/appointments/${id}`, { internal_notes: notesI.value, version: a.version }); toast('Note salvate', 'ok'); m.close(); load(); } catch (e) { toastErr(e); } } }, 'Salva note'),
      editable && !['completato', 'cancellato'].includes(a.status) ? h('button', { class: 'btn', onclick: () => { m.close(); moveDialog(a); } }, 'Sposta') : null,
      can('cash.use') && state.tenant.modules.cash !== false && a.status !== 'cancellato' ? h('button', { class: 'btn primary', onclick: async () => {
        try { const sale = await post('/api/admin/sales', { appointment_id: id }); m.close(); location.hash = `#/cassa/${sale.id}`; } catch (e) { toastErr(e); }
      } }, icon('cash'), a.sale_id ? 'Apri conto' : 'Incassa') : null];
    const m = modal({ title: 'Appuntamento', body, footer });
  }

  function moveDialog(a) {
    const lp = localParts(a.starts_at);
    const f = form([{ name: 'date', label: 'Data', type: 'date', required: true }, { name: 'time', label: 'Ora', type: 'time', required: true },
      { name: 'staff_id', label: 'Operatore', type: 'select', options: S.data.staff.map(s => [s.id, s.name]), empty: false },
      { name: 'duration_min', label: 'Durata (min)', type: 'number', min: 5, step: 5 }, { name: 'notify', label: 'Avvisa il cliente', type: 'checkbox' }],
    { date: lp.date, time: lp.time, staff_id: a.staff_id, duration_min: Math.round((new Date(a.ends_at) - new Date(a.starts_at)) / 60000) });
    const save = h('button', { class: 'btn primary' }, 'Sposta');
    const m = modal({ title: 'Sposta appuntamento', body: f.el, footer: [save] });
    save.addEventListener('click', busy(save, async () => {
      const v = f.values();
      await patch(`/api/admin/appointments/${a.id}`, { date: v.date, time: v.time, staff_id: +v.staff_id, duration_min: +v.duration_min, version: a.version, notify: v.notify });
      m.close(); toast('Appuntamento spostato', 'ok'); S.date = v.date; load();
    }));
  }

  // ------------------------------------------------------------ nuovo appuntamento
  async function newAppointment(pre) {
    const staff = S.data ? S.data.staff : await cached('staff', '/api/admin/staff');
    let customer = null;
    const custBox = h('div');
    const custSearch = h('input', { type: 'search', placeholder: 'Cerca cliente per nome o telefono…' });
    const results = h('div', { class: 'stack', style: { gap: '4px', marginTop: '6px' } });
    const newFields = form([{ name: 'first_name', label: 'Nome', required: true }, { name: 'last_name', label: 'Cognome' }, { name: 'phone', label: 'Telefono', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'audience', label: 'Categoria', type: 'select', options: Object.entries(AUD) }, { name: 'consent_privacy', label: 'Informativa privacy consegnata/accettata', type: 'checkbox', default: true }]);
    let mode = 'search';
    function renderCust() {
      custBox.innerHTML = '';
      if (customer) custBox.append(h('div', { class: 'row between alert' }, h('div', null, h('strong', { text: fullName(customer) }), h('div', { class: 'small muted', text: customer.phone || customer.email || '' })), h('button', { class: 'btn sm', onclick: () => { customer = null; renderCust(); } }, 'Cambia')));
      else if (mode === 'new') custBox.append(newFields.el, h('button', { class: 'btn sm ghost', onclick: () => { mode = 'search'; renderCust(); } }, '← Cerca cliente esistente'));
      else custBox.append(custSearch, results, h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm', onclick: () => { mode = 'new'; renderCust(); } }, icon('plus'), 'Nuovo cliente'), h('span', { class: 'small muted', text: 'oppure lascia vuoto per un appuntamento senza cliente' })));
    }
    let t;
    custSearch.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = custSearch.value.trim(); results.innerHTML = '';
        if (q.length < 2) return;
        const r = await get(`/api/admin/customers?q=${encodeURIComponent(q)}&limit=8`);
        results.append(...r.rows.map(c => h('button', { class: 'pick', type: 'button', onclick: () => { customer = c; renderCust(); } }, h('strong', { text: fullName(c) }), h('small', { text: [c.phone, c.email].filter(Boolean).join(' · ') }))));
        if (!r.rows.length) results.append(h('div', { class: 'small muted', text: 'Nessun cliente trovato' }));
      }, 250);
    });
    renderCust();
    const selected = [];
    const svcList = h('div', { class: 'stack', style: { gap: '4px', maxHeight: '260px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '10px', padding: '8px' } });
    const totalEl = h('div', { class: 'small muted' });
    for (const aud of ['donna', 'uomo', 'bambino']) {
      const l = services.filter(s => s.audience === aud && s.active);
      if (!l.length) continue;
      svcList.appendChild(h('div', { class: 'small', style: { fontWeight: 700, color: 'var(--accent)', marginTop: '6px' }, text: AUD[aud] }));
      l.forEach(s => svcList.appendChild(h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => { if (e.target.checked) selected.push(s.id); else selected.splice(selected.indexOf(s.id), 1); upd(); } }), `${s.name} · ${dur(s.duration_min)} · ${euro(s.price_cents)}`)));
    }
    function upd() { const l = services.filter(s => selected.includes(s.id)); totalEl.textContent = l.length ? `Totale ${euro(l.reduce((a, s) => a + s.price_cents, 0))} · ${dur(l.reduce((a, s) => a + s.duration_min, 0))}` : ''; }
    const when = form([
      { name: 'staff_id', label: 'Operatore', type: 'select', options: staff.map(s => [s.id, s.name]), empty: false, required: true },
      { name: 'date', label: 'Data', type: 'date', required: true }, { name: 'time', label: 'Ora', type: 'time', required: true },
      { name: 'status', label: 'Stato', type: 'select', options: [['confermato', 'Confermato'], ['in_attesa', 'Da confermare'], ['arrivato', 'Arrivato']], empty: false },
      { name: 'notes', label: 'Note visibili al cliente', type: 'textarea', rows: 2 }, { name: 'internal_notes', label: 'Note interne', type: 'textarea', rows: 2 },
      { name: 'repeat', label: 'Ripeti', type: 'select', options: [['', 'Non ripetere'], ['1', 'Ogni settimana'], ['2', 'Ogni 2 settimane'], ['3', 'Ogni 3 settimane'], ['4', 'Ogni 4 settimane']], empty: false },
      { name: 'repeat_count', label: 'Numero di ripetizioni', type: 'number', min: 2, max: 26, default: 4 },
      { name: 'notify', label: 'Invia conferma al cliente (se configurato)', type: 'checkbox' },
      { name: 'ignore_absences', label: 'Ignora assenze/chiusure', type: 'checkbox' },
    ], { staff_id: pre.staff_id || (staff[0] || {}).id, date: pre.date || S.date, time: pre.time || '09:00', status: 'confermato' });
    const sugg = h('div', { class: 'row', style: { gap: '6px' } });
    const suggBtn = button('Mostra orari liberi', async () => {
      if (!selected.length) throw new Error('Seleziona prima i servizi');
      const v = when.values(); sugg.innerHTML = '';
      const r = await get(`/api/admin/availability?date=${v.date}&services=${selected.join(',')}&staff=${v.staff_id}`);
      if (!r.slots.length) sugg.append(h('span', { class: 'small muted', text: 'Nessun orario libero per questo operatore nel giorno scelto' }));
      r.slots.slice(0, 40).forEach(s => sugg.append(h('button', { class: 'btn sm', type: 'button', onclick: () => { when.inputs.time.inp.value = s.time; } }, s.time)));
    }, 'btn sm');
    const save = h('button', { class: 'btn primary' }, 'Crea appuntamento');
    const m = modal({ title: 'Nuovo appuntamento', size: 'wide', body: h('div', { class: 'grid g2' },
      h('div', { class: 'stack' }, h('h3', { text: 'Cliente' }), custBox, h('h3', { text: 'Servizi' }), svcList, totalEl),
      h('div', { class: 'stack' }, h('h3', { text: 'Quando' }), when.el, h('div', null, suggBtn, sugg))), footer: [save] });
    save.addEventListener('click', busy(save, async () => {
      if (!selected.length) throw new Error('Seleziona almeno un servizio');
      const v = when.values();
      const body = { staff_id: +v.staff_id, date: v.date, time: v.time, service_ids: selected, status: v.status, notes: v.notes, internal_notes: v.internal_notes, notify: v.notify, ignore_absences: v.ignore_absences };
      if (v.repeat) body.repeat = { every_weeks: +v.repeat, count: +v.repeat_count || 4 };
      if (customer) body.customer_id = customer.id; else if (mode === 'new') body.customer = newFields.values();
      const r = await post('/api/admin/appointments', body);
      m.close();
      toast(r.created > 1 ? `Creati ${r.created} appuntamenti` : 'Appuntamento creato', 'ok');
      if (r.skipped && r.skipped.length) toast(`Non creati (orario occupato): ${r.skipped.map(s => s.date).join(', ')}`, 'err');
      invalidate('customers');
      S.date = v.date; load();
    }));
  }

  async function showPending() {
    const list = S.data.appointments.filter(a => a.status === 'in_attesa');
    const body = h('div');
    if (!list.length) body.append(h('div', { class: 'empty', text: 'Nessuna richiesta da confermare nel periodo visualizzato' }));
    list.forEach(a => body.append(h('div', { class: 'list-row' }, h('div', { class: 'grow' }, h('strong', { text: fullName(a) }), h('div', { class: 'small muted', text: `${fmtDateTime(a.starts_at)} · ${a.services.map(s => s.name).join(', ')} · ${a.staff_name}` })),
      editable ? h('button', { class: 'btn sm primary', onclick: async () => { try { await post(`/api/admin/appointments/${a.id}/status`, { status: 'confermato', version: a.version }); toast('Confermato', 'ok'); m.close(); load(); } catch (e) { toastErr(e); } } }, 'Conferma') : null,
      h('button', { class: 'btn sm', onclick: () => { m.close(); openAppt(a.id); } }, 'Apri'))));
    const m = modal({ title: 'Da confermare', body });
  }

  function searchDialog() {
    const res = h('div');
    const m = modal({ title: 'Cerca appuntamenti', body: [searchBox('Nome o telefono del cliente', async q => {
      res.innerHTML = ''; if (q.length < 2) return;
      try {
        const list = await get(`/api/admin/appointments/search?q=${encodeURIComponent(q)}`);
        if (!list.length) res.append(h('div', { class: 'empty', text: 'Nessun risultato' }));
        list.forEach(a => res.append(h('div', { class: 'list-row', style: { cursor: 'pointer' }, onclick: () => { m.close(); S.date = localParts(a.starts_at).date; S.view = 'day'; load().then(() => openAppt(a.id)); } },
          h('div', { class: 'grow' }, h('strong', { text: fullName(a) }), h('div', { class: 'small muted', text: `${fmtDateTime(a.starts_at)} · ${a.services.map(s => s.name).join(', ')}` })), statusBadge(a.status))));
      } catch (e) { toastErr(e); }
    }), res] });
  }

  load();
  const onRemote = () => load();
  window.addEventListener('pa:appointments', onRemote);
  const poll = setInterval(load, 60000);
  return { destroy: () => { window.removeEventListener('pa:appointments', onRemote); clearInterval(poll); } };
}
