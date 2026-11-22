// Run one real shell part file (web/app-<part>.js, web/core/chats-<part>.js, web/desktop/desktop-<part>.js ...) in
// node:vm and call its part function (wizard-ux issue 1674: tests run the code, they do not read it as text).
// Every free name the file uses that the test does not give becomes a recorder (tests/fixtures/source-slice.mjs), and
// every argument the part destructures that the test does not give is a recorder too, so a test hands over only the
// names whose behaviour it reads. Returns { out, calls, ctx }: out is what the part returned.
import { existsSync, readFileSync } from 'node:fs';
import { recorder, runRecording } from './source-slice.mjs';

export const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

export function loadFile(file, ctx = {}) {
  ctx.window ||= {};
  ctx.window.WizCore ||= {};
  for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent']) ctx.window[k] ||= () => {}; // a window listens
  return runRecording(read(file), ctx);
}

// file: path under the repo; ns: 'appParts' | 'chatsParts' | ...; name: the part; given: its arguments.
// A part that calls another part of the same shell (`window.WizCore.<ns>.<other>(...)`) gets that part's real file
// loaded first (same folder and prefix: web/app-<other>.js, web/core/chats-<other>.js ...), recursively.
function loadWithParts(file, ns, ctx, seen = new Set()) {
  if (seen.has(file)) return; seen.add(file);
  const prefix = file.slice(0, file.lastIndexOf('-') + 1);
  for (const m of read(file).matchAll(new RegExp(`window\\.WizCore\\.${ns}\\.([a-z]+)\\(`, 'g'))) {
    const other = `${prefix}${m[1]}.js`;
    if (other !== file && existsSync(new URL(`../../${other}`, import.meta.url))) loadWithParts(other, ns, ctx, seen);
  }
  loadFile(file, ctx);
}

export function runPart(file, ns, name, given = {}, ctx = {}) {
  loadWithParts(file, ns, ctx);
  const calls = ctx.calls;
  const args = new Proxy(given, { get: (t, k) => (k in t ? t[k] : recorder(String(k), calls)), has: () => true });
  const out = ctx.window.WizCore[ns][name](args);
  return { out, calls, ctx };
}

// tests/fixtures/mini-dom.mjs answers no `:scope`; the shells ask `el.querySelector(':scope > .x')` for a direct child.
// scoped(doc) teaches that document's elements `:scope > X` (X: a selector on the child itself) and `:scope X`,
import { matches } from './mini-dom.mjs';
export function scoped(doc) {
  const proto = Object.getPrototypeOf(doc.body);
  if (proto.r5bScoped) return doc;
  const all = proto.querySelectorAll, one = proto.querySelector;
  const pick = (el, sel) => {
    const m = /^\s*:scope\s*(>)?\s*([\s\S]+)$/.exec(sel); if (!m) return null;
    return m[1] ? el.children.filter(c => matches(c, m[2])) : all.call(el, m[2]);
  };
  proto.querySelectorAll = function (sel) { return pick(this, sel) ?? all.call(this, sel); };
  proto.querySelector = function (sel) { const p = pick(this, sel); return p ? p[0] || null : one.call(this, sel); };
  // and el.after(...nodes), which mini-dom lacks
  proto.after ||= function (...nodes) { const p = this.parentNode, next = p.childNodes[p.childNodes.indexOf(this) + 1] || null; for (const n of nodes) p.insertBefore(n, next); };
  proto.r5bScoped = true;
  return doc;
}
