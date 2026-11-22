import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('web/store/store.js');
const action = src.slice(src.indexOf('  function action('), src.indexOf('  const row ='));
const render = (state, {busy = false, installed = false, open = false, reason = '', architecture = 'amd64', framed = false, kind = 'apps', late = false, watched = []} = {}) =>
  Function('status', 'S', 'architectureReason', 'esc', 'key', 'isInstalled', 'canOpen', 'openId', 'progressText', 'framed', 'kindOf', 'watchOpen', `${action}; return action({id:'fixture'}, 'big');`)(
    () => state, {busy: new Set(busy ? ['fixture'] : []), architecture, late: new Set(late ? ['fixture'] : [])}, () => reason, x => x, () => 'fixture', () => installed, () => open, () => 'fixture', () => 'Installing…',
    framed, () => ({id: kind}), a => watched.push(a.id));
test('Store semantics preserve action precedence, hooks and compatibility while colouring each status', () => {
  for (const [state, options, cls, label] of [
    ['get', {}, '', 'Get'], ['installed', {installed:true,open:true}, 'open', 'Open'],
    ['installed', {installed:true}, 'have', '✓ Installed'], ['update', {}, 'upd', 'Update'],
    ['switch', {}, 'upd', 'Switch release'],
    ['unknown', {}, 'wait', 'Status unavailable'], ['update', {busy:true}, 'wait', 'Installing…'],
    ['get', {reason:'arm64 only'}, 'wait', 'Not compatible'],
    ['get', {reason:'unknown host',architecture:''}, 'wait', 'Compatibility unavailable'],
  ]) {
    const html = render(state, options);
    assert.ok(html.includes(`class="get ${cls ? cls + ' ' : ''}big"`), html);
    assert.ok(html.includes(label), html);
    if (['wait','warn','have'].includes(cls)) assert.doesNotMatch(html, /data-get|data-open/);
  }
  // A source conflict is a status (the "Source conflict" badge beside the name), never a pill that looks tappable.
  const conflict = render('conflict');
  assert.doesNotMatch(conflict, /class="get|data-get|data-open|<button/);
  assert.doesNotMatch(conflict, /Resolve/);
});
test('Open replaces Installed once the installed app is openable', () => {
  const html = render('installed', {installed:true, open:true});
  assert.match(html, /class="get open big"[^>]*data-open="fixture"[^>]*>Open<\/button>/);
  assert.doesNotMatch(html, /Installed|install-actions/);
  assert.match(src, /\$\{action\(a, 'big'\)\}/, 'the detail renderer uses the same exclusive action');
});
test('issue 1652: an installed app the shell cannot open yet shows Starting… and is watched, then Open after the wait', () => {
  const watched = [];
  const starting = render('installed', {installed:true, framed:true, watched});
  assert.match(starting, /class="get wait big" data-starting="fixture"[^>]*>Starting…<\/span>/);
  assert.doesNotMatch(starting, /✓ Installed|data-get/);
  assert.deepEqual(watched, ['fixture'], 'Starting… re-checks the shell until the app opens');
  const late = render('installed', {installed:true, framed:true, late:true});
  assert.match(late, /class="get open big" data-open="fixture">Open<\/button>/);
  // Openable wins at once; screenless agent apps and the Store on its own keep the passive pill.
  assert.match(render('installed', {installed:true, framed:true, open:true}), /data-open="fixture">Open</);
  assert.match(render('installed', {installed:true, framed:true, kind:'agent-apps'}), /✓ Installed/);
  assert.match(render('installed', {installed:true}), /✓ Installed/);
});
// watchOpen/checkStarting from store.js with manual timers and clock, a fake shell registry and repaint counter.
function starting({ opensAfter = Infinity } = {}) {
  const body = src.slice(src.indexOf('  const openId = a =>'), src.indexOf('  /* ---------------- pieces'));
  const timers = [], ctx = { now: 0, refreshes: 0, appRefreshes: 0, timers };
  Object.assign(ctx, { framed: true, key: a => a.id, document: { hidden: false }, refresh: () => { ctx.refreshes++; },
    Date: { now: () => ctx.now }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    S: { installed: new Map([['fixture', { id: 'fixture' }]]), starting: new Map(), late: new Set(), loaded: true, startT: 0, startN: 0, snapshot: null },
    parent: { WizCanOpen: () => ctx.appRefreshes >= opensAfter, WizCore: { refreshApps: async () => { ctx.appRefreshes++; } } } });
  Function('ctx', `with (ctx) { ${body}; ctx.watchOpen = watchOpen; }`)(ctx);
  const fire = async () => { const t = timers.shift(); ctx.now += t.ms; await t.fn(); return t.ms; };
  return { ctx, fire };
}
test('issue 1652: Starting… polls the shell registry with backoff and stops once the app opens or the wait ends', async () => {
  const a = { id: 'fixture' };
  const opens = starting({ opensAfter: 3 });
  opens.ctx.watchOpen(a); opens.ctx.watchOpen(a);
  assert.equal(opens.ctx.timers.length, 1, 'one watch per app');
  const delays = [await opens.fire(), await opens.fire(), await opens.fire()];
  assert.deepEqual(delays, [2000, 3000, 5000], 'backoff');
  assert.equal(opens.ctx.appRefreshes, 3, 'each check re-reads the shell registry');
  assert.equal(opens.ctx.S.starting.size, 0, 'the app opened: the watch ends');
  assert.equal(opens.ctx.refreshes, 1, 'and the Store repaints to Open');
  assert.equal(opens.ctx.timers.length, 0, 'no more polling');
  // Never opens: after the two-minute wait it is late (Open after the wait) and polling stops.
  const never = starting();
  never.ctx.watchOpen(a);
  let n = 0; while (never.ctx.timers.length && n++ < 40) await never.fire();
  assert.ok(never.ctx.now > 120000 && never.ctx.now < 135000, 'gives up after START_WAIT');
  assert.deepEqual([...never.ctx.S.late], ['fixture']);
  assert.equal(never.ctx.S.starting.size, 0);
  // Codex P2: a removed (or reinstalled) app never inherits an old wait.
  assert.match(src, /for \(const id of \[\.\.\.S\.late\]\) if \(!live\.has\(id\)\) S\.late\.delete\(id\)/);
  assert.match(src, /S\.starting\.delete\(id\); S\.late\.delete\(id\); \}   \/\/ a new install waits afresh/);
  assert.match(src, /if \(framed\) openInShell\(o\.dataset\.open\)/);
});
test('a fresh installed-app snapshot exposes Open before the parent registry finishes refreshing', () => {
  const declaration = src.match(/^  const canOpen = a => .*;$/m)?.[0];
  assert.ok(declaration, 'canOpen declaration');
  const result = Function('S', 'framed', 'parent', 'openId', 'a', `${declaration}; return canOpen(a);`)(
    {snapshot:{shell:[{id:'fixture',url:'/fixture/'}]}}, true, {WizCanOpen:() => false}, () => 'fixture', {id:'fixture'});
  assert.equal(result, true);
});
test('new status colour rules use tokens, not literal white or fixed washes', () => {
  const css = read('web/store/store.css');
  // each status pill the real action() draws, on mini-dom, under the Store stylesheet
  const literal = /#[0-9a-f]{3,8}\b|rgba?\(|\bwhite\b/i;
  const seen = {};
  for (const [state, options] of [['get', {}], ['installed', {installed: true, open: true}], ['installed', {installed: true}], ['update', {}],
    ['unknown', {}], ['get', {reason: 'arm64 only'}]]) {
    const doc = createDocument(), list = doc.createElement('div'); list.className = 'row'; doc.body.appendChild(list);
    list.innerHTML = render(state, options);
    const pill = list.querySelector('.get'); assert.ok(pill, state);
    const won = cascade(pill, css);
    for (const prop of ['color', 'background']) {
      assert.ok(won[prop], `${pill.className}: ${prop} is set`);
      assert.doesNotMatch(won[prop].value, literal, `${pill.className} ${prop}: tokens only`);
    }
    seen[pill.className] = won.color.value;
  }
  assert.match(seen['get big'], /^var\(--(wz|s)-on-accent/, 'Get text is an on-accent token');
  const doc = createDocument(), small = doc.createElement('button'); small.className = 'get'; doc.body.appendChild(small);
  assert.equal(cascade(small, css).color.value, 'var(--wz-on-accent, var(--s-on-accent))', 'a list-row Get follows the skin on-accent token');
  assert.equal(seen['get open big'], 'var(--wz-base, var(--bg))', 'a later rule never overrides the Open foreground');
});
