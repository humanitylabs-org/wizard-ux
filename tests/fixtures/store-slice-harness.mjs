// Slices of web/store/store.js run in node:vm (wizard-ux issue 1674). store.js is a browser module with imports and
// a top-level await on the shell, so tests take the named pieces they need and give them plain stubs.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as status from '../../web/store/store-status.js';
import { renderInstallResult, successMessage } from '../../web/store/store-install-result.js';

export const storeSrc = readFileSync(new URL('../../web/store/store.js', import.meta.url), 'utf8');
export const cut = (a, b) => { const i = storeSrc.indexOf(a), j = storeSrc.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return storeSrc.slice(i, j); };
// The KINDS table, kindOf, the text helpers and clean() exactly as store.js has them.
export const KIND_SRC = cut('  const KINDS = [', '  // Four quiet entry points') + cut('  const ID = /^', '  const get = p =>');

// Runs `code` (sliced from store.js) after the shared KINDS/clean prelude in a context with `extra`.
export function storeContext(code, extra = {}) {
  const ctx = { storeKind: status.storeKind, compareApps: status.compareApps, renderInstallResult, successMessage, esc: s => String(s ?? ''), cap: s => s ? s[0].toUpperCase() + s.slice(1) : '', ...extra };
  vm.createContext(ctx);
  vm.runInContext(KIND_SRC + code, ctx);
  return ctx;
}
