// Run one real shell part file (web/desktop/desktop-<part>.js, web/core/settings-<part>.js, ...) in a vm and call its
// part function with the names the shell would hand it. `scope` is the vm global (document, window extras); the part
// files hang off window.WizCore.<kind>Parts, so pre-set parts (stubs for the parts a part calls) are kept.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createDocument } from './mini-dom.mjs';

export const readWeb = p => readFileSync(new URL('../../web/' + p, import.meta.url), 'utf8');

export function partScope(extra = {}) {
  const document = extra.document || createDocument();
  const ctx = { console, setTimeout, clearTimeout, URL, Map, Set, ...extra, document };
  ctx.window = ctx; ctx.WizCore = ctx.WizCore || {};
  ctx.addEventListener ||= () => {}; ctx.removeEventListener ||= () => {};
  ctx.MutationObserver ||= class { observe() {} disconnect() {} };
  document.addEventListener ||= () => {};
  return vm.createContext(ctx);
}

// file: path under web/, e.g. 'desktop/desktop-settings.js'; kind: 'desktopParts'; part: 'settings'.
export function runPart(file, kind, part, args, ctx = partScope()) {
  vm.runInContext(readWeb(file), ctx);
  return { ctx, out: ctx.WizCore[kind][part](args) };
}

// Like runPart, but every name the part takes that `named` does not give is a recorder, and so is every free global
// the file reads (source-slice runRecording); calls land in ctx.calls as [name, ...args].
export async function runPartRecording(file, kind, part, named, ctx = partScope()) {
  const { recorder, runRecording } = await import('./source-slice.mjs');
  const calls = (ctx.calls ||= []);
  runRecording(readWeb(file), ctx, calls);
  const args = new Proxy(named, { get: (t, k) => (k in t ? t[k] : recorder(String(k), calls)), has: () => true });
  return { ctx, calls, out: ctx.WizCore[kind][part](args) };
}
