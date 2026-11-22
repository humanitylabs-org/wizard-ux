// The AI apps view (web/layouts/ai-apps) on a small DOM with a fake layout host API: world() for the phone and
// deskWorld() for the desktop, layout() loads the shell's own entry. Shared by the AI apps tests (moved out of
// tests/ai-apps-view.test.mjs for wizard-ux issue 1674, so other AI apps tests run the view instead of reading it).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './shell-parts.mjs';
import { withWebParts } from './web-parts.mjs';

export const root = new URL('../../', import.meta.url);
export const read = p => withShellParts(withWebParts(readFileSync(new URL(p, root), 'utf8')));
export const settle = () => new Promise(r => setTimeout(r, 15));
export const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* ---------- a small DOM, enough for the layout ---------- */
const parseSel = sel => sel.trim().split(/\s+/).map(part => {
  const tag = (part.match(/^[a-z]+/i) || [''])[0].toUpperCase(), cls = [...part.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
  const attrs = [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map(m => [m[1], m[2]]), id = (part.match(/^[a-z]*#([\w-]+)/i) || [])[1];
  return n => (!tag || n.tagName === tag) && (!id || n.id === id) && cls.every(c => n.classList.contains(c)) && attrs.every(([k, v]) => { const a = n.getAttribute(k); return v === undefined ? a !== null : a === v; });
});
export const matchesSel = (n, sel) => sel.split(',').some(one => {
  const parts = parseSel(one); let i = parts.length - 1;
  if (!parts[i](n)) return false;
  for (let p = n.parentNode; p && i > 0; p = p.parentNode) if (p.tagName && parts[i - 1](p)) i--;
  return i === 0;
});
export class El {
  constructor(tag, ns) {
    this.tagName = String(tag).toUpperCase(); this.ns = ns || null; this.children = []; this.parentNode = null; this.attrs = {}; this.hidden = false; this.listeners = {}; this._text = '';
    const st = {}; this.style = Object.assign(st, { setProperty(k, v) { st[k] = v; }, getPropertyValue: k => st[k] || '', removeProperty(k) { delete st[k]; } });
    const self = this;
    this.classList = { add(...c) { const s = new Set(self.cls()); c.forEach(x => s.add(x)); self.className = [...s].join(' '); }, remove(...c) { self.className = self.cls().filter(x => !c.includes(x)).join(' '); },
      toggle(c, on) { const has = self.cls().includes(c), want = on === undefined ? !has : !!on; if (want) this.add(c); else this.remove(c); return want; }, contains: c => self.cls().includes(c) };
    this.dataset = new Proxy({}, { get: (_, k) => self.attrs['data-' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())], set: (_, k, v) => { self.attrs['data-' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())] = String(v); return true; },
      deleteProperty: (_, k) => { delete self.attrs['data-' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())]; return true; } });
  }
  cls() { return String(this.attrs.class || '').split(/\s+/).filter(Boolean); }
  get className() { return this.attrs.class || ''; } set className(v) { this.attrs.class = String(v); }
  get id() { return this.attrs.id || ''; } set id(v) { this.attrs.id = String(v); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); } set textContent(v) { this.children = []; this._text = String(v); }
  get title() { return this.attrs.title || ''; } set title(v) { this.attrs.title = String(v); }
  get value() { return this.attrs.value || ''; } set value(v) { this.attrs.value = String(v); }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  toggleAttribute(k, on) { const v = on === undefined ? !(k in this.attrs) : !!on; if (v) this.attrs[k] = ''; else delete this.attrs[k]; return v; }
  append(...n) { for (const c of n) { if (c == null) continue; if (typeof c === 'string') { this._text += c; continue; } c.remove(); c.parentNode = this; this.children.push(c); } }
  insertBefore(n, ref) { n.remove(); n.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, n); return n; }
  replaceChildren(...n) { for (const c of this.children) c.parentNode = null; this.children = []; this._text = ''; this.append(...n); }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
  get childElementCount() { return this.children.length; }
  get lastChild() { return this.children.at(-1) || null; }
  contains(n) { return n === this || this.all().includes(n); }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.tagName === 'HTML'; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelectorAll(sel) { sel = sel.replace(/\s*>\s*/g, ' '); return this.all().filter(n => matchesSel(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let n = this; n && n.tagName; n = n.parentNode) if (matchesSel(n, sel)) return n; return null; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 300, height: 44, right: 300, bottom: 44 }; }
  getClientRects() { return [this.getBoundingClientRect()]; } // visibility overrides are supplied by individual geometry fixtures
  focus() {} decode() { return Promise.resolve(); }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); } removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); }
  dispatchEvent(e) { e.target ||= this; for (let n = this; n; n = n.parentNode) for (const fn of [...(n.listeners?.[e.type] || [])]) fn(e); return true; }
}
export class FakePointerEvent { constructor(type, init = {}) { Object.assign(this, init, { type }); } preventDefault() { this.defaultPrevented = true; } stopPropagation() {} }

export function world({ shell = 'phone', route = { home: false, view: 'thread', thread: '__new__', desk: 1, app: 'chats' } } = {}) {
  const paneContext = {}; vm.runInNewContext(read('web/core/pane-layout.js'), paneContext);
  globalThis.WizCore = { ...globalThis.WizCore, panes: paneContext.WizCore.panes };
  const html = new El('html'), body = new El('body'), device = new El('div'), dock = new El('div'), orbWrap = new El('div');
  html.append(body); body.append(device); device.append(dock); dock.append(orbWrap);
  const docListeners = {};
  const doc = { documentElement: html, body, createElement: t => new El(t), createElementNS: (ns, t) => new El(t, ns), __listeners: docListeners,
    addEventListener: (t, fn) => (docListeners[t] ||= []).push(fn), removeEventListener() {}, querySelectorAll: s => html.querySelectorAll(s), querySelector: s => html.querySelector(s) };
  globalThis.document = doc; globalThis.PointerEvent = FakePointerEvent; globalThis.performance ||= { now: () => Date.now() };
  const st = { route: { ...route }, on: {}, acts: [], opened: [], gone: [], lists: [], chats: 0, newChats: 0, settings: [], backs: [], timers: [], orbDown: [], sheet: 0, swipes: null, inset: null, store: {},
    sessions: { working: [{ id: 'w1', title: 'Busy one', kind: 'working', unread: false, pinned: false, actions: ['pin', 'rename'] }],
      ready: [{ id: 'r1', title: 'Ready one', kind: 'ready', unread: true, pinned: true, actions: ['pin', 'rename', 'snooze', 'done'] }, { id: 'r2', title: 'Seen one', kind: 'ready', unread: false, pinned: false, actions: ['pin', 'rename', 'unread', 'move', 'snooze', 'done'] }],
      archive: [{ id: 'a1', title: 'Old money talk', kind: 'archive', unread: false, pinned: false, actions: ['pin', 'rename', 'restore', 'snooze'] }] },
    desks: [{ desk: 1, id: 'wizard', name: 'Chats' }, ...['mail', 'music', 'money', 'notes', 'maps'].map((id, i) => ({ desk: i + 2, id, name: id[0].toUpperCase() + id.slice(1) }))] };
  const apps = ['mail', 'music', 'money', 'notes', 'maps', 'movies'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1) }));
  const backWindow = {}; vm.runInNewContext(read('web/core/escape-back.js'), {window:backWindow});
  const dispatcher = backWindow.WizEscapeBack.create();
  const api = {
    env: { shell, edgeInset: 24 }, route: () => ({ ...st.route }), on: (t, fn) => { (st.on[t] ||= []).push(fn); return () => {}; },
    listen: (t, type, fn) => { if (t === doc) doc.addEventListener(type, fn); else if (t?.addEventListener) t.addEventListener(type, fn); return () => {}; },
    mount: n => { device.append(n); return () => n.remove(); },
    after: (ms, fn) => { const h = { ms, fn, dead: false }; st.timers.push(h); return () => { h.dead = true; }; },
    frame: fn => { fn(0); return () => {}; },
    back: { surface: fn => { st.surface = fn; return () => { st.surface = null; }; }, push: fn => { st.backs.push(fn); const release = dispatcher.push(fn); return () => { release(); const i = st.backs.indexOf(fn); if (i >= 0) st.backs.splice(i, 1); }; } },
    gesture: { intent: dx => dx > 60, claim: id => { (st.claims ||= []).push(id); return true; } },
    agents: { list: () => [{ id: 'hermes', label: 'Oscar', main: true }] },
    workspaces: { list: () => [{ id: 'this', name: 'Miguel', current: true, owner: 'Miguel Collins' }, { id: 'g1', name: 'Carlos', org: 'Acme', current: false }], refresh() {} },
    apps: { list: () => apps.map(a => ({ ...a })), badges: () => ({ wizard: 2, money: 3 }), logo: () => Promise.resolve(null), openDesk: id => st.opened.push(id), open: id => st.opened.push('open:' + id), store: () => Promise.resolve([]), inset: px => { st.inset = px; return () => { st.inset = null; }; } },
    sessions: { list: () => JSON.parse(JSON.stringify(st.sessions)), open: id => st.opened.push('thread:' + id), act: (id, a) => { st.acts.push([id, a]); return true; }, openList: k => st.lists.push(k), chats: () => { st.chats++; return true; }, newChat: () => { st.newChats++; return true; } },
    nav: { goDesk: i => st.gone.push(i) },
    desks: { list: () => st.desks.map(d => ({ ...d })) },
    desk: { settings: p => st.settings.push(p ?? '') },
    voice: { tap: () => st.orbDown.push('tap') },
    // the shell adapter's own scope (app.js chatsSurfaces): each Chats window's shared surface
    phone: { chats: () => [...html.querySelectorAll('.win.app-chats')].map(win => ({ get composer() { return win.querySelector('.ch-compose'); }, get notification() { return win.querySelector('.ch-thread.ch-notif-thread'); } })), orb: () => orbWrap, mark: () => null, desks: () => st.desks, swipes: m => { st.swipes = m; return () => { st.swipes = null; }; } },
    storage: { get: k => k in st.store ? JSON.parse(JSON.stringify(st.store[k])) : null, set: (k, v) => { st.store[k] = JSON.parse(JSON.stringify(v)); } },
  };
  orbWrap.addEventListener('pointerdown', e => st.orbDown.push(e.pointerId));
  const fire = (type, target, extra = {}) => { const e = new FakePointerEvent(type, { target, isPrimary: true, pointerId: 7, clientX: 100, clientY: 400, button: 0, ...extra }); for (const fn of docListeners[type] || []) fn(e); if (!e.stopped) target?.dispatchEvent?.(e); return e; };
  const emit = (t, v) => { for (const fn of st.on[t] || []) fn(v); };
  // Adapt this legacy DOM fixture at the same host boundary as the real shell.
  // Layout code itself must not infer app identity from Classic markup.
  const hostWindow = {}; vm.runInNewContext(read('web/core/desktop-host.js'), { window: hostWindow, queueMicrotask, console });
  const hostFrames = new Map(), inferredGroups = new WeakSet();
  const windows = () => {
    hostFrames.clear(); const rows = [];
    for (const group of html.querySelectorAll('#stage > .wsp')) {
      const isChat = !!group.querySelector('.dchats');
      if (group.dataset.ws == null) inferredGroups.add(group);
      const desk = inferredGroups.has(group) ? (isChat ? st.desks.find(d => d.id === 'wizard')?.desk : st.route.desk) : Number(group.dataset.ws);
      if (inferredGroups.has(group)) group.dataset.ws = desk;
      const appId = isChat ? 'wizard' : st.desks.find(d => d.desk === desk)?.id || st.route.app;
      const wins = group.querySelectorAll('.win');
      for (const win of wins.length ? wins : [group]) {
        const id = win.dataset.win ||= 'fixture-' + rows.length, frame = win.querySelector('iframe');
        hostFrames.set(id, frame);
        const chatBody = isChat && (win.querySelector('.pane-main') || win.querySelector('.dchats'));
        if (chatBody) chatBody.dataset.chats = id;
        rows.push({ id, desk, deskId: 'group-' + desk, kind: isChat ? 'chats' : frame ? 'frame' : 'settings', appId, thread: isChat ? win.querySelector('.dchats')?.dataset.thread : null, tiled: !win.classList.contains('gone'), visible: !group.hidden, focused: false });
      }
    }
    return rows;
  };
  const chatsWindow = { WizCore: { chats: () => ({ forget() {} }) } };
  vm.runInNewContext(read('web/core/chats-view.js'), { window: chatsWindow, document: doc, URL, URLSearchParams, console });
  globalThis.WizChatsHost = chatsWindow.WizChatsHost;
  const sharedChats = chatsWindow.WizChatsHost.create({ win: id => windows().find(w => w.id === id), root: () => html });
  const hostController = hostWindow.WizDesktop.attach({ windows, has: id => windows().some(w => w.id === id), frame: id => hostFrames.get(id), openApp: () => true, close: () => false,
    chats: id => sharedChats.surface(id),
    placements: () => { windows(); return [...html.querySelectorAll('#stage > .wsp')].map(n => ({ desk: Number(n.dataset.ws), node: n, shown: !n.hidden })); },
    settings: () => { const n = doc.querySelector('#dsettings'); return { isOpen: !!n && !n.hidden && n.parentNode === body, closePart: n?.querySelector('.st-close') }; },
    closeSettings: () => { const b = doc.querySelector('#dsettings .st-close'); b?.click?.(); return !!b; },
    settingsOverlay: () => { html.dataset.settingsOver = ''; return () => { delete html.dataset.settingsOver; }; },
    focus: id => { (st.hostFocus ||= []).push(id); return true; }, renderTools: (id, slot) => { if (st.renderTools) return st.renderTools(id, slot); slot.replaceChildren(); return false; } });   // st.renderTools: a test's own tools
  globalThis.WizDesktop = hostWindow.WizDesktop;
  st.hostChanged = hostController.changed;
  const run = () => { const t = st.timers.splice(0); for (const h of t) if (!h.dead) h.fn(); };
  const q = s => html.querySelector(s), qa = s => html.querySelectorAll(s);
  return { api, st, html, device, orbWrap, fire, emit, run, q, qa, doc, escape: () => !!dispatcher.run({surface:st.surface}) };
}
// The host picks each shell's own entry (core/skin-host.js files: desktop -> desktop.js; the phone -> layout.js).
export const layout = async () => {
  const [phone, desk] = await Promise.all([import(new URL('web/layouts/ai-apps/layout.js', root).href), import(new URL('web/layouts/ai-apps/desktop.js', root).href)]);
  return { default: api => (api.env.shell === 'desktop' ? desk : phone).default(api) };
};


export const deskWorld = () => {
  const w = world({ shell: 'desktop' });
  const store = {}, keys = [];
  Object.assign(w.api, { asset: n => '/wizard-os-home/layouts/ai-apps/' + n, storage: { get: k => k in store ? store[k] : null, set: (k, v) => { store[k] = v; } },
    keys: { on: h => { keys.push(h); return () => {}; }, guide: () => () => {} }, orb: { ready: () => new Promise(() => {}), onLevel: () => () => {} }, voice: { state: () => ({ state: 'idle' }), talk() {}, command() {} },
    desk: { settings: p => w.st.settings.push(p ?? ''), home: () => {}, setting: (id, n) => { w.html.children[0].append(n); w.st.setting = [id, n]; return () => n.remove(); } } });
  w.api.apps.inset = () => () => {};
  return { w, store, keys };
};
