// Prenotazione online e gestione prenotazione (cliente)
(function () {
  'use strict';
  var AUD = { donna: 'Donna', uomo: 'Uomo', bambino: 'Bambino' };
  var WD = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  var MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function euro(c) { return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format((c || 0) / 100); }
  function dur(m) { return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min'; }
  function addDays(d, n) { var p = d.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
  function dObj(d) { var p = d.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  function longDate(d) { return new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dObj(d)); }
  function api(method, url, body) {
    return fetch(url, { method: method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'PromoApp' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error(d.error || 'Errore di rete'); e.status = r.status; throw e; } return d; }); });
  }

  // ------------------------------------------------------------------ prenotazione
  function BookingApp(root) {
    var S = { step: 1, audience: null, services: [], staff: null, date: null, time: null, days: [], daysFrom: null, slots: null, cat: null, busy: false, error: null };
    var params = new URLSearchParams(location.search);

    function selected() { return S.cat.services.filter(function (s) { return S.services.indexOf(s.id) >= 0; }); }
    function totals() { var l = selected(); return { price: l.reduce(function (a, s) { return a + s.price_cents; }, 0), dur: l.reduce(function (a, s) { return a + s.duration_min; }, 0), from: l.some(function (s) { return s.price_from; }) }; }
    function eligibleStaff() { return S.cat.staff.filter(function (m) { return !m.service_ids.length || S.services.every(function (id) { return m.service_ids.indexOf(id) >= 0; }); }); }
    function hasStaffStep() { return S.cat.booking.allow_staff_choice && eligibleStaff().length > 1; }

    function stepsBar() { var n = hasStaffStep() ? 4 : 3; var cur = S.step > 2 && !hasStaffStep() ? S.step - 1 : S.step; var bar = h('div', { class: 'steps', 'aria-hidden': 'true' }); for (var i = 1; i <= n; i++) bar.appendChild(h('span', { class: i <= cur ? 'on' : '' })); return bar; }
    function errBox() { return S.error ? h('div', { class: 'alert', role: 'alert', text: S.error }) : null; }

    function render() {
      root.innerHTML = '';
      if (!S.cat) { root.appendChild(h('div', { class: 'loading', text: 'Caricamento…' })); return; }
      if (!S.cat.booking.enabled) { root.appendChild(h('div', { class: 'alert info', text: 'Le prenotazioni online sono momentaneamente disattivate.' })); return; }
      if (S.step === 1) return stepServices();
      if (S.step === 2) return stepStaff();
      if (S.step === 3) return stepWhen();
      if (S.step === 4) return stepDetails();
      if (S.step === 5) return stepDone();
    }

    function stepServices() {
      var auds = ['donna', 'uomo', 'bambino'].filter(function (a) { return S.cat.services.some(function (s) { return s.audience === a && s.online_bookable; }); });
      if (!S.audience) S.audience = auds[0];
      var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Per chi è il servizio' }, auds.map(function (a) {
        return h('button', { type: 'button', 'aria-pressed': String(S.audience === a), onclick: function () { S.audience = a; S.services = []; render(); } }, AUD[a]);
      }));
      var list = h('div');
      var cats = S.cat.categories.filter(function (c) { return c.audience === S.audience; }).concat([{ id: null, name: 'Altri servizi' }]);
      cats.forEach(function (c) {
        var items = S.cat.services.filter(function (s) { return s.audience === S.audience && s.online_bookable && (s.category_id === c.id || (c.id === null && !S.cat.categories.some(function (k) { return k.id === s.category_id; }))); });
        if (!items.length) return;
        list.appendChild(h('div', { class: 'svc-cat', text: c.name }));
        items.forEach(function (s) {
          var on = S.services.indexOf(s.id) >= 0;
          var cb = h('input', { type: 'checkbox', checked: on, 'aria-label': s.name });
          var row = h('label', { class: 'svc' + (on ? ' sel' : '') }, cb, h('div', { class: 'grow' }, h('div', null, h('strong', { text: s.name })), h('div', { class: 'meta', text: dur(s.duration_min) + (s.description ? ' · ' + s.description : '') })), h('strong', { text: (s.price_from ? 'da ' : '') + euro(s.price_cents) }));
          cb.addEventListener('change', function () { if (cb.checked) S.services.push(s.id); else S.services = S.services.filter(function (x) { return x !== s.id; }); render(); });
          list.appendChild(row);
        });
      });
      var t = totals();
      root.append(stepsBar(), h('div', { class: 'step-title', text: 'Scegli i servizi' }), h('p', { class: 'muted', text: 'Puoi selezionarne più di uno: verranno eseguiti uno dopo l’altro.' }), seg, list,
        h('div', { class: 'summary-bar' }, h('div', null, S.services.length ? [h('strong', { text: (t.from ? 'da ' : '') + euro(t.price) }), h('div', { class: 'small muted', text: 'Durata ' + dur(t.dur) })] : h('span', { class: 'muted', text: 'Nessun servizio selezionato' })),
          h('button', { class: 'btn btn-primary', disabled: !S.services.length, onclick: function () { S.step = hasStaffStep() ? 2 : 3; if (!hasStaffStep()) S.staff = null; S.date = null; S.time = null; S.days = []; render(); if (S.step === 3) loadDays(); } }, 'Continua')));
    }

    function stepStaff() {
      var list = eligibleStaff();
      var box = h('div', { class: 'staff-list' }, h('button', { type: 'button', class: 'staff-opt', 'aria-pressed': String(!S.staff), onclick: function () { S.staff = null; render(); } }, h('div', { class: 'av', text: '★' }), h('strong', { text: 'Nessuna preferenza' }), h('div', { class: 'small muted', text: 'Primo disponibile' })));
      list.forEach(function (m) {
        box.appendChild(h('button', { type: 'button', class: 'staff-opt', 'aria-pressed': String(S.staff === m.id), onclick: function () { S.staff = m.id; render(); } },
          h('div', { class: 'av' }, m.photo_url ? h('img', { src: m.photo_url, alt: '' }) : m.name.slice(0, 1)), h('strong', { text: m.name }), m.role_title ? h('div', { class: 'small muted', text: m.role_title }) : null));
      });
      root.append(stepsBar(), h('div', { class: 'step-title', text: 'Con chi?' }), box,
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost', onclick: function () { S.step = 1; render(); } }, '← Indietro'), h('button', { class: 'btn btn-primary', onclick: function () { S.step = 3; S.date = null; S.time = null; S.days = []; render(); loadDays(); } }, 'Continua')));
    }

    function loadDays(more) {
      var from = more ? addDays(S.days[S.days.length - 1].date, 1) : S.cat.today;
      var q = '/api/public/days?from=' + from + '&days=14&services=' + S.services.join(',') + (S.staff ? '&staff=' + S.staff : '');
      S.loadingDays = true;
      api('GET', q).then(function (r) {
        S.days = more ? S.days.concat(r.days) : r.days; S.loadingDays = false;
        if (!S.date) { var first = S.days.find(function (d) { return d.available; }); if (first) { S.date = first.date; loadSlots(); } }
        render();
      }).catch(function (e) { S.loadingDays = false; S.error = e.message; render(); });
    }
    function loadSlots() {
      S.slots = null; S.time = null;
      api('GET', '/api/public/availability?date=' + S.date + '&services=' + S.services.join(',') + (S.staff ? '&staff=' + S.staff : ''))
        .then(function (r) { S.slots = r.slots; render(); }).catch(function (e) { S.error = e.message; render(); });
    }

    function stepWhen() {
      var strip = h('div', { class: 'days', role: 'group', 'aria-label': 'Giorni' });
      S.days.forEach(function (d) {
        var o = dObj(d.date);
        strip.appendChild(h('button', { type: 'button', class: 'day', disabled: !d.available, 'aria-pressed': String(S.date === d.date), 'aria-label': longDate(d.date) + (d.available ? '' : ' – non disponibile'),
          onclick: function () { S.date = d.date; S.error = null; loadSlots(); render(); } }, h('small', { text: WD[o.getUTCDay()] }), h('b', { text: String(o.getUTCDate()) }), h('small', { text: MONTHS[o.getUTCMonth()] })));
      });
      var maxDate = addDays(S.cat.today, S.cat.booking.max_advance_days);
      if (S.days.length && S.days[S.days.length - 1].date < maxDate) strip.appendChild(h('button', { type: 'button', class: 'day', onclick: function () { loadDays(true); } }, h('small', { text: 'altri' }), h('b', { text: '→' }), h('small', { text: 'giorni' })));
      var times = h('div');
      if (S.loadingDays && !S.days.length) times.appendChild(h('div', { class: 'loading', text: 'Cerco le disponibilità…' }));
      else if (S.days.length && !S.days.some(function (d) { return d.available; })) times.appendChild(waitlistBox('Nessuna disponibilità nei prossimi giorni.'));
      else if (S.date) {
        times.appendChild(h('h3', { text: longDate(S.date) }));
        if (S.slots === null) times.appendChild(h('div', { class: 'loading', text: 'Carico gli orari…' }));
        else if (!S.slots.length) times.appendChild(h('p', { class: 'muted', text: 'Nessun orario libero in questo giorno.' }));
        else {
          var parts = [['Mattina', function (t) { return t < '13:00'; }], ['Pomeriggio', function (t) { return t >= '13:00'; }]];
          parts.forEach(function (p) {
            var l = S.slots.filter(function (s) { return p[1](s.time); });
            if (!l.length) return;
            times.appendChild(h('div', { class: 'svc-cat', text: p[0] }));
            times.appendChild(h('div', { class: 'times' }, l.map(function (s) { return h('button', { type: 'button', class: 'time', 'aria-pressed': String(S.time === s.time), onclick: function () { S.time = s.time; render(); } }, s.time); })));
          });
        }
      }
      root.append(stepsBar(), h('div', { class: 'step-title', text: 'Quando?' }), h('p', { class: 'muted', text: 'Vedi solo gli orari realmente disponibili.' }), errBox(), strip, times,
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost', onclick: function () { S.step = hasStaffStep() ? 2 : 1; render(); } }, '← Indietro'),
          h('button', { class: 'btn btn-primary', disabled: !S.time, onclick: function () { S.step = 4; S.error = null; render(); } }, 'Continua')));
    }

    function waitlistBox(msg) {
      var done = S.waitDone;
      if (done) return h('div', { class: 'alert ok', text: 'Sei in lista d’attesa: ti avviseremo appena si libera un posto.' });
      var box = h('div', { class: 'recap' }, h('p', null, h('strong', { text: msg }), ' Lasciaci i tuoi dati: ti avvisiamo se si libera un posto.'));
      var form = detailsForm(function (data) {
        api('POST', '/api/public/waitlist', Object.assign(data, { services: S.services, staff_id: S.staff, date_from: S.cat.today, date_to: addDays(S.cat.today, 14) }))
          .then(function () { S.waitDone = true; render(); }).catch(function (e) { S.error = e.message; render(); });
      }, 'Entra in lista d’attesa', true);
      box.appendChild(form);
      return box;
    }

    function detailsForm(onSubmit, label, compact) {
      var f = h('form', { novalidate: true });
      function field(name, lab, type, req, auto) { return h('div', { class: 'field' }, h('label', { for: 'f_' + name, text: lab + (req ? ' *' : '') }), h('input', { id: 'f_' + name, name: name, type: type || 'text', required: req, autocomplete: auto || 'off' })); }
      f.append(h('div', { class: 'grid2' }, field('first_name', 'Nome', 'text', true, 'given-name'), field('last_name', 'Cognome', 'text', !compact, 'family-name')),
        h('div', { class: 'grid2' }, field('phone', 'Telefono', 'tel', true, 'tel'), field('email', 'Email', 'email', false, 'email')),
        compact ? null : h('div', { class: 'field' }, h('label', { for: 'f_notes', text: 'Note per il salone' }), h('textarea', { id: 'f_notes', name: 'notes', rows: '2', maxlength: '500' })),
        h('input', { class: 'hp', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'consent_privacy', required: true }), h('span', null, 'Ho letto l’', h('a', { href: '/privacy', target: '_blank', text: 'informativa privacy' }), ' e acconsento al trattamento dei dati per gestire la prenotazione. *')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'consent_marketing' }), h('span', { text: 'Desidero ricevere offerte e auguri (facoltativo).' })),
        h('button', { class: 'btn btn-primary btn-lg', type: 'submit', disabled: S.busy, style: 'width:100%;margin-top:8px' }, S.busy ? 'Invio in corso…' : label));
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var fd = new FormData(f); var data = {};
        fd.forEach(function (v, k) { data[k] = v; });
        data.consent_privacy = !!f.consent_privacy.checked; data.consent_marketing = !!f.consent_marketing.checked;
        if (!data.first_name || !data.phone || (!compact && !data.last_name)) { S.error = 'Compila i campi obbligatori'; render(); return; }
        if (!data.consent_privacy) { S.error = 'Per prenotare è necessario accettare l’informativa privacy'; render(); return; }
        onSubmit(data);
      });
      return f;
    }

    function stepDetails() {
      var t = totals();
      var st = S.staff ? S.cat.staff.find(function (m) { return m.id === S.staff; }) : null;
      var recap = h('div', { class: 'recap' }, h('dl', null, h('dt', { text: 'Servizi' }), h('dd', { text: selected().map(function (s) { return s.name; }).join(', ') }),
        h('dt', { text: 'Quando' }), h('dd', { text: longDate(S.date) + ' alle ' + S.time }), h('dt', { text: 'Con' }), h('dd', { text: st ? st.name : 'Primo disponibile' }),
        h('dt', { text: 'Totale' }), h('dd', { text: (t.from ? 'da ' : '') + euro(t.price) + ' · ' + dur(t.dur) })));
      var form = detailsForm(function (data) {
        S.busy = true; S.error = null; render();
        api('POST', '/api/public/book', Object.assign(data, { date: S.date, time: S.time, services: S.services, staff_id: S.staff, audience: S.audience }))
          .then(function (r) { S.busy = false; S.result = r; S.step = 5; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); })
          .catch(function (e) {
            S.busy = false; S.error = e.message;
            if (e.status === 409) { S.step = 3; S.time = null; loadSlots(); }
            render();
          });
      }, 'Conferma prenotazione');
      root.append(stepsBar(), h('div', { class: 'step-title', text: 'I tuoi dati' }), recap, errBox(), form,
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost', onclick: function () { S.step = 3; render(); } }, '← Cambia orario')),
        h('p', { class: 'small muted', text: S.cat.booking.terms }));
    }

    function stepDone() {
      var r = S.result; var b = r.booking;
      var link = location.origin + '/prenotazione/' + r.token;
      root.append(h('div', { class: 'center' }, h('div', { class: 'success-ic', text: '✓' }), h('div', { class: 'step-title', text: b.status === 'in_attesa' ? 'Richiesta inviata!' : 'Prenotazione confermata!' }),
        h('p', { class: 'muted', text: b.status === 'in_attesa' ? 'Il salone confermerà a breve il tuo appuntamento.' : 'Ti aspettiamo!' })),
        h('div', { class: 'recap' }, h('dl', null, h('dt', { text: 'Quando' }), h('dd', { text: longDate(b.date) + ' alle ' + b.time }), h('dt', { text: 'Servizi' }), h('dd', { text: b.services.map(function (s) { return s.name; }).join(', ') }),
          h('dt', { text: 'Con' }), h('dd', { text: b.staff || '' }), h('dt', { text: 'Totale' }), h('dd', { text: euro(b.total_cents) }))),
        h('p', null, 'Salva questo link per spostare o annullare la prenotazione: ', h('a', { href: link, text: 'gestisci prenotazione' })),
        h('div', { class: 'actions' }, h('a', { class: 'btn btn-ghost', href: '/' }, 'Torna al sito'), h('a', { class: 'btn btn-primary', href: link }, 'Gestisci prenotazione')));
      try { localStorage.setItem('pa_last_booking', r.token); } catch (e) { /* storage non disponibile */ }
    }

    api('GET', '/api/public/catalog').then(function (cat) {
      S.cat = cat;
      var pre = parseInt(params.get('servizio'), 10);
      var svc = cat.services.find(function (s) { return s.id === pre && s.online_bookable; });
      if (svc) { S.audience = svc.audience; S.services = [svc.id]; }
      render();
    }).catch(function (e) { root.innerHTML = ''; root.appendChild(h('div', { class: 'alert', text: e.message })); });
    render();
  }

  // ------------------------------------------------------------------ gestione prenotazione
  function ManageApp(root) {
    var token = location.pathname.split('/').pop();
    var S = { b: null, mode: 'view', error: null, ok: null, date: null, slots: null, time: null };
    function load() { api('GET', '/api/public/booking/' + token).then(function (b) { S.b = b; render(); }).catch(function (e) { S.error = e.message; render(); }); }
    var STATUS = { in_attesa: 'In attesa di conferma', confermato: 'Confermata', arrivato: 'In salone', in_lavorazione: 'In corso', completato: 'Completata', cancellato: 'Annullata', assente: 'Non presentato' };
    function render() {
      root.innerHTML = '';
      if (!S.b) { root.appendChild(S.error ? h('div', { class: 'alert', text: S.error }) : h('div', { class: 'loading', text: 'Caricamento…' })); return; }
      var b = S.b;
      root.append(h('div', { class: 'step-title', text: 'Ciao ' + (b.customer_first_name || '') + '!' }), S.ok ? h('div', { class: 'alert ok', text: S.ok }) : null, S.error ? h('div', { class: 'alert', text: S.error }) : null,
        h('div', { class: 'recap' }, h('dl', null, h('dt', { text: 'Stato' }), h('dd', { text: STATUS[b.status] || b.status }), h('dt', { text: 'Quando' }), h('dd', { text: longDate(b.date) + ' alle ' + b.time }),
          h('dt', { text: 'Servizi' }), h('dd', { text: b.services.map(function (s) { return s.name; }).join(', ') }), h('dt', { text: 'Con' }), h('dd', { text: b.staff || '' }), h('dt', { text: 'Totale' }), h('dd', { text: euro(b.total_cents) }))));
      if (!b.editable) {
        if (['in_attesa', 'confermato'].indexOf(b.status) >= 0) root.appendChild(h('div', { class: 'alert info', text: 'Non è più possibile modificare online questa prenotazione. Per qualsiasi necessità contatta il salone.' }));
        root.appendChild(h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '/prenota' }, 'Nuova prenotazione'), h('a', { class: 'btn btn-ghost', href: '/' }, 'Torna al sito')));
        return;
      }
      if (S.mode === 'view') {
        root.appendChild(h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost', onclick: function () { if (confirmBox()) cancel(); } }, 'Annulla prenotazione'),
          h('button', { class: 'btn btn-primary', onclick: function () { S.mode = 'move'; S.date = b.date; S.ok = null; loadSlots(); render(); } }, 'Sposta appuntamento')));
        return;
      }
      var today = new Date().toISOString().slice(0, 10);
      var strip = h('div', { class: 'days' });
      for (var i = 0; i < 21; i++) { (function (d) { var o = dObj(d); strip.appendChild(h('button', { type: 'button', class: 'day', 'aria-pressed': String(S.date === d), onclick: function () { S.date = d; loadSlots(); render(); } }, h('small', { text: WD[o.getUTCDay()] }), h('b', { text: String(o.getUTCDate()) }), h('small', { text: MONTHS[o.getUTCMonth()] }))); })(addDays(today, i)); }
      var t = h('div');
      if (S.slots === null) t.appendChild(h('div', { class: 'loading', text: 'Carico gli orari…' }));
      else if (!S.slots.length) t.appendChild(h('p', { class: 'muted', text: 'Nessun orario disponibile in questo giorno.' }));
      else t.appendChild(h('div', { class: 'times' }, S.slots.map(function (s) { return h('button', { type: 'button', class: 'time', 'aria-pressed': String(S.time === s.time), onclick: function () { S.time = s.time; render(); } }, s.time); })));
      root.append(h('h3', { text: 'Scegli il nuovo orario' }), strip, t, h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost', onclick: function () { S.mode = 'view'; render(); } }, 'Indietro'),
        h('button', { class: 'btn btn-primary', disabled: !S.time, onclick: move }, 'Conferma nuovo orario')));
    }
    function confirmBox() { return window.confirm('Vuoi davvero annullare la prenotazione?'); }
    function loadSlots() { S.slots = null; S.time = null; api('GET', '/api/public/booking/' + token + '/availability?date=' + S.date).then(function (r) { S.slots = r.slots; render(); }).catch(function (e) { S.error = e.message; render(); }); }
    function cancel() { api('POST', '/api/public/booking/' + token + '/cancel').then(function (b) { S.b = b; S.ok = 'Prenotazione annullata. Speriamo di vederti presto!'; S.error = null; render(); }).catch(function (e) { S.error = e.message; render(); }); }
    function move() { api('POST', '/api/public/booking/' + token + '/reschedule', { date: S.date, time: S.time }).then(function (b) { S.b = b; S.mode = 'view'; S.ok = 'Appuntamento spostato!'; S.error = null; render(); }).catch(function (e) { S.error = e.message; if (e.status === 409) loadSlots(); render(); }); }
    load(); render();
  }

  var b = document.getElementById('booking-app'); if (b) BookingApp(b);
  var m = document.getElementById('manage-app'); if (m) ManageApp(m);
})();
