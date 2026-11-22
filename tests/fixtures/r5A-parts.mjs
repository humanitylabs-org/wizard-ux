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
