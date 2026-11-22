// The desktop's real key handler (onKey in web/desktop/desktop.js and its parts) in node:vm. Everything it calls that
// the test does not give becomes a recorder (tests/fixtures/source-slice.mjs), so a test presses a key and reads what
// the shell did (wizard-ux issue 1674: tests run the code).
import { readFileSync } from 'node:fs';
import { withDesktopParts } from './desktop-parts.mjs';
import { between, runRecording } from './source-slice.mjs';

export const desktopSource = withDesktopParts(readFileSync(new URL('../../web/desktop/desktop.js', import.meta.url), 'utf8'));

export function keyEvent(code, extra = {}) {
  return { key: extra.key ?? code, code, altKey: true, shiftKey: false, ctrlKey: false, metaKey: false, repeat: false,
    target: { value: '', matches: () => false, closest: () => null },
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() {}, ...extra };
}

// opts: anything to put in the handler's scope (homeOpen, focused, ws, cur, W, ...). Returns { calls, ctx, key }.
export function desktopKeys(opts = {}) {
  const calls = [];
  const ctx = { calls, pick: { active: () => false }, window: {}, globalThis: {}, keyHints: { pinned: () => false, down() {}, up() {} }, NATIVE_MENU: false, IS_MAC: true, MOD: '⌥',
    homeOpen: false, focused: () => null, typing: () => false, textField: () => false, keyField: e => e.target, ws: [{ wins: [] }], cur: 0, W: {}, document: { activeElement: null },
    log() {}, VOICE: { state: 'idle' }, ...opts };
  ctx.globalThis = ctx.globalThis && Object.keys(ctx.globalThis).length ? ctx.globalThis : ctx;
  runRecording(`${between(desktopSource, '  function onKey(e, fromFrame = false) {', "  addEventListener('keydown', e => onKey(e), true);")}\nthis.onKey = onKey;`, ctx, calls);
  return { calls, ctx, key(code, extra = {}) { const e = keyEvent(code, extra); ctx.onKey(e); return e; }, names: () => calls.map(c => c[0]) };
}
