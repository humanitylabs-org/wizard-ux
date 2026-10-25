import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const root = new URL('../../', import.meta.url);
export const read = path => readFileSync(new URL(path, root), 'utf8');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.nodeType = 1; this.dataset = {}; this.attrs = {}; this.children = []; this.parentNode = null; this.handlers = new Map(); this.isConnected = true; }
  setAttribute(k, v) { this.attrs[k] = v; if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; }
  append(...nodes) { nodes.forEach(n => this.insertBefore(n, null)); }
  appendChild(n) { this.append(n); return n; }
  insertBefore(n, before) { n.remove(); const at = this.children.indexOf(before); this.children.splice(at < 0 ? this.children.length : at, 0, n); n.parentNode = this; }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); this.parentNode.children.splice(i, 1); this.parentNode = null; } }
  replaceChildren(...nodes) { [...this.children].forEach(n => n.remove()); this.append(...nodes); }
  contains(n) { return this === n || this.children.some(c => c.contains(n)); }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  querySelector(q) { const m = q.match(/^\[data-(slot|part)="([a-z-]+)"\]$/); if (!m) return null; for (const n of this.children) { if (n.dataset[m[1]] === m[2]) return n; const deep = n.querySelector(q); if (deep) return deep; } return null; }
  closest(q) { const m = q.match(/^\[data-(slot|part)="([a-z-]+)"\]$/); if (m && this.dataset[m[1]] === m[2]) return this; return this.parentNode?.closest(q) || null; }
  addEventListener(t, fn) { if (!this.handlers.has(t)) this.handlers.set(t, new Set()); this.handlers.get(t).add(fn); }
  removeEventListener(t, fn) { this.handlers.get(t)?.delete(fn); }
  fire(t, e) { for (const fn of this.handlers.get(t) || []) fn(e); }
}
export function fixture({ shell = 'phone', manifests = {} } = {}) {
  const html = new Element('html'), body = new Element('body'), thread = new Element(), list = new Element(), head = new Element(); html.dataset.shell = shell; body.append(thread, list);
  thread.setAttribute('data-part', 'thread'); list.setAttribute('data-part', 'list');
  const slots = JSON.parse(read('web/core/slots.json'));
  for (const name of Object.keys(slots.slots)) { const el = new Element(); el.setAttribute('data-slot', name); (name === 'list-top' ? list : thread).append(el); }
  const actions = new Element(); actions.setAttribute('data-part', 'thread-actions'); thread.append(actions);
  const doc = { baseURI: 'https://wizard.test/wizard-os-home/', documentElement: html, head, body, createElement: t => new Element(t), createComment: () => new Element('comment'), querySelector: q => body.querySelector(q), addEventListener() {} };
  const toasts = [], storage = new Map(); let route = { view: 'thread', thread: 's1', desk: 1 }, newThreads = 0, refreshes = 0, deferred = null, overview = null;
  const window = { dispatchEvent() {}, WosResources: { sync() { refreshes++; } }, WosBoomerang: { someday: async ({ sessionId }) => { deferred = sessionId; } }, WosSwipeIntent: { intentional: (dx, dy) => Math.abs(dx) > 60 && Math.abs(dx) > dy } };
  const ctx = { window, document: doc, URL, Event, console, setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout, performance, innerWidth: 390, structuredClone, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }, fetch: async url => { const id = url.split('/tweaks/')[1].split('/').slice(0, 2).join('/'); return { ok: true, json: async () => manifests[id] || JSON.parse(read(`web/tweaks/${id}/manifest.json`)) }; } };
  vm.runInNewContext(read('web/core/skin-host.js'), ctx); const host = window.WosSkinHost;
  host._test.setImporter(async url => { if (url.includes('/layouts/')) return { default: () => () => {} }; const src = read('web/tweaks/' + url.split('/tweaks/')[1].split('?')[0]); return vm.runInNewContext(`(() => { ${src.replace('export default function setup', 'function setup')} ; return { default: setup }; })()`, ctx); });
  host.attach({ overview: { use: options => { overview = options; return () => { if (overview === options) overview = null; }; } }, route: () => route, root: () => body, dock: () => null, back: () => { if (route.view !== 'thread') return false; route = { view: 'list', thread: null, desk: 1 }; return true; }, newThread: () => { newThreads++; }, openThread: id => { route = { ...route, view: 'thread', thread: id }; }, deskCount: () => 3, goDesk() {}, toast: t => toasts.push(t), models: async () => [{ value: 'test-model', provider: 'test', name: 'Test model' }], model: async choice => ({ model: choice?.id || 'test-model', provider: 'test' }) });
  return { host, ctx, doc, actions, thread, list, slots, toasts, get overview() { return overview; }, get newThreads() { return newThreads; }, get refreshes() { return refreshes; }, get deferred() { return deferred; }, async mount(id) { await host.loadTweaks([id], slots, { teamAuthors: ['miguel'] }); }, async clear() { await host.loadTweaks([], slots); }, route: () => route };
}
export async function contract(id, check, shell) { const f = fixture({ shell }); await f.mount(id); assert.ok(f.host.tweakState.includes(id)); await check(f); await f.clear(); assert.equal(f.host.tweakState.length, 0); }
