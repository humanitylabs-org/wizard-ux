// The app SDK (web/core/app-client.js) run whole in a vm, as an app page framed by the shell. `service` is what the
// shell's WizAppServices.connect hands back (same-origin), or null for an app whose parent has no services (then
// requests go by postMessage to the parent and are recorded in `posted`). opaque: a sandboxed frame (origin 'null'). Small stand-ins only: no real DOM. Its timers never hold the test process open.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../web/core/app-client.js', import.meta.url), 'utf8');

export function appClient({ service = null, path = '/wizard-music/', opaque = false } = {}) {
  if (service && !service.ready) service = { ready: () => true, ...service };
  const origin = 'https://wizard.example', posted = [], listeners = {}, connected = [], delays = [];
  const el = tag => ({ tag, style: {}, dataset: {}, children: [], attrs: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; }, appendChild(c) { this.children.push(c); return c; }, append() {}, remove() {}, addEventListener() {}, removeEventListener() {} });
  const html = el('html');
  const document = { documentElement: html, head: el('head'), body: el('body'), readyState: 'complete', visibilityState: 'visible', baseURI: origin + path,
    createElement: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, getElementById: () => null };
  const parent = { WizAppServices: service ? { connect: (w, client) => { connected.push(client); return service; } } : undefined,
    postMessage: (m, o) => posted.push([m, o]) };
  const history = { state: null, length: 1, pushState() {}, replaceState() {}, back() {} };
  const ctx = { document, parent, history, location: new URL(origin + path), navigator: {}, URL, URLSearchParams, console, Promise, Map, Set, WeakMap, WeakSet,
    setTimeout: (f, ms, ...a) => { delays.push(ms); const t = setTimeout(f, ms, ...a); t.unref?.(); return t; }, clearTimeout, setInterval: () => 0, clearInterval() {}, queueMicrotask, structuredClone, Blob: globalThis.Blob, File: globalThis.File,
    MessageEvent: class {}, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, Event: class { constructor(t) { this.type = t; } },
    MutationObserver: class { observe() {} disconnect() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener: (t, fn) => (listeners[t] ||= []).push(fn), removeEventListener() {}, dispatchEvent: () => true,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.origin = opaque ? 'null' : origin; ctx.top = parent;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  // The shell's answer to a request the app posted (by postMessage, no same-origin services).
  const message = data => { const e = new ctx.MessageEvent(); Object.assign(e, { source: parent, origin, data, isTrusted: true }); for (const fn of listeners.message || []) fn(e); };
  const requests = op => posted.map(([m]) => m).filter(m => m?.type === 'wizard:app:request' && (!op || m.op === op));
  const reply = (req, value, error) => message({ type: 'wizard:app:reply', version: 1, id: req.id, value, error });
  // Answer the SDK's first `ready` request as a hosting shell, so later requests travel by postMessage.
  const hello = async () => { reply(requests('ready').at(-1), { version: 1, hosted: true }); await new Promise(r => setTimeout(r, 0)); };
  return { api: ctx.WizardApp, ctx, posted, listeners, connected, delays, requests, reply, hello, client: () => connected.at(-1) };
}
