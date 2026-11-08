// AI Look up: static + unit contract for the Chats selection menu entry and the shared popover (core/lookup-pop.js).
// The real-browser behaviour (same-frame paint, abort, Back, retry, copy) is tests/lookup-pop.browser.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const menuSrc = read('core/sel-menu.js'), popSrc = read('core/lookup-pop.js'), popCss = read('core/lookup-pop.css'), chatsCss = read('core/chats.css');

function menuIn(store = {}) {
  const w = { getSelection: () => ({ isCollapsed: true }), addEventListener() {}, innerWidth: 400, innerHeight: 800 };
  const ctx = { window: w, document: { readyState: 'complete', addEventListener() {}, documentElement: { dataset: {} } },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }, requestAnimationFrame() {}, getComputedStyle: () => ({ getPropertyValue: () => '' }), console };
  vm.createContext(ctx); vm.runInContext(menuSrc, ctx);
  return { M: w.WosSelMenu, store };
}

test('the selection menu offers Look up between Quote and Search/Select all, on by default', () => {
  const { M } = menuIn();
  assert.deepEqual([...M.ITEMS.map(i => i.id)], ['copy', 'share', 'quote', 'lookup', 'search', 'all']);
  assert.deepEqual([...M.enabled()], ['copy', 'share', 'quote', 'lookup', 'search', 'all']);
  assert.equal(M.ITEMS.find(i => i.id === 'lookup').label, 'Look up');
  assert.equal((menuSrc.match(/data-sm="\$\{id\}"/g) || []).length, 1, 'one control per action, one render path');
});

test('a menu saved before Look up existed gains it; a choice made after respects the toggle', () => {
  const old = menuIn({ 'wos.selmenu': JSON.stringify(['copy', 'quote']) });
  assert.deepEqual([...old.M.enabled()], ['copy', 'quote', 'lookup'], 'new item starts on, old choices kept');
  old.M.setEnabled(['copy', 'quote']); // Settings → Text selection menu switching Look up off
  assert.deepEqual([...old.M.enabled()], ['copy', 'quote'], 'switched off stays off');
  assert.deepEqual(JSON.parse(old.store['wos.selmenu.known']), [...old.M.ITEMS.map(i => i.id)]);
  assert.match(old.M.html(), /data-smset="lookup"/, 'Settings → Text selection menu has the Look up toggle');
});

test('Look up is hidden in private/Incognito threads and inside the popover itself; the tap paints before any request', () => {
  assert.match(menuSrc, /function lookupOk\(c\)[\s\S]*c\.lk[\s\S]*\.private/);
  assert.match(menuSrc, /id === 'lookup'[\s\S]*L\.open\(/);
  assert.ok(menuSrc.indexOf("if (id === 'lookup')") < menuSrc.indexOf("if (id === 'search')"));
  assert.ok(!/await/.test(menuSrc.slice(menuSrc.indexOf("if (id === 'lookup')"), menuSrc.indexOf("if (id === 'search')"))), 'no await between the tap and the popover paint');
  assert.match(popSrc, /paint\('Explaining…', 'loading'\);[^\n]*same frame[^\n]*\n\s*status = 'loading';\n\s*void run\(\);/);
});

test('popover contract: Wisdom endpoint shape, exact fast model, abort fences, no storage, no tokens', () => {
  assert.match(popSrc, /\/wizard\/v1\/lookup\/stream/); assert.match(popSrc, /claude-haiku-4-5/);
  assert.match(popSrc, /AbortController/); assert.match(popSrc, /serial\+\+/); assert.match(popSrc, /const current = \(\) => mine === serial/);
  assert.match(popSrc, /r\.model === MODEL/); assert.match(popSrc, /split\(\/\\s\+\/\)\.length <= 70/);
  assert.match(popSrc, /SIDE = 800/); assert.match(popSrc, /MAX_CHARS = 128, MAX_WORDS = 8/);
  assert.ok(!/localStorage|sessionStorage|indexedDB|Authorization|Bearer|token/i.test(popSrc), 'nothing stored, no credentials in the browser');
  assert.match(popSrc, /AI explanation/); assert.match(popSrc, /data-lk-retry/);
});

test('popover is opaque, skinned by --wz-* tokens, selectable, and owns one Back layer', () => {
  assert.match(popCss, /background: var\(--wz-panel\);/); assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(popCss), 'no literal colours: tokens only (the kit defaults are the dark standalone fallback)'); assert.ok(!/rgba\([^)]*\)\s*[,;]?\s*backdrop|backdrop-filter/.test(popCss), 'no glass');
  for (const t of ['--wz-text', '--wz-border', '--wz-accent', '--wz-radius', '--wz-font-ui', '--wz-text-lg']) assert.ok(popCss.includes(t), t);
  assert.match(chatsCss, /\.wos-lookup \.lk-body \*[^{]*\{ user-select: text;/); assert.match(chatsCss, /\.wos-lookup \.lk-retry[^{]*\{ user-select: none;/);
  assert.match(read('core/escape-back.js'), /add\('lookup', \(\) => W\.WosLookup\?\.isOpen, \(\) => W\.WosLookup\.back\(\)\)/);
  for (const page of ['index.html', 'desktop.html']) { const h = read(page); assert.ok(h.includes('core/lookup-pop.js') && h.includes('core/lookup-pop.css'), page); assert.ok(h.indexOf('core/sel-menu.js') < h.indexOf('core/lookup-pop.js')); }
  assert.match(read('core/chats.js'), /function lookupScope\(id\)[\s\S]*INC\?\.active\(id\)[\s\S]*isPrivate/);
  assert.match(readFileSync(new URL('../docs/COMPONENTS.md', import.meta.url), 'utf8'), /`WosLookup` \(`lookup-pop\.js`\)/);
});

function popIn() {
  const w = { addEventListener() {}, innerWidth: 400, innerHeight: 800, getSelection: () => ({ isCollapsed: true, rangeCount: 0 }) };
  const ctx = { window: w, document: { readyState: 'complete', addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, contains: () => false, classList: { add() {} } }), body: { appendChild() {} } }, getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: f => 1, cancelAnimationFrame() {}, fetch: () => new Promise(() => {}), AbortController, TextDecoder, console };
  vm.createContext(ctx); vm.runInContext(popSrc, ctx); return w.WosLookup;
}
test('term normalisation hands trimmed punctuation back to the context and bounds each side to 800 chars', () => {
  const L = popIn();
  const n = L.normalise('“Plato’s Timaeus,”', 'See ', ' next');
  assert.equal(n.text, 'Plato’s Timaeus'); assert.equal(n.before, 'See “'); assert.equal(n.after, ',” next');
  const big = L.normalise('term', 'a'.repeat(2000), 'b'.repeat(2000));
  assert.equal(big.before.length, 800); assert.equal(big.after.length, 800);
});
