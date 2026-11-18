import { h, icon, api, get, post, state, can, toast, toastErr, pref, modal, busy } from './lib.js';

const PAGES = [
  { path: 'dashboard', label: 'Dashboard', icon: 'home', perm: 'dashboard.view', mod: () => import('./pages/dashboard.js') },
  { path: 'agenda', label: 'Agenda', icon: 'calendar', perm: 'agenda.view', mod: () => import('./pages/agenda.js') },
  { path: 'clienti', label: 'Clienti', icon: 'users', perm: 'clients.view', mod: () => import('./pages/clients.js') },
  { path: 'cassa', label: 'Cassa', icon: 'cash', perm: 'cash.use', module: 'cash', mod: () => import('./pages/cash.js') },
  { sep: 'Gestione' },
  { path: 'servizi', label: 'Servizi e listino', icon: 'scissors', perm: 'services.manage', mod: () => import('./pages/services.js') },
  { path: 'staff', label: 'Staff e turni', icon: 'user', perm: 'staff.manage', mod: () => import('./pages/staff.js') },
  { path: 'magazzino', label: 'Magazzino', icon: 'box', perm: ['inventory.manage', 'inventory.view'], module: 'inventory', mod: () => import('./pages/inventory.js') },
  { path: 'marketing', label: 'Promo e fedeltà', icon: 'tag', perm: 'marketing.manage', module: 'marketing', mod: () => import('./pages/marketing.js') },
  { path: 'attesa', label: 'Lista d’attesa', icon: 'clock', perm: 'waitlist.manage', module: 'waitlist', mod: () => import('./pages/waitlist.js') },
  { path: 'notifiche', label: 'Messaggi', icon: 'bell', perm: 'notifications.manage', module: 'notifications', mod: () => import('./pages/notifications.js') },
  { path: 'report', label: 'Report', icon: 'chart', perm: 'cash.reports', mod: () => import('./pages/reports.js') },
  { sep: 'Configurazione' },
  { path: 'sito', label: 'Sito pubblico', icon: 'globe', perm: 'site.manage', mod: () => import('./pages/site.js') },
  { path: 'impostazioni', label: 'Impostazioni', icon: 'settings', perm: ['settings.manage', 'settings.hours'], mod: () => import('./pages/settings.js') },
];
const visible = p => !p.sep && (Array.isArray(p.perm) ? p.perm.some(can) : can(p.perm)) && (!p.module || state.tenant.modules[p.module] !== false);

const app = document.getElementById('app');
let current = null;

function applyTheme() {
  const t = pref('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
}
applyTheme();

async function boot() {
  try {
    const me = await api('GET', '/api/auth/me', undefined, { noAuthRedirect: true });
    Object.assign(state, { me: me.user, perms: me.permissions, tenant: me.tenant, providers: me.providers });
    document.title = `Gestionale · ${me.tenant.name}`;
    startStream();
    route();
  } catch (e) {
    if (e.status === 401) return renderLogin();
    app.innerHTML = ''; app.appendChild(h('div', { class: 'login' }, h('div', { class: 'card' }, h('h1', { text: 'Errore' }), h('p', { text: e.message }), h('button', { class: 'btn primary', onclick: boot }, 'Riprova'))));
  }
}

function renderLogin() {
  state.me = null;
  if (location.hash !== '#/login') history.replaceState(null, '', '#/login');
  app.innerHTML = '';
  const u = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', required: true });
  const p = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'alert err', style: { display: 'none' } });
  const btn = h('button', { class: 'btn primary', type: 'submit', style: { width: '100%', padding: '11px' } }, 'Accedi');
  const f = h('form', { class: 'stack' }, h('label', { class: 'field' }, h('span', { text: 'Utente' }), u), h('label', { class: 'field' }, h('span', { text: 'Password' }), p), err, btn);
  f.addEventListener('submit', async e => {
    e.preventDefault(); btn.disabled = true; err.style.display = 'none';
    try { await api('POST', '/api/auth/login', { username: u.value, password: p.value }, { noAuthRedirect: true }); location.hash = '#/dashboard'; await boot(); }
    catch (x) { err.textContent = x.message; err.style.display = 'block'; } finally { btn.disabled = false; }
  });
  app.appendChild(h('div', { class: 'login' }, h('div', { class: 'card' }, h('h1', { text: 'Bentornata' }), h('p', { class: 'muted', text: 'Accedi al gestionale del salone' }), f,
    h('p', { class: 'small muted', style: { marginTop: '18px', textAlign: 'center' } }, 'PromoApp · ', h('a', { href: '/' }, 'vai al sito')))));
  setTimeout(() => u.focus(), 50);
}

function shell(page) {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Menu' });
  let sepPending = null;
  for (const p of PAGES) {
    if (p.sep) { sepPending = p.sep; continue; }
    if (!visible(p)) continue;
    if (sepPending) { nav.appendChild(h('div', { class: 'sep', text: sepPending })); sepPending = null; }
    nav.appendChild(h('a', { href: `#/${p.path}`, class: page.path === p.path ? 'on' : '' }, icon(p.icon), p.label));
  }
  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, h('div', { class: 'logo', text: (state.tenant.name || 'P').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() }), h('div', null, h('b', { text: state.tenant.name }), h('small', { text: 'Gestionale PromoApp' }))),
    nav,
    h('div', { class: 'foot' },
      h('div', { class: 'userbox' }, h('div', { class: 'avatar', text: (state.me.display_name || state.me.username).slice(0, 1).toUpperCase() }),
        h('div', null, h('div', { style: { fontWeight: 600 }, text: state.me.display_name || state.me.username }), h('div', { class: 'small muted', text: state.me.role_label }))),
      h('a', { class: 'btn ghost', href: '/', target: '_blank' }, icon('external'), 'Vedi il sito'),
      h('button', { class: 'btn ghost', onclick: () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; pref('theme', t); applyTheme(); } }, icon('moon'), 'Tema chiaro/scuro'),
      h('button', { class: 'btn ghost', onclick: changePassword }, icon('settings'), 'Cambia password'),
      h('button', { class: 'btn ghost', onclick: logout }, icon('logout'), 'Esci')));
  const titleEl = h('h1', { text: page.label });
  const actions = h('div', { class: 'row' });
  const content = h('div', { class: 'content' });
  const mob = h('nav', { class: 'mobile-nav' }, PAGES.filter(p => visible(p) && ['dashboard', 'agenda', 'clienti', 'cassa'].includes(p.path)).map(p =>
    h('a', { href: `#/${p.path}`, class: page.path === p.path ? 'on' : '' }, icon(p.icon), p.label)), h('button', { onclick: () => side.classList.toggle('open') }, icon('menu'), 'Menu'));
  side.addEventListener('click', e => { if (e.target.closest('a')) side.classList.remove('open'); });
  const main = h('div', { class: 'main' },
    state.tenant.is_demo ? h('div', { class: 'demo-banner' }, h('span', { text: 'Sono presenti dati dimostrativi (clienti e appuntamenti di prova).' }), can('settings.manage') ? h('a', { href: '#/impostazioni/demo' }, 'Gestisci') : null) : null,
    h('header', { class: 'topbar' }, h('div', { class: 'title' }, titleEl), actions), content);
  app.innerHTML = '';
  app.appendChild(h('div', { class: 'shell' }, side, main));
  app.appendChild(mob);
  return { content, actions, setTitle: t => { titleEl.textContent = t; } };
}

async function route() {
  if (!state.me) return;
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  if (hash === 'login') { location.hash = '#/dashboard'; return; }
  const [path, ...rest] = hash.split('/');
  const page = PAGES.find(p => p.path === path && visible(p)) || PAGES.find(visible);
  if (current && current.destroy) { try { current.destroy(); } catch { /* */ } }
  const ui = shell(page);
  ui.content.appendChild(h('div', { class: 'loading' }, h('span', { class: 'spinner' })));
  try {
    const mod = await page.mod();
    ui.content.innerHTML = '';
    current = (await mod.default({ ...ui, params: rest.map(decodeURIComponent) })) || null;
  } catch (e) {
    ui.content.innerHTML = '';
    ui.content.appendChild(h('div', { class: 'alert err', text: e.message }));
    toastErr(e);
  }
}

async function logout() { try { await post('/api/auth/logout'); } catch { /* */ } state.me = null; renderLogin(); }

function changePassword() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const n1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const save = h('button', { class: 'btn primary' }, 'Salva');
  const m = modal({ title: 'Cambia password', size: 'narrow', body: h('div', { class: 'stack' }, h('label', { class: 'field' }, h('span', { text: 'Password attuale' }), cur),
    h('label', { class: 'field' }, h('span', { text: 'Nuova password' }), n1), h('label', { class: 'field' }, h('span', { text: 'Ripeti nuova password' }), n2)), footer: [save] });
  save.addEventListener('click', busy(save, async () => {
    if (n1.value !== n2.value) throw new Error('Le password non coincidono');
    await post('/api/auth/password', { current: cur.value, password: n1.value });
    m.close(); toast('Password aggiornata: accedi di nuovo', 'ok'); renderLogin();
  }));
}

// Aggiornamenti in tempo reale (SSE) + rete di sicurezza col polling nelle pagine
let es;
function startStream() {
  if (es || !can('agenda.view')) return;
  try {
    es = new EventSource('/api/admin/stream');
    for (const type of ['appointments', 'cash', 'waitlist']) es.addEventListener(type, ev => window.dispatchEvent(new CustomEvent('pa:' + type, { detail: JSON.parse(ev.data || '{}') })));
    es.onerror = () => { /* il browser riconnette automaticamente */ };
  } catch { /* SSE non disponibile */ }
}

window.addEventListener('hashchange', () => { if (state.me) route(); else if (location.hash !== '#/login') boot(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
boot();
