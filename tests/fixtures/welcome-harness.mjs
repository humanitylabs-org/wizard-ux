// A fake box and a small fake browser for running the real web/core/welcome.js (and web/core/config.js) in node:vm.
// Time is in the test's hands: setTimeout only queues, and advance(ms) runs what is due, so a test can stop at any
// moment of the Welcome's polling and auto-advance (wizard-ux issue 1674: tests run the code, they do not read it).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = f => readFileSync(new URL(`../../web/core/${f}`, import.meta.url), 'utf8');
const WELCOME = src('welcome.js'), CONFIG = src('config.js');
export const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

// firstRun: the Agent Service setup first_run (true until the Welcome was finished once: a fresh box).
// providers: the model/options providers list; signedIn: shorthand for one authenticated Anthropic provider.
// pf: GET /wizard/v1/private-first (wizard-ux issue 1800). By default the owner already said No thanks to the private AI
// offer, so tests about other steps see the Welcome's usual order; null answers 404 (an older Agent Service), and
// { ...PF, offer: null } a box whose offer is still open.
export const PF = { schema: 'wizard.private-first/1', on: false, standard_agent: 'hermes', private_agent: null, standard_on: true, offer: 'declined' };
export function fakeBox({ name = 'Oscar', signedIn = false, providers, firstRun = true, live = true, seen = [200],
  threads = {}, optionsDown = false, pf = PF } = {}) {
  const box = { settings: { agent: { name, adapter: 'hermes-plugin' }, owner: { name: '' } }, calls: [], seenCodes: [...seen], threads, providers: providers || (signedIn ? [{ slug: 'anthropic', authenticated: true }] : []) };
  const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });
  box.fetch = async (url, init = {}) => {
    const u = String(url), method = init.method || 'GET';
    box.calls.push(`${method} ${u.replace(/^https?:\/\/[^/]+/, '')}`);
    if (u.endsWith('/wizard/v1/bootstrap')) return live ? ok({ bootstrap: 1, settings: box.settings, capabilities: {}, endpoints: {} }) : ok({ error: 'down' }, 503);
    if (u.endsWith('/wizard/v1/settings')) return ok({ settings: box.settings });
    if (u.endsWith('/wizard/v1/setup/seen')) return ok({}, box.seenCodes.length > 1 ? box.seenCodes.shift() : box.seenCodes[0]);
    if (u.endsWith('/wizard/v1/setup')) return ok({ first_run: firstRun });
    if (u.endsWith('/wizard/v1/private-first')) return pf ? ok(pf) : ok({ error: 'not_found' }, 404);
    if (u.endsWith('/wizard/hermes/api/model/options')) return optionsDown ? ok({}, 503) : ok({ providers: box.providers });
    const t = /\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/.exec(u);
    if (t) return ok({ data: box.threads[decodeURIComponent(t[1])] || [] });
    return ok({}, 404);
  };
  return box;
}

// One small element tree drawn from the card's HTML: enough for clicks, focus, the form and the sign-in frame.
function fakeDom(doc) {
  const el = (tag, attrs = {}) => ({ tag, attrs, value: '', listeners: {}, isConnected: true,
    focus() { doc.activeElement = this; }, select() {}, hasAttribute: k => k in attrs,
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, matches: s => s === tag });
  return { el };
}

export function device(box, { apps = { 'wizard-claude': { url: '/wizard-claude/' }, 'wizard-chatgpt': { url: '/wizard-chatgpt/' } },
  skins = null, send = async () => ({ sessionId: 's1' }), deeplinked = () => false, busy = () => false, pointer = 'fine',
  noTimeout = false, appsLoaded } = {}) {
  const store = new Map(), timers = []; let now = 0, seq = 0;
  const doc = { activeElement: null, addEventListener() {}, removeEventListener() {}, baseURI: 'https://box.test/wizard-os-home/', hidden: false,
    body: { appendChild(n) { doc.overlay = n; } }, documentElement: { classList: { list: new Set(), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); }, toggle() {} }, getAttribute: () => '' } };
  const { el } = fakeDom(doc);
  const nodes = { focusables: [], iframe: null, textarea: null, input: null, h2: null };
  const card = { cls: new Set(), classList: { toggle(c, on) { on ? card.cls.add(c) : card.cls.delete(c); } }, _html: '',
    get innerHTML() { return card._html; },
    set innerHTML(h) {
      card._html = h; nodes.focusables = []; nodes.iframe = nodes.textarea = nodes.input = nodes.h2 = null;
      for (const m of h.matchAll(/<(button|input|textarea|iframe|h2)\b([^>]*)>/g)) {
        const attrs = {}; for (const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
        const n = el(m[1], attrs);
        if (m[1] === 'input') { n.value = (attrs.value || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); nodes.input = n; }
        if (m[1] === 'textarea') nodes.textarea = n;
        if (m[1] === 'iframe') nodes.iframe = n;
        if (m[1] === 'h2') { nodes.h2 = n; if (attrs.tabindex === '-1') continue; }
        if ((m[1] === 'button' || m[1] === 'input') && 'disabled' in attrs) continue;
        nodes.focusables.push(n);
      }
    },
    contains: n => Object.values(nodes).includes(n),
    querySelector: s => s === '.wl-frame iframe' ? nodes.iframe : s === 'textarea' ? nodes.textarea : s === 'h2' ? nodes.h2
      : /^\.wl-naming input/.test(s) ? (nodes.input && !(s.includes(':not([disabled])') && 'disabled' in nodes.input.attrs) ? nodes.input : null) : null };
  const handlers = {};
  const overlay = { cls: new Set(), classList: { add() {}, remove() {}, toggle(c, on) { on ? overlay.cls.add(c) : overlay.cls.delete(c); } },
    set innerHTML(h) {}, addEventListener: (t, f) => { handlers[t] = f; }, remove() { overlay.removed = true; doc.overlay = null; },
    querySelector: s => s === '.wl-card' ? card : s === 'form' ? { requestSubmit: () => handlers.submit({ preventDefault() {} }) }
      : s === 'textarea' ? nodes.textarea : card.querySelector(s),
    querySelectorAll: () => nodes.focusables };
  doc.createElement = () => overlay;
  const shellListeners = {};
  const ctx = {
    console: { ...console, error() {} }, URL, URLSearchParams, Promise, JSON, Math, String, Object, Array, Error, Map, Set, Intl,
    Date: { now: () => now }, fetch: (u, i) => box.fetch(u, i),
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    setTimeout: (f, ms = 0) => { const id = ++seq; timers.push({ id, at: now + (ms || 0), f }); return id; },
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    AbortController, AbortSignal: noTimeout ? {} : AbortSignal,
    requestAnimationFrame: f => f(), matchMedia: () => ({ matches: pointer === 'fine' }),
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    addEventListener: (t, f) => { (shellListeners[t] ||= new Set()).add(f); }, removeEventListener: (t, f) => shellListeners[t]?.delete(f),
    dispatchEvent() {}, document: doc, navigator: { userAgent: 'test' },
    location: { href: 'https://box.test/wizard-os-home/desktop.html', origin: 'https://box.test' },
  };
  ctx.window = ctx;
  if (skins) ctx.WosSkin = skins;
  if (appsLoaded) ctx.WizCore = { appsLoaded };
  vm.createContext(ctx);
  vm.runInContext(CONFIG, ctx);
  vm.runInContext(WELCOME, ctx);
  const W = ctx.WosWelcome;
  // run every timer due within ms, in time order, letting fetches settle between them
  const advance = async (ms = 0) => {
    const end = now + ms; await flush();
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = timers[0]; if (!t || t.at > end) break;
      timers.shift(); now = Math.max(now, t.at); t.f(); await flush();
    }
    now = end; await flush();
  };
  const press = (act, data = {}) => handlers.click({ target: { closest: s => (s === '[data-wl]' ? { dataset: { wl: act, ...data } } : null) } });
  const submit = text => { if (text != null && nodes.textarea) nodes.textarea.value = text; return handlers.submit({ preventDefault() {} }); };
  const key = (k, extra = {}) => { const e = { key: k, target: { matches: () => false }, shiftKey: false, preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; }, ...extra }; handlers.keydown(e); return e; };
  const shell = t => [...(shellListeners[t] || [])].forEach(f => f({ type: t }));
  const hooks = { app: id => apps[id] || null, send: (...a) => send(...a), deeplinked: () => deeplinked(), busy: () => busy(), openStore() {} };
  const boot = async (h = hooks) => { W.boot(h); await advance(0); };
  return { W, ctx, card, nodes, doc, store, box, press, submit, key, shell, boot, advance, hooks,
    html: () => card._html, log: () => [...(ctx.__welcomeLog || [])], timers };
}
