// AI Look up: static + unit contract for the Chats selection menu entry and the shared popover (core/lookup-pop.js).
// The real-browser behaviour (same-frame paint, abort, Back, retry, copy) is tests/lookup-pop.browser.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { pageAssets } from './fixtures/w1-pages.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { withParts } from './fixtures/chats-parts.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
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
  // the menu's real button row (show()'s render), on a page: one control per action, Look up among them
  const row = runRecording(`this.f = ids => ''\n${between(menuSrc, '      + ids.map(id => {', ".join('');")}.join('');`, { ITEMS: M.ITEMS, svg: () => '<svg></svg>', esc: String });
  const page = createDocument(); page.body.innerHTML = row.f([...M.enabled()]);
  assert.deepEqual(page.querySelectorAll('[data-sm]').map(b => b.dataset.sm), ['copy', 'share', 'quote', 'lookup', 'search', 'all'], 'one control per action');
  assert.equal(page.querySelector('[data-sm="lookup"]').textContent, 'Look up');
});

test('a menu saved before Look up existed gains it; a choice made after respects the toggle', () => {
  const old = menuIn({ 'wos.selmenu': JSON.stringify(['copy', 'quote']) });
  assert.deepEqual([...old.M.enabled()], ['copy', 'quote', 'lookup'], 'new item starts on, old choices kept');
  old.M.setEnabled(['copy', 'quote']); // Settings → Text selection menu switching Look up off
  assert.deepEqual([...old.M.enabled()], ['copy', 'quote'], 'switched off stays off');
  assert.deepEqual(JSON.parse(old.store['wos.selmenu.known']), [...old.M.ITEMS.map(i => i.id)]);
  assert.match(old.M.html(), /data-smset="lookup"/, 'Settings → Text selection menu has the Look up toggle');
});

// The real lookup-pop.js on tests/fixtures/mini-dom.mjs: the popover it draws, and what fetch saw when it was asked.
function popDom({ fetch } = {}) {
  const doc = createDocument(), asked = [];
  const w = { addEventListener() {}, innerWidth: 400, innerHeight: 800, getSelection: () => ({ isCollapsed: true, rangeCount: 0 }) };
  const ctx = { window: w, document: doc, getComputedStyle: () => ({ getPropertyValue: () => '', userSelect: 'text' }), requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    fetch: fetch || ((url, o) => { const el = doc.querySelector('.wos-lookup'); asked.push({ url, painted: el && !el.hidden ? el.querySelector('.lk-body').textContent : null }); return new Promise(() => {}); }),
    AbortController, TextDecoder, setTimeout: () => 0, clearTimeout() {}, console };
  vm.createContext(ctx); vm.runInContext(popSrc, ctx);
  return { L: w.WosLookup, doc, asked, w, ctx };
}
test('Look up is hidden in private/Incognito threads and inside the popover itself; the tap paints before any request', () => {
  // the real lookupOk (sel-menu.js) over the thread scope Chats reports
  const scopes = { pub: { private: false, frame: 'Wizard · Trip', agent: '', session: 's1' }, inc: { private: true } };
  const ok = runRecording(block(menuSrc, '  function lookupOk(c) {') + '\nglobalThis.ok = lookupOk;',
    { window: { WosLookup: { open() {} } }, host: () => ({ chats: { lookupScope: wid => { if (wid === 'boom') throw new Error('x'); return scopes[wid] || null; } } }) }).ok;
  const inMsg = { closest: s => (s === '.msg' ? {} : null) };
  assert.equal(ok({ wid: 'pub', block: inMsg }), true, 'a chat message in an ordinary thread');
  assert.equal(ok({ wid: 'inc', block: inMsg }), false, 'private / Incognito thread');
  assert.equal(ok({ wid: 'gone', block: inMsg }), false, 'unresolved scope fails closed');
  assert.equal(ok({ wid: 'boom', block: inMsg }), false, 'a scope error fails closed');
  assert.equal(ok({ wid: 'pub', block: inMsg, lk: true }), false, 'inside the popover itself');
  assert.equal(ok({ wid: '', block: { closest: () => null } }), false, 'words outside a chat message');
  // chats.js lookupScope: an Incognito window is private
  const chats = withParts(withShellParts(read('core/chats.js')));
  const scope = runRecording(block(chats, '  function lookupScope(id) {') + '\nglobalThis.scope = lookupScope;',
    { W: { a: { thread: 's1' } }, INC: { active: id => id === 'a' }, LIVE: { isPrivate: () => false }, AGS: () => ({ isPrivate: () => false }), winAgent: () => '', agentRec: () => null, agentName: () => 'Wizard', winTitle: () => 'Trip' }).scope;
  assert.equal(scope('a').private, true); assert.equal(scope('missing'), null);
  // the menu's Look up tap (sel-menu.js run): the popover opens on the tap, with no await before it
  const p = popDom(), opened = [];
  const real = p.L.open;
  const menu = runRecording(block(menuSrc, '  async function run(id) {') + '\nglobalThis.run = run;',
    { window: { WosLookup: { contextOf: () => ({ before: 'See ', after: ' next' }), open: o => { opened.push(o.text); return real(o); } } }, cur: { text: 'Timaeus', wid: 'pub', range: null },
      host: () => ({ chats: { lookupScope: wid => scopes[wid] } }) });
  void menu.run('lookup');
  assert.deepEqual(opened, ['Timaeus'], 'open is called synchronously, on the tap');
  assert.equal(p.asked.length, 1, 'then the request');
  assert.equal(p.asked[0].painted, 'Explaining…', 'the popover was painted before the request went out');
  assert.equal(p.L.state.request.frame, 'Wizard · Trip');
  // a private thread, re-checked at the tap: nothing opens
  const priv = runRecording(block(menuSrc, '  async function run(id) {') + '\nglobalThis.run = run;',
    { window: { WosLookup: { contextOf: () => ({ before: '', after: '' }), open: o => opened.push('private:' + o.text) } }, cur: { text: 'x', wid: 'inc', range: null }, host: () => ({ chats: { lookupScope: wid => scopes[wid] } }) });
  void priv.run('lookup'); assert.ok(!opened.includes('private:x'));
});

// A Wisdom lookup stream the test controls: newline-delimited JSON events, sent when the test says so.
function wisdom() {
  const calls = [];
  const fetch = (url, o) => new Promise(resolve => {
    const call = { url, o, body: JSON.parse(o.body), aborted: false };
    // an abort is recorded, but the answer may already be on its way: the popover's own fence must drop it
    o.signal?.addEventListener('abort', () => { call.aborted = true; });
    call.answer = (events, { ok = true, status = 200 } = {}) => {
      const chunks = events.map(e => new TextEncoder().encode(JSON.stringify(e) + '\n'));
      resolve({ ok, status, json: async () => ({}), body: { getReader: () => ({ read: async () => (chunks.length ? { value: chunks.shift(), done: false } : { done: true }) }) } });
    };
    calls.push(call);
  });
  return { fetch, calls };
}
const settleAll = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

test('popover contract: Wisdom endpoint shape, exact fast model, abort fences, no storage, no tokens', async () => {
  const g = wisdom(), touched = [];
  const p = popDom({ fetch: g.fetch });
  for (const k of ['localStorage', 'sessionStorage', 'indexedDB']) for (const o of [p.w, p.ctx]) Object.defineProperty(o, k, { get() { touched.push(k); return {}; } });
  const body = () => p.doc.querySelector('.wos-lookup .lk-body').textContent;
  // one POST to the agent service's lookup stream, same-origin cookies only, no credentials of its own
  p.L.open({ text: 'Timaeus', before: 'read the ', after: ' dialogue' });
  assert.equal(g.calls.length, 1);
  const c = g.calls[0];
  assert.equal(c.url, '/wizard/v1/lookup/stream'); assert.equal(c.o.method, 'POST'); assert.equal(c.o.credentials, 'same-origin');
  assert.deepEqual(Object.keys(c.o.headers), ['Content-Type'], 'no Authorization header');
  assert.equal(c.body.text, 'Timaeus'); assert.equal(c.body.before, 'read the '); assert.equal(c.body.after, ' dialogue');
  c.answer([{ type: 'delta', text: 'A dialogue ' }, { type: 'done', model: 'claude-haiku-4-5', text: 'A dialogue by Plato.' }]); await settleAll();
  assert.equal(body(), 'A dialogue by Plato.', 'the fast model\'s answer is shown');
  assert.match(p.doc.querySelector('.wos-lookup').textContent, /AI explanation/);
  // any other model, or an answer longer than 70 words, is refused
  for (const done of [{ type: 'done', model: 'claude-opus-4', text: 'Plato.' }, { type: 'done', model: 'claude-haiku-4-5', text: Array(71).fill('w').join(' ') }]) {
    p.L.open({ text: 'Critias' }); g.calls.at(-1).answer([done]); await settleAll();
    assert.equal(body().replace(/\s*Retry$/, ''), 'AI explanation unavailable.', JSON.stringify(done).slice(0, 60));
    assert.ok(p.doc.querySelector('[data-lk-retry]'), 'with Retry');
  }
  // a newer lookup aborts the older request, and the older answer never paints over it
  p.L.open({ text: 'Atlantis' }); const older = g.calls.at(-1);
  p.L.open({ text: 'Solon' }); const newer = g.calls.at(-1);
  assert.equal(older.aborted, true, 'the superseded request is aborted');
  newer.answer([{ type: 'done', model: 'claude-haiku-4-5', text: 'An Athenian lawmaker.' }]); await settleAll();
  older.answer([{ type: 'done', model: 'claude-haiku-4-5', text: 'A lost island.' }]); await settleAll();
  assert.equal(body(), 'An Athenian lawmaker.');
  // closing aborts too; a selection over 8 words or 128 characters is never sent
  p.L.open({ text: 'Critias' }); const open = g.calls.at(-1); p.L.close(); assert.equal(open.aborted, true);
  const n = g.calls.length;
  p.L.open({ text: 'one two three four five six seven eight nine' }); p.L.open({ text: 'x'.repeat(129) });
  assert.equal(g.calls.length, n, 'too long: nothing asked');
  assert.equal(body(), 'Select a word or short phrase to explain.');
  assert.deepEqual(touched, [], 'nothing stored in the browser');
});

test('popover is opaque, skinned by --wz-* tokens, selectable, and owns one Back layer', () => {
  const p = popDom({ fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  p.L.open({ text: 'Timaeus' });
  const pop = p.doc.querySelector('.wos-lookup'), sheets = [popCss, chatsCss].join('\n');
  const won = cascade(pop, sheets);
  assert.equal(won.background.value, 'var(--wz-panel)', 'opaque panel');
  assert.equal(won.color.value, 'var(--wz-text)'); assert.equal(won.border.value, '1px solid var(--wz-border)');
  assert.equal(won['border-radius'].value, 'var(--wz-radius)'); assert.equal(won['font-family'].value, 'var(--wz-font-ui)');
  assert.equal(won['backdrop-filter'], undefined, 'no glass');
  const literal = /#[0-9a-f]{3,8}\b|rgba?\(/i;
  for (const el of [pop, ...pop.querySelectorAll('*')]) for (const [prop, d] of Object.entries(cascade(el, popCss)))
    assert.doesNotMatch(d.value, literal, `${el.className || el.localName} ${prop}: tokens only (the kit defaults are the dark standalone fallback)`);
  assert.equal(cascade(pop.querySelector('.lk-body'), sheets)['font-size'].value, 'var(--wz-text-lg)');
  assert.equal(cascade(pop.querySelector('.lk-body'), sheets)['user-select'].value, 'text', 'its words are selectable');
  return new Promise(r => setTimeout(r, 0)).then(() => {
    const retry = pop.querySelector('.lk-retry'); assert.ok(retry, 'the error state offers Retry');
    assert.equal(cascade(retry, sheets)['user-select'].value, 'none', 'the Retry button is not');
    assert.equal(cascade(retry, sheets).color.value, 'var(--wz-accent)');
    // the shared Back catalog (escape-back.js): one press closes the popover, the next has nothing to close
    const ctx = vm.createContext({ window: p.w, document: { documentElement: {} }, MutationObserver: class { observe() {} disconnect() {} }, queueMicrotask() {} });
    vm.runInContext(read('core/escape-back.js'), ctx);
    const stack = p.w.WizEscapeBack.create(); p.w.WizEscapeBack.installOwners(stack, { chats: () => ({}), links: () => null });
    assert.equal(stack.run(), 'lookup'); assert.equal(p.L.isOpen, false); assert.equal(stack.run(), '');
    for (const page of ['index.html', 'desktop.html']) {
      const { srcs, styles } = pageAssets(page);
      assert.ok(styles.includes('core/lookup-pop.css'), page);
      assert.ok(srcs.indexOf('core/sel-menu.js') >= 0 && srcs.indexOf('core/sel-menu.js') < srcs.indexOf('core/lookup-pop.js'), page);
    }
  });
});

// static-rule: the components inventory (docs/COMPONENTS.md) names the shared lookup popover (a docs check)
test('docs/COMPONENTS.md lists WosLookup', () => {
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
