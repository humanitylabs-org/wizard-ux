// Runs the real web/tweaks/miguel/machines-home/tweak.js (Miguel's network Home) on a small DOM with a fake package
// api, so tests read what the owner sees (words, labels, buttons) and what it asks the shell for (wizard-ux #1674).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './mini-dom.mjs';
import { wordAttrs } from './w5-css.mjs';

const SRC = readFileSync(new URL('../../web/tweaks/miguel/machines-home/tweak.js', import.meta.url), 'utf8');
// The real stylesheet, with [data-tweaks~="id"] spelled so mini-dom can match it (tests/fixtures/w5-css.mjs).
export const RAW_CSS = readFileSync(new URL('../../web/tweaks/miguel/machines-home/tweak.css', import.meta.url), 'utf8');
export const CSS = wordAttrs(RAW_CSS);

// A device entry for the Devices feed. Defaults: an online Linux helper with readings.
export const dev = (id, more = {}) => ({ id, name: id, status: 'online', cpus: 8, memoryTotalGB: 32, memory: 40, cpu: 20, disks: [{ sizeGB: 1000, freeGB: 600 }], ...more });
export const nowIso = (ms = 0) => new Date(Date.now() + ms).toISOString();

// opts: desk (desktop bar), saved (api.storage), snapshot (resources feed at start), backup (Backup overview answer,
// null = failed read), sessions (counts or null), provider (default model's provider), managed (workspace items).
export function machinesHome(opts = {}) {
  const doc = createDocument();
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  const proto = Object.getPrototypeOf(doc.body);
  if (!proto.replaceChildren) {
    // as the DOM does: anything that is not a node (null included) becomes text
    proto.replaceChildren = function (...ns) { for (const n of [...this.childNodes]) this.removeChild(n); this.append(...ns.map(n => (n?.nodeType ? n : this.ownerDocument.createTextNode(String(n))))); };
    Object.defineProperty(proto, 'firstChild', { get() { return this.childNodes[0] || null; } });
  }
  // Elements get a style that keeps custom properties (the map writes --cx, --s, ... through setProperty).
  const make = doc.createElement;
  doc.createElement = tag => { const e = make(tag); e.style = { setProperty(k, v) { this[k] = String(v); }, removeProperty(k) { delete this[k]; } }; return e; };
  doc.documentElement.setAttribute('data-tweaks', 'miguel/machines-home');
  if (opts.desk) { const bar = doc.createElement('div'); bar.id = 'bar'; doc.body.append(bar); }
  // The stock phone Home skeleton: the package mounts into the empty hidden home-main slot.
  const home = doc.createElement('div'); home.className = 'home'; doc.body.append(home);
  home.innerHTML = '<div data-slot="home-main" hidden></div><div class="home-top"></div><div class="constellation"></div>';
  const slots = { 'home-main': home.querySelector('[data-slot="home-main"]'), 'dock-end': doc.body.querySelector('#bar') };
  const store = new Map(Object.entries(opts.saved || {}));
  const calls = { asks: [], opens: [], settingsOpen: [], toasts: [], refresh: 0, settingsRefresh: 0, live: [], switches: [], adds: 0, reads: [] };
  const sections = {}, on = {}, watchers = [], frames = [];
  let snapshot = opts.snapshot ?? null, backup = 'backup' in opts ? opts.backup : { backup: null }, sessions = 'sessions' in opts ? opts.sessions : { working: 0, ready: 0 };
  let items = opts.managed || [];
  const wsSubs = new Set();
  const api = {
    storage: { get: k => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null), set: (k, v) => store.set(k, v) },
    data: { read: {
      app: async (id, path) => { calls.reads.push([id, path]); return typeof backup === 'function' ? backup() : backup; },
      sessions: { counts: () => sessions, open: kind => calls.opens.push(kind) },
      resources: { watch: fn => watchers.push(fn), snapshot: () => snapshot, refresh: () => calls.refresh++, live: el => calls.live.push(el) },
    } },
    workspaces: { snapshot: () => ({ items }), switch: async id => { calls.switches.push(id); }, add: async () => { calls.adds++; }, subscribe: fn => { wsSubs.add(fn); return () => wsSubs.delete(fn); } },
    models: { default: () => (opts.provider ? { provider: opts.provider } : null) },
    inbox: { watch: fn => { calls.inbox = fn; } },
    settings: { section: (id, page, node, o) => { sections[page] = { id, node, subtitle: o?.subtitle }; }, refresh: () => calls.settingsRefresh++, open: p => calls.settingsOpen.push(p) },
    nav: { ask: (key, item, words) => { calls.asks.push([key, item, words]); return opts.askOk !== false; } },
    toast: t => calls.toasts.push(t),
    frame: fn => frames.push(fn),
    listen: (el, type, fn) => el.addEventListener(type, fn),
    slot: { mount: (name, node) => { const s = slots[name]; if (!s) return false; if (node.parentNode !== s) s.append(node); return true; } },
    on: (ev, fn) => { (on[ev] ||= []).push(fn); },
  };
  const ctx = vm.createContext({ document: doc, console, Intl, Date: opts.Date || Date });
  vm.runInContext(SRC.replace('export default function setup', 'function setup') + '\nthis.setup = setup;', ctx);
  const dispose = ctx.setup(api);
  const root = () => home.querySelector('.mh-root');
  const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const flush = () => new Promise(r => setImmediate(r));
  return {
    doc, api, calls, sections, store, home, dispose, root, text, flush, slots,
    get frames() { return frames; },
    // Lay the map out (every box 100 x 20 unless `rect` says otherwise) and run the frames the package asked for.
    draw(rect = () => ({ left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 })) {
      const ov = sections.overview?.node; if (ov && !ov.isConnected) doc.body.append(ov);
      const proto = Object.getPrototypeOf(doc.body), was = proto.getBoundingClientRect;
      proto.getBoundingClientRect = function () { return rect(this); }; proto.getTotalLength = () => 0;
      try { for (const f of frames.splice(0)) f(); } finally { proto.getBoundingClientRect = was; delete proto.getTotalLength; }
    },
    page: p => sections[p]?.node, sub: p => sections[p]?.subtitle?.(),
    glance: () => doc.querySelector('.mh-glance'),
    feed(state) { snapshot = state; for (const w of watchers) w(state); },
    setSessions(s) { sessions = s; },
    setBackup(b) { backup = b; },
    setItems(next) { items = next; for (const f of wsSubs) f(); },
    fire(ev) { for (const f of on[ev] || []) f(); },
    tap(el) { if (!el) throw new Error('nothing to tap'); el.click(); },
    change(el, checked) { el.checked = checked; el.dispatchEvent({ type: 'change', bubbles: true }); },
    labels: (sel, scope = doc.documentElement) => scope.querySelectorAll(sel).map(e => e.getAttribute('aria-label')),
  };
}
