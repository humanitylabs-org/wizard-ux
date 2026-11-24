// The browser owner boundary's two ends, real code in node:vm, joined by a fake postMessage bus with real origin and
// source checks: web/core/browser-boundary.js (the shell) and web/core/browser-boundary-client.js (a sandboxed app
// frame). Same recipe as tests/browser-boundary-frames.test.mjs; for tests that need one served round trip.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './shell-parts.mjs';
import { withWebParts } from './web-parts.mjs';

const read = p => withShellParts(withWebParts(readFileSync(new URL('../../' + p, import.meta.url), 'utf8')));
const SHELL_SRC = read('web/core/browser-boundary.js'), CLIENT_SRC = read('web/core/browser-boundary-client.js');
export const ORIGIN = 'https://box.example.ts.net';
export const tick = () => new Promise(r => setTimeout(r, 0));
const clone = v => JSON.parse(JSON.stringify(v));
function listeners() {
  const map = new Map();
  return { add: (t, fn) => { if (!map.has(t)) map.set(t, new Set()); map.get(t).add(fn); }, remove: (t, fn) => map.get(t)?.delete(fn),
    fire: (t, e) => { for (const fn of [...(map.get(t) || [])]) fn(e); } };
}
const classes = () => { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c) }; };

// A shell with the boundary on and one sandboxed app frame attached; `serve` is the shell's one service handler.
export async function boundaryPair(serve) {
  const ev = listeners();
  const g = { setTimeout, clearTimeout, crypto: globalThis.crypto, JSON, console, Promise, Object, String, Map, Set, URL };
  g.window = g; g.top = g; g.location = { href: ORIGIN + '/wizard-os-home/', origin: ORIGIN };
  g.WizShellBoundary = { on: true }; g.addEventListener = ev.add; g.removeEventListener = ev.remove;
  g.document = { activeElement: null }; g.WizAppearance = { sync() {} };
  vm.createContext(g); vm.runInContext(SHELL_SRC, g);
  const B = g.WizBrowserBoundary;
  const app = listeners(), fev = listeners(), doc = listeners();
  const a = { setTimeout, clearTimeout, crypto: globalThis.crypto, JSON, console, Promise, Object, String, Map, Set, Error };
  a.window = a; a.origin = 'null'; a.location = { origin: ORIGIN, href: ORIGIN + '/messenger/' };
  a.addEventListener = app.add; a.removeEventListener = app.remove; a.document = { activeElement: null, addEventListener: doc.add };
  a.InputEvent = class {};
  a.parent = { postMessage(data, target) { if (target === ORIGIN) queueMicrotask(() => ev.fire('message', { source: a, origin: 'null', data: clone(data) })); } };
  a.postMessage = data => queueMicrotask(() => app.fire('message', { source: a.parent, origin: ORIGIN, data: clone(data) }));
  vm.createContext(a);
  const attrs = new Map([['sandbox', 'allow-scripts allow-forms allow-downloads']]);
  const el = { tagName: 'IFRAME', isConnected: true, contentWindow: a, hasAttribute: n => attrs.has(n), getAttribute: n => attrs.get(n) ?? null,
    setAttribute: (n, v) => attrs.set(n, v), addEventListener: fev.add, removeEventListener: fev.remove,
    closest: sel => (sel === '.win' ? { classList: classes() } : null), getClientRects: () => [1] };
  vm.runInContext(CLIENT_SRC, a);
  a.WizBoundaryClient.connect({ onBack: () => false });
  B.attach(el); await tick();
  B.serve(serve);
  return { B, el, client: a.WizBoundaryClient };
}
