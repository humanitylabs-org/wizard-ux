// Signal sweep card buttons (switch wizard/agent-inbox, wizard-ux issue 1586; box half wizard-agent-service issue 550):
// the live.js reader cut out of the file and run against a fake box, chat-kit's parseRows on a Daily history page with
// the card row, and the chats.js card block (real live.js normalizer + real chat-kit) drawn and tapped.
// Run: node --test tests/agent-inbox-sweep-card.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)

const live = withLiveParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const chats = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const running = readFileSync(new URL('../web/core/chats-running.js', import.meta.url), 'utf8'); // the agent inbox parts (issue 1665)
const kitSrc = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const clone = v => JSON.parse(JSON.stringify(v));
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, `${a} is in the file`); return src.slice(i, j); };

const CARD = 'sweep_' + 'c'.repeat(24), A = 'inbox_' + 'a'.repeat(24), B = 'inbox_' + 'b'.repeat(24), C = 'inbox_' + 'd'.repeat(24), R = 'inbox_' + 'e'.repeat(24);
// The card as wizard-agent-service server/agent-sweep.mjs cardView() serves it.
const card = (over = {}) => ({
  schema: 'wizard.agent-sweep/1', id: CARD, at: 1_763_500_000_000, day: '2026-11-19', thread_id: 'wizard_daily_1', agent: 'hermes',
  waiting: { items: [
    { id: A, agent: 'hermes', thread_id: 'wizard_worker_a', title: 'Lisbon flights', ask: 'Book the 9:40 or the 13:10?', recommendation: 'The 9:40: cheaper', options: [{ token: 'early' }, { token: 'late' }], default_option: 'early', confirm: false, seen: 2, state: 'surfaced', link: '/wizard-os-home/?session=wizard_worker_a' },
    { id: B, agent: 'hermes', thread_id: 'wizard_worker_b', title: 'Pay the plumber', ask: 'Send €120?', recommendation: '', options: [{ token: 'yes' }, { token: 'no' }], default_option: 'yes', confirm: true, seen: 1, state: 'surfaced', link: '/wizard-os-home/?session=wizard_worker_b' },
    { id: C, agent: 'hermes', thread_id: 'wizard_worker_c', title: 'Old ask', ask: '', recommendation: '', options: [{ token: 'yes' }], default_option: 'yes', confirm: false, seen: 1, state: 'answered', answer: 'yes', link: '/wizard-os-home/?session=wizard_worker_c' },
    { id: R, agent: 'box', thread_id: 'wizard_routed_1', title: 'Routed task', ask: 'Restart it?', recommendation: '', options: [{ token: 'yes' }], default_option: 'yes', confirm: false, seen: 1, state: 'surfaced', link: '/wizard-os-home/?session=wizard_routed_1&agent=box' },
  ], more: 2, link: '/wizard-os-home/?inbox=waiting' },
  done: { items: [{ id: 'inbox_' + 'f'.repeat(24), title: 'Tax form filed', link: '/wizard-os-home/?session=wizard_worker_f' }], more: 0, link: '/wizard-os-home/?inbox=done' },
  running: { count: 3, stale: 1, link: '/wizard-os-home/?inbox=running' }, later: { count: 4, link: '/wizard-os-home/?inbox=later' }, parked: { count: 0, link: '/wizard-os-home/?inbox=parked' },
  missing: 0, yes_to_all: { count: 2, skipped: 1 }, ...over,
});

function inboxReader(answer) {
  const calls = [], ctx = {};
  vm.createContext(ctx);
  vm.runInContext(slice(live, '  /* ---- agent inbox (wizard-ux issue 1569)', '/* ---- end agent inbox ---- */') + '\nthis.agentInbox = agentInbox;', ctx);
  const req = async (path, init = {}) => { calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); const a = await answer(path, init); if (a.status) { const e = new Error('HTTP ' + a.status); e.status = a.status; throw e; } return { json: async () => a.json }; };
  return { inbox: ctx.agentInbox({ req, emit: () => {} }), calls };
}

test('card() keeps the fields the shell draws and drops bad ids, tokens and links', () => {
  const { inbox } = inboxReader(() => ({ json: {} }));
  const v = clone(inbox.card(card()));
  assert.equal(v.id, CARD);
  assert.deepEqual(v.waiting.items.map(i => [i.id, i.agent, i.thread, i.options, i.def, i.confirm, i.seen, i.state]), [
    [A, 'hermes', 'wizard_worker_a', ['early', 'late'], 'early', false, 2, 'surfaced'],
    [B, 'hermes', 'wizard_worker_b', ['yes', 'no'], 'yes', true, 1, 'surfaced'],
    [C, 'hermes', 'wizard_worker_c', ['yes'], 'yes', false, 1, 'answered'],
    [R, 'box', 'wizard_routed_1', ['yes'], 'yes', false, 1, 'surfaced'],
  ]);
  assert.deepEqual(v.yes, { count: 2, skipped: 1 });
  assert.deepEqual([v.running.count, v.running.stale, v.later.count, v.waiting.more], [3, 1, 4, 2]);
  assert.equal(inbox.card({ ...card(), id: 'nope' }), null, 'not a card id');
  assert.equal(inbox.card(null), null);
  const bad = clone(inbox.card(card({ waiting: { items: [
    { id: '../x', title: 'bad id' },
    { id: A, title: 'x', options: [{ token: 'Bad Token' }, { token: 'ok' }, 'fine'], default_option: 'nope', link: 'javascript:alert(1)', thread_id: '../etc' },
  ], link: 'https://elsewhere.example/' } })));
  assert.equal(bad.waiting.items.length, 1);
  assert.deepEqual(bad.waiting.items[0].options, ['ok', 'fine']);
  assert.equal(bad.waiting.items[0].def, '');
  assert.equal(bad.waiting.items[0].link, '');
  assert.equal(bad.waiting.items[0].thread, '');
  assert.equal(bad.waiting.link, '/wizard-os-home/?inbox=waiting', 'an off-box link falls back to the list view');
});

test('answer() sends PATCH {action: answer, option}; Yes to all posts once to the card; sweep() reads the card', async () => {
  const f = inboxReader(path => ({ json: path.endsWith('/yes-to-all') ? { answered: [{ id: A, option: 'early' }], card: card() } : path.endsWith('/sweep') ? { card: card() } : { record: { id: A, state: 'answered' } } }));
  await f.inbox.answer(A, 'early');
  await f.inbox.answer(A, 'later');
  const all = await f.inbox.yesToAll(CARD);
  const v = await f.inbox.sweep();
  assert.deepEqual(clone(f.calls), [
    { path: `/wizard/v1/agent-inbox/${A}`, method: 'PATCH', body: { action: 'answer', option: 'early' } },
    { path: `/wizard/v1/agent-inbox/${A}`, method: 'PATCH', body: { action: 'answer', option: 'later' } },
    { path: `/wizard/v1/agent-inbox/${CARD}/yes-to-all`, method: 'POST', body: {} },
    { path: '/wizard/v1/agent-inbox/sweep', method: 'GET', body: null },
  ]);
  assert.deepEqual(clone(all.answered), [{ id: A, option: 'early' }]);
  assert.equal(all.card.id, CARD);
  assert.equal(v.id, CARD);
  await assert.rejects(f.inbox.answer('../x', 'yes'), /invalid/);
  await assert.rejects(f.inbox.answer(A, 'Bad Token'), /invalid/);
  await assert.rejects(f.inbox.yesToAll('inbox_x'), /invalid/);
  assert.equal(f.calls.length, 4, 'nothing sent for a bad id or token');
});

function kit() {
  const ctx = {
    location: { origin: 'https://wizard.example.ts.net', hostname: 'wizard.example.ts.net', href: 'https://wizard.example.ts.net/wizard-os-home/' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {}, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) },
    addEventListener() {}, setTimeout, clearTimeout, console, URL, Intl, Date,
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx); vm.runInContext(kitSrc, ctx);
  return ctx.WosChat;
}

test('parseRows: the card row is its own turn carrying the card, and a later reply never folds into it', () => {
  const K = kit(), t0 = 1_763_500_000;
  const row = { id: CARD, role: 'assistant', display_kind: 'agent_sweep', content: '**Signal sweep**', timestamp: t0 + 10, agent_sweep: card() };
  const turns = K.parseRows([
    { role: 'user', content: 'signal sweep', timestamp: t0 },
    { role: 'assistant', content: 'Posted.', timestamp: t0 + 5 },
    row,
    { role: 'assistant', content: 'One more thing.', timestamp: t0 + 20 },
  ]);
  assert.equal(turns.length, 3);
  assert.equal(turns[0].a.text, 'Posted.');
  assert.equal(turns[1].u, null);
  assert.equal(turns[1].a.sweep.id, CARD);
  assert.equal(turns[1].a.text, '**Signal sweep**', 'the markdown copy stays the text (Copy, older shells)');
  assert.equal(turns[2].a.text, 'One more thing.');
  assert.equal(turns[2].a.sweep, undefined);
  // Not a card object: an ordinary reply.
  const plain = K.parseRows([{ role: 'assistant', display_kind: 'agent_sweep', content: 'x', timestamp: t0, agent_sweep: 'nope' }]);
  assert.equal(plain[0].a.sweep, undefined);
});

// The chats.js block with the real normalizer and the real chat-kit.
function cardBlock({ on = true, listed = [], answer, yesToAll, sweep } = {}) {
  const box = inboxReader(() => ({ json: {} })).inbox;
  const toasts = [], paints = [], listeners = {}, sw = { on };
  const ctx = {
    window: { addEventListener: (t, f) => { (listeners[t] ||= []).push(f); } },
    KIT: kit(), esc: v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    inboxSwitchOn: () => sw.on, inboxListed: id => listed.includes(id), toast: (i, t) => toasts.push(t),
    CH: { w1: {} }, H: { win: () => ({ id: 'w1', thread: 'wizard_daily_1' }) }, renderThreadNow: () => paints.push(1),
    LIVE: { agentInbox: { card: box.card, answer: answer || (async () => ({})), yesToAll: yesToAll || (async () => ({ answered: [], card: null })), sweep: sweep || (async () => null) } },
  };
  vm.createContext(ctx);
  vm.runInContext(slice(running, '  const SWEEP = new Map();', '  return { alertFeedback') + '\nthis.api = { sweepHtml, sweepAnswer, sweepYesToAll, SWEEP };', ctx);
  const flip = v => { sw.on = v; for (const f of listeners['wos:experience'] || []) f(); };
  return { api: ctx.api, toasts, paints, flip };
}
const buttonsOf = (html, id) => [...html.matchAll(new RegExp(`data-chsweep="${id}" data-card="${CARD}" data-opt="([a-z-]+)"`, 'g'))].map(m => m[1]);

test('the card draws one button per token plus Later, Open to confirm, the answer, the age badge, Open and Yes to all', () => {
  const html = cardBlock({ listed: ['wizard_worker_b'] }).api.sweepHtml(card());
  assert.match(html, /^<div class="appr ch-sweep" role="group" aria-label="Signal sweep"/);
  assert.deepEqual(buttonsOf(html, A), ['early', 'late', 'later']);
  assert.match(html, /data-opt="early" class=" def"/, 'the default answer is marked');
  assert.deepEqual(buttonsOf(html, B), [], 'a confirm item has no answer buttons');
  assert.match(html, /<a href="\/wizard-os-home\/\?session=wizard_worker_b" class="wsl ch-sw-confirm" data-session="wizard_worker_b">Open to confirm<\/a>/);
  assert.deepEqual(buttonsOf(html, C), [], 'an answered item shows its answer');
  assert.match(html, /Answered: Yes/);
  assert.match(html, /<span class="ch-sw-age"[^>]*>Sweep 2<\/span>/, 'age badge from seen');
  assert.equal((html.match(/class="ch-sw-age"/g) || []).length, 1, 'no badge on a first sweep');
  assert.match(html, /data-chinboxopen="wizard_worker_a"[^>]*>Open</, 'Open for a hidden main-agent thread');
  assert.doesNotMatch(html, /data-chinboxopen="wizard_worker_b"/, 'not for one already in the list');
  assert.match(html, /data-chsweepall="sweep_c{24}">Yes to all \(2\)</);
  assert.match(html, /1 to confirm yourself/);
  assert.match(html, /Waiting on you \(6\)/);
  assert.match(html, /and 2 more/);
  assert.match(html, /Tax form filed/);
  assert.match(html, /<button type="button" class="ch-sw-run" data-chsweeprunning[^>]*>Running: 3<\/button>, 1 with no news for 6 h/, 'Running opens the Running view');
  assert.doesNotMatch(html, /href="[^"]*\?inbox=/, 'no ?inbox= list link: those views do not exist in the shell yet');
  assert.match(html, /and 2 more/);
  assert.match(html, /Later and FYI: 4/);
  assert.match(html, /<a href="\/wizard-os-home\/\?session=wizard_worker_a" class="wsl" data-session="wizard_worker_a">Lisbon flights<\/a>/, 'thread via the normal deep link');
});

test('an archived item reads Archived, not Done; the Running button goes to the Running view', () => {
  const html = cardBlock().api.sweepHtml(card({ waiting: { items: [{ ...card().waiting.items[0], state: 'archived' }], more: 0 } }));
  assert.match(html, /<small class="ch-sw-st">Archived<\/small>/);
  assert.doesNotMatch(html, /ch-sw-st">Done</);
  // the real tap handler (chats-bind.js): the desktop list pane shows Running, else the one pane steps back first
  const tap = slice(chats, "    if (e.target.closest('[data-chsweeprunning]')) {", "    const swa = e.target.closest('[data-chsweepall]')");
  const press = ({ listOn, ownOn }) => {
    const calls = [], w = { id: 'c1' }, lw = { id: 'c1::list' };
    const W = { c1: w, ...(listOn === undefined ? {} : { 'c1::list': lw }) };
    const ctx = { e: { target: { closest: q => q === '[data-chsweeprunning]' ? {} : null } }, w, W, owner: id => id,
      runningOn: x => x === lw ? !!listOn : !!ownOn, runningGo: (x, on) => calls.push(['runningGo', x.id, on]),
      chatsBack: x => calls.push(['chatsBack', x.id]), H: { toast: (...a) => calls.push(['toast', a[1]]) } };
    vm.runInNewContext(`(() => {\n${tap}\n})()`, ctx);
    return JSON.stringify(calls);
  };
  assert.equal(press({ listOn: true }), '[["runningGo","c1::list",true]]', 'desktop: the list pane beside the thread');
  assert.equal(press({ ownOn: true }), '[["chatsBack","c1"],["runningGo","c1",true]]', 'one pane: back to the list, then Running');
  assert.equal(press({ listOn: false, ownOn: true }), '[["chatsBack","c1"],["runningGo","c1",true]]');
  assert.equal(press({}), '[["toast","The Running view is in the Chats window"]]', 'no Running view here: says where it is');
});

test('main versus routed: a routed agent\'s item answers by record id but never opens as a main-agent thread', () => {
  const html = cardBlock().api.sweepHtml(card());
  assert.deepEqual(buttonsOf(html, R), ['yes', 'later'], 'the buttons still answer it');
  assert.doesNotMatch(html, /data-session="wizard_routed_1"/, 'no main-agent link');
  assert.doesNotMatch(html, /data-chinboxopen="wizard_routed_1"/, 'no Open');
  const confirm = cardBlock().api.sweepHtml(card({ waiting: { items: [{ ...card().waiting.items[3], confirm: true }], more: 0 } }));
  assert.match(confirm, /Open its thread to confirm/);
  assert.doesNotMatch(confirm, /ch-sw-confirm/);
});

test('switch off (or not a card): no card, the markdown copy shows', () => {
  assert.equal(cardBlock({ on: false }).api.sweepHtml(card()), '');
  assert.equal(cardBlock().api.sweepHtml({ id: 'x' }), '');
  // the real turn body (chats-attach.js turnHtml): a sweep card replaces the markdown copy, else the copy shows
  const bodyOf = slice(chats, '      const sweep = tn.a?.sweep', '(url, marker) =>');
  const turnBody = (tn, sweepHtml) => vm.runInNewContext(`${bodyOf}null) : ''); body`, { tn, sweepHtml, md: t => `<p>${t}</p>` });
  const on = cardBlock().api.sweepHtml;
  assert.equal(turnBody({ a: { text: 'copy', sweep: card() } }, on), on(card()), 'the card, not the copy');
  assert.equal(turnBody({ a: { text: 'copy', sweep: card() } }, cardBlock({ on: false }).api.sweepHtml), '<p>copy</p>', 'switch off: the copy');
  assert.equal(turnBody({ a: { text: 'copy' } }, on), '<p>copy</p>', 'no card: the copy');
  assert.equal(turnBody({ a: { text: 'copy', sweep: card() } }, undefined), '<p>copy</p>', 'no card part loaded: the copy');
});

test('tapping a token posts the answer, the item shows as answered, and the card is read again', async () => {
  const sent = [];
  const after = card(); after.waiting.items[0] = { ...after.waiting.items[0], state: 'answered', answer: 'early' }; after.yes_to_all = { count: 0, skipped: 1 };
  const f = cardBlock({ answer: async (id, opt) => { sent.push([id, opt]); return {}; }, sweep: async () => inboxReader(() => ({ json: {} })).inbox.card(after) });
  f.api.sweepHtml(card());
  const p = f.api.sweepAnswer(CARD, A, 'early');
  assert.match(f.api.sweepHtml(card()), /data-opt="early"[^>]*disabled>Sending…</, 'the tap shows Sending… at once');
  await p;
  assert.deepEqual(sent, [[A, 'early']]);
  const html = f.api.sweepHtml(card());
  assert.deepEqual(buttonsOf(html, A), []);
  assert.match(html, /Answered: Early/);
  assert.doesNotMatch(html, /data-chsweepall/, 'Yes to all is gone once nothing is left for it');
  assert.ok(f.paints.length >= 2, 'repainted after the tap and after the read');
  assert.deepEqual(f.toasts, ['Answer sent']);
});

test('Later snoozes: no answer posted into the thread, the item says it comes back', async () => {
  const sent = [];
  const f = cardBlock({ answer: async (id, opt) => { sent.push([id, opt]); return {}; } });
  f.api.sweepHtml(card());
  await f.api.sweepAnswer(CARD, A, 'later');
  assert.deepEqual(sent, [[A, 'later']]);
  const html = f.api.sweepHtml(card());
  assert.deepEqual(buttonsOf(html, A), []);
  assert.match(html, /Later · back at the next sweep/);
});

test('a failed answer keeps the buttons and says so; even with no reread the card stays usable', async () => {
  const f = cardBlock({ answer: async () => { throw Object.assign(new Error('x'), { status: 503 }); } });
  f.api.sweepHtml(card());
  await f.api.sweepAnswer(CARD, A, 'early');
  assert.deepEqual(buttonsOf(f.api.sweepHtml(card()), A), ['early', 'late', 'later']);
  assert.deepEqual(f.toasts, ['Couldn’t send the answer · try again']);
});

test('Yes to all sends one request for the card and repaints from its answer (confirm items left to the owner)', async () => {
  const calls = [];
  const after = card(); after.waiting.items = after.waiting.items.map(i => i.confirm || i.state === 'answered' ? i : { ...i, state: 'answered', answer: i.default_option }); after.yes_to_all = { count: 0, skipped: 1 };
  const norm = inboxReader(() => ({ json: {} })).inbox.card;
  const f = cardBlock({ yesToAll: async id => { calls.push(id); return { answered: [{ id: A, option: 'early' }, { id: R, option: 'yes' }], card: norm(after) }; } });
  f.api.sweepHtml(card());
  const p = f.api.sweepYesToAll(CARD);
  assert.match(f.api.sweepHtml(card()), /data-chsweepall="sweep_c{24}" disabled>Sending…</);
  await p;
  assert.deepEqual(calls, [CARD], 'one request');
  const html = f.api.sweepHtml(card());
  assert.deepEqual(buttonsOf(html, A), []);
  assert.deepEqual(buttonsOf(html, R), []);
  assert.match(html, /Open to confirm/, 'the confirm item still waits for the owner');
  assert.deepEqual(f.toasts, ['2 answers sent']);
});

test('the buttons are wired in the click handler and every card rule is scoped to the switch with skin tokens', () => {
  // the drawn card, tapped through the real click lines of core/chats-bind.js
  const bind = readFileSync(new URL('../web/core/chats-bind.js', import.meta.url), 'utf8');
  const lines = [slice(bind, "    const swb = e.target.closest('[data-chsweep]');", '\n'), slice(bind, "    const swa = e.target.closest('[data-chsweepall]');", '\n')].join('\n');
  const calls = [], ctx = { sweepAnswer: (...a) => calls.push(['answer', ...a]), sweepYesToAll: (...a) => calls.push(['all', ...a]) };
  vm.createContext(ctx); const click = vm.runInContext(`(e => {\n${lines}\nreturn false;\n})`, ctx);
  const doc = createDocument(); doc.documentElement.setAttribute('data-tweaks', 'wizard/agent-inbox');
  doc.body.innerHTML = cardBlock().api.sweepHtml(card());
  const tap = n => click({ target: n });
  assert.equal(tap(doc.querySelector(`[data-chsweep="${A}"][data-opt="late"]`)), true);
  assert.equal(tap(doc.querySelector('[data-chsweepall]')), true);
  assert.deepEqual(calls, [['answer', CARD, A, 'late'], ['all', CARD]], 'a token answers its item; Yes to all the card');
  const off = doc.querySelector(`[data-chsweep="${A}"][data-opt="early"]`); off.disabled = true; assert.equal(tap(off), true); assert.equal(calls.length, 2, 'a disabled button sends nothing');
  assert.equal(click({ target: doc.body }), false, 'anything else is not the card\'s');
  // the styles: the switch's own sheet on the drawn card; nothing without the switch
  const css = readFileSync(new URL('../web/tweaks/wizard/agent-inbox/tweak.css', import.meta.url), 'utf8'), panel = doc.querySelector('.appr.ch-sweep');
  assert.equal(cascade(panel, css).background?.value, 'var(--wz-panel, #17131f)', 'opaque panel with the dark fallback');
  doc.documentElement.removeAttribute('data-tweaks');
  for (const n of [panel, ...panel.querySelectorAll('*')]) assert.deepEqual(Object.keys(cascade(n, css)), [], 'scoped to the switch: ' + n.className);
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').filter(r => r.includes('ch-sweep'));
  for (const rule of rules) for (const c of rule.match(/var\(--[a-z0-9-]+/g) || []) assert.match(c, /^var\(--wz-/, 'skin tokens only');
});

test('switch turned off while the Daily thread is open: the thread repaints (markdown again) and a tap sends nothing', async () => {
  const sent = [];
  const f = cardBlock({ answer: async (id, opt) => { sent.push([id, opt]); return {}; }, yesToAll: async id => { sent.push([id]); return { answered: [], card: null }; } });
  assert.notEqual(f.api.sweepHtml(card()), '');
  f.flip(false);
  assert.equal(f.paints.length, 1, 'open threads repainted on the switch change');
  assert.equal(f.api.sweepHtml(card()), '', 'no card once off');
  await f.api.sweepAnswer(CARD, A, 'early');
  await f.api.sweepYesToAll(CARD);
  assert.deepEqual(sent, [], 'a stale button sends nothing');
  f.flip(true);
  assert.equal(f.paints.length, 4, 'and again when it comes back on');
});
