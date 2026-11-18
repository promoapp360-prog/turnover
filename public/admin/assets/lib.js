// Libreria UI del gestionale (nessuna dipendenza esterna)
export const TZ = 'Europe/Rome';
export const state = { me: null, perms: [], tenant: null, providers: {} };

// append()/prepend() nativi trasformano null/false in testo: qui vengono ignorati (come in h())
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const m of ['append', 'prepend']) {
    const orig = proto[m];
    proto[m] = function (...nodes) { return orig.apply(this, nodes.flat(Infinity).filter(n => n !== null && n !== undefined && n !== false)); };
  }
}

export function can(p) { return state.perms.includes('*') || state.perms.includes(p); }

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  cash: 'M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 12h.01M18 12h.01',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  plus: 'M12 5v14M5 12h14', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  chevL: 'M15 18l-6-6 6-6', chevR: 'M9 18l6-6-6-6', x: 'M18 6 6 18M6 6l12 12', menu: 'M3 6h18M3 12h18M3 18h18',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9', moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  whatsapp: 'M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.5A8.4 8.4 0 1 1 21 11.5z', phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z', external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
};
export function icon(name, cls = 'ic') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[name] || ''); s.appendChild(p);
  return s;
}

// ---------------- API ----------------
export async function api(method, url, body, opts = {}) {
  const headers = { 'X-Requested-With': 'PromoApp' };
  let payload = body;
  if (body !== undefined && !(body instanceof Blob)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (body instanceof Blob) headers['Content-Type'] = body.type;
  const r = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  if (r.status === 401 && !opts.noAuthRedirect) { location.hash = '#/login'; throw Object.assign(new Error('Sessione scaduta: accedi di nuovo'), { status: 401 }); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) throw Object.assign(new Error((data && data.error) || `Errore ${r.status}`), { status: r.status, details: data && data.details });
  return data;
}
export const get = url => api('GET', url);
export const post = (url, b) => api('POST', url, b || {});
export const put = (url, b) => api('PUT', url, b || {});
export const patch = (url, b) => api('PATCH', url, b || {});
export const del = url => api('DELETE', url);

// ---------------- formattazione ----------------
export const euro = c => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format((c || 0) / 100);
export const euroIn = c => ((c || 0) / 100).toFixed(2).replace('.', ',');
export const num = n => new Intl.NumberFormat('it-IT').format(n || 0);
export function localParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export const today = () => localParts(new Date()).date;
export const fmtDate = (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => d ? new Intl.DateTimeFormat('it-IT', { timeZone: TZ, ...o }).format(typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00Z') : new Date(d)) : '';
export const fmtDateTime = d => d ? new Intl.DateTimeFormat('it-IT', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '';
export const fmtTime = d => d ? localParts(d).time : '';
export const longDate = d => new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'));
export function addDays(d, n) { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); }
export const weekday = d => new Date(d + 'T00:00:00Z').getUTCDay();
export const toMin = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
export const minToT = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
export const dur = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
export const fullName = o => [o.first_name, o.last_name].filter(Boolean).join(' ') || '—';
export const STATUS = {
  in_attesa: ['Da confermare', 'warn'], confermato: ['Confermato', 'info'], arrivato: ['Arrivato', 'ok'], in_lavorazione: ['In lavorazione', 'ok'],
  completato: ['Completato', ''], cancellato: ['Cancellato', 'err'], assente: ['Non presentato', 'err'],
};
export const statusBadge = s => h('span', { class: `badge ${(STATUS[s] || ['', ''])[1]}` }, (STATUS[s] || [s])[0]);
export const AUD = { donna: 'Donna', uomo: 'Uomo', bambino: 'Bambino' };

export function pref(k, v) {
  try { if (v === undefined) return JSON.parse(localStorage.getItem('pa_' + k)); localStorage.setItem('pa_' + k, JSON.stringify(v)); } catch { return null; }
}

// ---------------- toast / modal ----------------
export function toast(msg, type = '') {
  const t = h('div', { class: `toast ${type}`, role: 'status' }, msg);
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3200);
}
export function toastErr(e) { if (e && e.status !== 401) toast(e.message || 'Errore', 'err'); }

export function modal({ title, body, footer, size = '', onClose }) {
  const close = () => { bg.remove(); document.removeEventListener('keydown', esc); onClose && onClose(); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-h' }, h('h2', { text: title }), h('button', { class: 'btn ghost icon', 'aria-label': 'Chiudi', onclick: close }, icon('x'))),
    h('div', { class: 'modal-b' }, body), footer ? h('div', { class: 'modal-f' }, footer) : null);
  const bg = h('div', { class: 'modal-bg', onmousedown: e => { if (e.target === bg) close(); } }, box);
  document.body.appendChild(bg);
  document.addEventListener('keydown', esc);
  setTimeout(() => { const f = box.querySelector('input:not([type=hidden]),select,textarea'); if (f && window.innerWidth > 700) f.focus(); }, 30);
  return { close, el: box };
}
export function confirmDialog(message, { ok = 'Conferma', danger = false } = {}) {
  return new Promise(res => {
    let done = false;
    const m = modal({ title: 'Conferma', size: 'narrow', body: h('p', { text: message }), onClose: () => { if (!done) res(false); },
      footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Annulla'), h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { done = true; m.close(); res(true); } }, ok)] });
  });
}
export function promptDialog(title, label, def = '') {
  return new Promise(res => {
    let done = false;
    const inp = h('input', { type: 'text', value: def });
    const m = modal({ title, size: 'narrow', body: h('label', { class: 'field' }, h('span', { text: label }), inp), onClose: () => { if (!done) res(null); },
      footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Annulla'), h('button', { class: 'btn primary', onclick: () => { done = true; m.close(); res(inp.value); } }, 'OK')] });
  });
}

// pulsante con stato di caricamento
export function busy(btn, fn) {
  return async (...args) => {
    if (btn.disabled) return;
    btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = ''; btn.appendChild(h('span', { class: 'spinner' }));
    try { return await fn(...args); } catch (e) { toastErr(e); } finally { btn.disabled = false; btn.innerHTML = old; }
  };
}
export function button(label, fn, cls = 'btn') {
  const b = h('button', { class: cls, type: 'button' }, label);
  b.addEventListener('click', busy(b, fn));
  return b;
}

// ---------------- form builder ----------------
// campo: {name,label,type,options,required,full,hint,placeholder,min,max,step}
export function form(fields, values = {}) {
  const inputs = {};
  const wrap = h('div', { class: 'form-grid' });
  for (const f of fields) {
    if (f.type === 'section') { wrap.appendChild(h('h3', { class: 'full', style: { marginTop: '8px' }, text: f.label })); continue; }
    const v = values[f.name];
    let inp;
    switch (f.type) {
      case 'textarea': inp = h('textarea', { rows: f.rows || 3, placeholder: f.placeholder }); inp.value = v ?? ''; break;
      case 'select': inp = h('select', null, (f.empty !== false ? [h('option', { value: '' }, f.emptyLabel || '—')] : []), (f.options || []).map(([ov, ol]) => h('option', { value: ov }, ol)));
        inp.value = v === null || v === undefined ? '' : String(v); break;
      case 'checkbox': inp = h('input', { type: 'checkbox', checked: v === undefined ? !!f.default : !!v }); break;
      case 'money': inp = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', value: v === null || v === undefined ? '' : euroIn(v) }); break;
      case 'number': inp = h('input', { type: 'number', min: f.min, max: f.max, step: f.step || 'any', value: v ?? (f.default ?? '') }); break;
      case 'date': inp = h('input', { type: 'date', value: v || '' }); break;
      case 'datetime': inp = h('input', { type: 'datetime-local', value: v ? (typeof v === 'string' && v.length === 16 ? v : localParts(v).date + 'T' + localParts(v).time) : '' }); break;
      case 'color': inp = h('input', { type: 'color', value: v || f.default || '#b0835a' }); break;
      case 'multi': {
        const sel = new Set((v || []).map(String));
        inp = h('div', { class: 'stack', style: { maxHeight: '220px', overflow: 'auto', gap: '6px', border: '1px solid var(--line)', borderRadius: '10px', padding: '10px' } },
          (f.options || []).map(([ov, ol]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: ov, checked: sel.has(String(ov)) }), ol)));
        inp.getValue = () => [...inp.querySelectorAll('input:checked')].map(x => +x.value);
        break;
      }
      case 'image': {
        const url = h('input', { type: 'text', value: v || '', placeholder: 'https://… oppure carica' });
        const prev = h('img', { src: v || '', alt: '', style: { width: '64px', height: '64px', objectFit: 'cover', borderRadius: '10px', display: v ? 'block' : 'none', background: 'var(--panel2)' } });
        const file = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
        file.addEventListener('change', async () => {
          if (!file.files[0]) return;
          try { const r = await uploadImage(file.files[0]); url.value = r.url; prev.src = r.url; prev.style.display = 'block'; toast('Immagine caricata', 'ok'); } catch (e) { toastErr(e); }
        });
        url.addEventListener('input', () => { prev.src = url.value; prev.style.display = url.value ? 'block' : 'none'; });
        inp = h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, prev, url, h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Carica'), file);
        inp.getValue = () => url.value.trim();
        break;
      }
      case 'password': inp = h('input', { type: 'password', autocomplete: 'new-password', placeholder: f.placeholder }); break;
      default: inp = h('input', { type: f.type || 'text', value: v ?? '', placeholder: f.placeholder, maxlength: f.max });
    }
    if (f.required && inp.setAttribute) inp.setAttribute('required', '');
    inputs[f.name] = { f, inp };
    const cls = `field${f.full || ['textarea', 'multi', 'image'].includes(f.type) ? ' full' : ''}`;
    if (f.type === 'checkbox') wrap.appendChild(h('label', { class: `check${f.full ? ' full' : ''}` }, inp, f.label));
    else wrap.appendChild(h('label', { class: cls }, h('span', { text: f.label + (f.required ? ' *' : '') }), inp, f.hint ? h('small', { class: 'hint', text: f.hint }) : null));
  }
  return {
    el: wrap, inputs,
    values() {
      const out = {};
      for (const [k, { f, inp }] of Object.entries(inputs)) {
        if (inp.getValue) out[k] = inp.getValue();
        else if (f.type === 'checkbox') out[k] = inp.checked;
        else out[k] = inp.value === '' ? (f.type === 'number' || f.type === 'select' ? null : '') : inp.value;
        if (f.required && (out[k] === '' || out[k] === null)) throw Object.assign(new Error(`Compila il campo “${f.label}”`), { field: k });
      }
      return out;
    },
  };
}

export async function uploadImage(file, priv = false) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Immagine troppo grande (max 5 MB)');
  const blob = await resizeImage(file, 1800);
  return api('POST', '/api/admin/media' + (priv ? '?private=1' : ''), blob);
}
async function resizeImage(file, max) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5e6) return file;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', 0.85));
  } catch { return file; }
}

// form in modale con salvataggio
export function formModal({ title, fields, values, onSave, size, extra, deleteFn }) {
  const f = form(fields, values || {});
  const save = h('button', { class: 'btn primary' }, 'Salva');
  const m = modal({ title, size, body: [f.el, extra || null],
    footer: [deleteFn ? h('button', { class: 'btn danger', style: { marginRight: 'auto' }, onclick: async () => { if (await confirmDialog('Eliminare definitivamente?', { danger: true, ok: 'Elimina' })) { try { await deleteFn(); m.close(); toast('Eliminato'); } catch (e) { toastErr(e); } } } }, icon('trash'), 'Elimina') : null,
      h('button', { class: 'btn', onclick: () => m.close() }, 'Annulla'), save] });
  save.addEventListener('click', busy(save, async () => { const v = f.values(); await onSave(v); m.close(); toast('Salvato', 'ok'); }));
  return m;
}

// ---------------- tabella ----------------
// cols: [{label, key | render(row), class}]
export function table(cols, rows, { onRow, empty = 'Nessun dato' } = {}) {
  if (!rows.length) return h('div', { class: 'empty', text: empty });
  return h('div', { class: 'table-wrap' }, h('table', { class: 't' },
    h('thead', null, h('tr', null, cols.map(c => h('th', { class: c.class || '' }, c.label)))),
    h('tbody', null, rows.map(r => h('tr', { class: onRow ? 'click' : '', onclick: onRow ? () => onRow(r) : null },
      cols.map(c => h('td', { class: c.class || '' }, c.render ? c.render(r) : (r[c.key] ?? ''))))))));
}
export function searchBox(placeholder, onInput, value = '') {
  let t;
  const inp = h('input', { type: 'search', placeholder, value, oninput: () => { clearTimeout(t); t = setTimeout(() => onInput(inp.value.trim()), 250); } });
  return h('div', { class: 'search' }, icon('search'), inp);
}
export function tabs(list, current, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' }, list.map(([k, l]) => h('button', { class: k === current ? 'on' : '', role: 'tab', 'aria-selected': String(k === current), onclick: () => onChange(k) }, l)));
}
export function card(title, body, actions) {
  return h('section', { class: 'card' }, title || actions ? h('div', { class: 'card-h' }, h('h2', { text: title || '' }), actions || null) : null, h('div', { class: 'card-b' }, body));
}
export function kpi(label, value, sub) { return h('div', { class: 'card kpi' }, h('div', { class: 'lbl', text: label }), h('div', { class: 'val', text: value }), sub ? h('div', { class: 'sub' }, sub) : null); }
export function loading() { return h('div', { class: 'loading' }, h('span', { class: 'spinner' })); }

// ---------------- grafici SVG ----------------
export function lineChart(points, { height = 220, format = v => v } = {}) {
  const W = 760, H = height, P = { l: 52, r: 12, t: 12, b: 26 };
  const max = Math.max(1, ...points.map(p => p.v));
  const x = i => P.l + (points.length < 2 ? 0 : i * (W - P.l - P.r) / (points.length - 1));
  const y = v => H - P.b - v / max * (H - P.t - P.b);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img');
  const add = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.appendChild(e); return e; };
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4; add('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), stroke: 'var(--line)', 'stroke-width': 1 });
    const t = add('text', { x: P.l - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }); t.textContent = format(v);
  }
  if (!points.length) return svg;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  add('path', { d: `${d}L${x(points.length - 1)},${H - P.b}L${x(0)},${H - P.b}Z`, fill: 'var(--accent)', opacity: .12 });
  add('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.2, 'stroke-linejoin': 'round' });
  const step = Math.ceil(points.length / 8);
  points.forEach((p, i) => {
    if (i % step === 0 || i === points.length - 1) { const t = add('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }); t.textContent = p.label || p.d; }
    const c = add('circle', { cx: x(i), cy: y(p.v), r: points.length > 40 ? 0 : 3, fill: 'var(--accent)' });
    const tt = document.createElementNS(ns, 'title'); tt.textContent = `${p.d}: ${format(p.v)}`; c.appendChild(tt);
    const hit = add('rect', { x: x(i) - 6, y: P.t, width: 12, height: H - P.t - P.b, fill: 'transparent' });
    const t2 = document.createElementNS(ns, 'title'); t2.textContent = `${p.d}: ${format(p.v)}`; hit.appendChild(t2);
  });
  return h('div', { class: 'chart' }, svg);
}
export function barList(items, { value = i => i.v, label = i => i.label, format = v => v } = {}) {
  if (!items.length) return h('div', { class: 'empty', text: 'Nessun dato nel periodo' });
  const max = Math.max(1, ...items.map(value));
  return h('div', { class: 'bars' }, items.map(i => h('div', { class: 'bar-row' }, h('span', { text: label(i) }), h('strong', { class: 'mono', text: format(value(i)) }),
    h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: `${Math.max(2, value(i) / max * 100)}%`, background: i.color || 'var(--accent)' } })))));
}

// ---------------- download ----------------
export async function download(url, filename) {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) { let m = 'Download non riuscito'; try { m = (await r.json()).error || m; } catch { /* */ } throw new Error(m); }
  const blob = await r.blob();
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click(); a.remove();
}

// cache semplice per anagrafiche usate spesso
const cache = {};
export async function cached(key, url, ttl = 60000) {
  const c = cache[key];
  if (c && c.exp > Date.now()) return c.data;
  const data = await get(url);
  cache[key] = { data, exp: Date.now() + ttl };
  return data;
}
export function invalidate(key) { if (key) delete cache[key]; else Object.keys(cache).forEach(k => delete cache[k]); }
