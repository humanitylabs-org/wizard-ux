// The phone Apps panel (web/app-appspanel.js) in node:vm against a fake page, for tests/apps-panel*.test.mjs.
// live: the WizLive the panel saves through (default: a recorder of the prefOps operations it sends, in puts); local: a Map for its
// localStorage (a two-device test passes the device's own store).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../../web/app-appspanel.js', import.meta.url), 'utf8');
const kindsSrc = readFileSync(new URL('../../web/core/app-kinds.js', import.meta.url), 'utf8');

export function el() {
  const kids = {};
  const e = { listeners: {}, hidden: false, dataset: {}, style: { setProperty() {} }, innerHTML: '', value: '', scrollTop: 0, attrs: {},
    classList: { set: new Set(), add(...c) { c.forEach(x => this.set.add(x)); }, remove(...c) { c.forEach(x => this.set.delete(x)); }, toggle(c, on) { if (on ?? !this.set.has(c)) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, setAttribute(k, v) { this.attrs[k] = v; }, append() {}, blur() {},
    querySelector(s) { return (kids[s] ||= el()); }, querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 800, width: 400, height: 800 }) };
  return e;
}

export function harness({ sections = true, current = 'apps', front = 'notes', recent = ['notes', 'music', 'calendar', 'podcasts', 'maps', 'messenger'], favs = null, hidden = null, extra = [], live = null, local = new Map() } = {}) {
  const store = new Map([['recent', recent]]), puts = [], opened = [], toasts = [];
  if (favs) local.set('wos.apps.favorites.v1', JSON.stringify(favs));
  if (hidden) local.set('wos.apps.recentHidden.v1', JSON.stringify(hidden));
  const ids = ['notes', 'music', 'calendar', 'podcasts', 'maps', 'messenger', 'files', 'books', 'zen-long-name'];
  const APP = Object.fromEntries(ids.map(id => [id, { id, name: id[0].toUpperCase() + id.slice(1), desc: id === 'books' ? 'a calendar of reads' : '', url: `/${id}/`, kind: 'wizard' }]));
  APP.wizard = { id: 'wizard', name: 'Chats', kind: 'chats' }; APP['app-store'] = { id: 'app-store', name: 'App Store', url: '/s/', kind: 'wizard' }; APP.agents = { id: 'agents', name: 'Agents', kind: 'wizard' };
  APP.android = { id: 'android', name: 'Android thing', kind: 'native' };
  for (const a of extra) APP[a.id] = a;
  const root = { getAttribute: () => null }; // no tweak attribute: the panel needs no switch (wizard/apps-panel went)
  const desks = [{ id: 'home', home: true, wins: [] }, { id: 'da', wins: ['w1'], focus: 'w1' }];
  const appVars = { desks, W: { w1: { id: 'w1', app: 'frame', appId: front } }, idx: 1, sheet: null };
  const device = el(), dock = el(), made = [];
  const ctx = {
    window: { WizCore: { appParts: {}, isMaintenanceApp: () => false,
      phoneSections: { on: () => sections, current: () => current, sections: () => ({ apps: 'da' }), slotId: () => 'messenger' } } },
    document: { documentElement: root, createElement: () => { const e = el(); made.push(e); return e; }, elementFromPoint: () => null },
    localStorage: { getItem: k => local.has(k) ? local.get(k) : null, setItem: (k, v) => local.set(k, String(v)) },
    MutationObserver: class { observe() {} }, addEventListener() {}, requestAnimationFrame: f => f(), setTimeout, clearTimeout, Date, Math, JSON, Object, Set, console,
  };
  ctx.window.window = ctx.window; vm.createContext(ctx);
  vm.runInContext(kindsSrc, ctx); vm.runInContext(src, ctx);
  const api = ctx.window.WizCore.appParts.appspanel({
    $: s => s === '#dock' ? dock : null, APP, APPS: Object.values(APP), appVars, CHATS_APP: { id: 'wizard' }, device, esc: s => String(s),
    ico: (t, c, a) => `<${t} class="${c}">${a.id}</${t}>`, LIVE: live || { prefOps: ops => puts.push(...JSON.parse(JSON.stringify(ops))) }, norm: s => String(s).toLowerCase(),
    openApp: a => { opened.push(a.id); appVars.W.w1.appId = a.id; }, openStoreKind: k => opened.push('store:' + k), phoneBack: { watch() {} },
    store: { get: (k, d) => store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : d, set: (k, v) => store.set(k, v) },
    tapOpen: a => { opened.push('tap:' + a.id); store.set('recent', [a.id, ...(store.get('recent') || []).filter(x => x !== a.id)]); ctx.window.WizCore.appsPanelOpened(a.id); }, toast: (i, t) => toasts.push(t), vib() {},
  });
  const A = ctx.window.WizCore.appsPanel, clone = v => JSON.parse(JSON.stringify(v));
  const panel = made.find(e => e.id === 'appsPanel');
  // A tap in the panel: a button carrying these data-* keys.
  const click = data => panel.listeners.click.forEach(f => f({ target: { closest: () => ({ dataset: data }) } }));
  // The panel's rows top to bottom as the part painted them: headers, rows (x: with the Recent ×), the empty line.
  const rows = () => [...panel.querySelector('[data-apbody]').innerHTML.matchAll(/class="ap-ht">([^<]*)|<div class="ap-row[^"]*" data-aprow="([^"]+)">(.*?)<\/div>|class="ap-empty">([^<]*)/gs)]
    .map(m => m[1] ? 'h:' + m[1] : m[2] ? (m[3].includes('data-apx') ? 'x:' : '') + m[2] : 'empty:' + m[4]);
  const q = v => { panel.querySelector('[data-apq]').value = v; panel.querySelector('[data-apq]').listeners.input?.forEach(f => f()); };
  return { api, A: { ...A, favorites: () => clone(A.favorites()), recent: () => clone(A.recent()), nine: () => clone(A.nine()), stepList: () => clone(A.stepList()) },
    click, rows, q, puts, opened, toasts, local, store, appVars, ctx, panel };
}

