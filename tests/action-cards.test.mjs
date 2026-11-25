// Inline action cards in chat (wizard-ux issue 1463, switch wizard/action-cards): an app's proposed action
// ([WIZARD_ACTION_V1]{"app":"<app id>","id":"<item id>"}[/WIZARD_ACTION_V1]) is drawn as a card from the app's own
// answer at <app url>api/actions/<id> (wizard-os spec/APP_ACTIONS.md). Runs the real chat-kit.js and action-cards.js.
import { modelContext } from './fixtures/chats-list-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const clone = v => JSON.parse(JSON.stringify(v));
const MARK = (app, id) => `[WIZARD_ACTION_V1]${JSON.stringify({ app, id })}[/WIZARD_ACTION_V1]`;
const rows = content => [{ role: 'user', timestamp: 1, content: 'Answer Sam' }, { role: 'assistant', timestamp: 2, content }];

const kitCtx = { window: null, URL, Intl, Date, navigator: {}, location: { origin: 'https://wizard.example', href: 'https://wizard.example/' },
  document: { addEventListener() {}, querySelector() { return null; } }, addEventListener() {} };
kitCtx.window = kitCtx; modelContext(kitCtx); vm.runInContext(read('web/core/chat-kit.js'), kitCtx);
const KIT = kitCtx.WosChat;

test('marker: parsed into the answer\'s action keys and always hidden from its text', () => {
  const [tn] = KIT.parseRows(rows(`I drafted a reply:\n\n${MARK('wizard-messenger', 'draft-1')}\n\nSend it?`));
  assert.deepEqual(clone(tn.a.actions), ['wizard-messenger/draft-1']);
  for (const t of [tn.a.text, tn.a.plainText]) { assert.doesNotMatch(t, /WIZARD_ACTION|draft-1/); assert.match(t, /I drafted a reply:\n\nSend it\?/); }
  const [only] = KIT.parseRows(rows(MARK('wizard-mail', 'r.7')));
  assert.equal(only.a.text, ''); assert.deepEqual(clone(only.a.actions), ['wizard-mail/r.7'], 'a card-only reply still lands');
});

test('marker: unsafe app or item ids are dropped (hidden, never drawn); at most 4; no marker leaves the turn unchanged', () => {
  for (const bad of ['[WIZARD_ACTION_V1]{nope[/WIZARD_ACTION_V1]', MARK('../x', 'a'), MARK('wizard-mail', '../../api/send'), MARK('Wizard', 'a'), MARK('wizard-mail', 'a/b')]) {
    const [tn] = KIT.parseRows(rows(`Done.\n${bad}`));
    assert.equal(tn.a.text, 'Done.'); assert.equal(tn.a.actions, undefined, bad);
  }
  const many = Array.from({ length: 6 }, (_, i) => MARK('wizard-mail', 'd' + i)).join('\n');
  assert.equal(KIT.actionIds(many).length, 4);
  assert.ok(!('actions' in KIT.parseRows(rows('Done.'))[0].a));
});

// action-cards.js in a vm: a fake registry, document and fetch.
function cardsWorld({ on = true, apps = [{ id: 'wizard-messenger', name: 'Messenger', kind: 'wizard', url: '/wizard-messenger/', originalUrl: '/wizard-messenger/' }], answer } = {}) {
  const calls = [], opened = [], nodes = [];
  const docEl = { dataset: { tweaks: on ? 'wizard/action-cards' : '' } };
  const ctx = {
    URL, Date, JSON, Promise, CSS: { escape: s => String(s) }, location: { origin: 'https://box.example', href: 'https://box.example/wizard-os-home/' },
    document: { documentElement: docEl, activeElement: null, visibilityState: 'visible', addEventListener() {}, querySelectorAll: q => q === '[data-action-card]' ? nodes : [] },
    WizCore: { apps: () => ({ APP: Object.fromEntries(apps.map(a => [a.id, a])), APPS: apps }) },
    WizOpenApp: (id, p) => { opened.push([id, p || '']); return true; },
    fetch: async (url, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url, method: opts.method, headers: { ...opts.headers }, body, credentials: opts.credentials });
      const r = answer ? answer(url, opts.method, body) : { status: 404, d: { error: 'not_found' } };
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.d };
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx); vm.runInContext(read('web/core/action-cards.js'), ctx);
  const node = key => { const n = { dataset: { actionCard: key }, innerHTML: '', hidden: false, contains: () => false, querySelector: () => null, closest: () => n }; nodes.push(n); return n; };
  return { AC: ctx.WosActionCards, calls, opened, node, docEl, settle: () => new Promise(r => setTimeout(r, 0)).then(() => new Promise(r => setTimeout(r, 0))) };
}
const DRAFT = { schema: 'wizard.app-actions/1', id: 'draft-1', kind: 'Draft reply', title: 'Reply to Sam', state: 'pending', open: '?thread=sam', approve_label: 'Send',
  fields: [{ id: 'to', label: 'To', value: 'Sam' }, { id: 'text', label: 'Message', value: 'See you at 7!', editable: true }] };
const btn = (card, act) => ({ dataset: { act }, disabled: false, closest: q => q === '[data-action-card]' ? card : null });

test('switch off: no card, nothing read from or sent to the app', async () => {
  const w = cardsWorld({ on: false, answer: () => ({ status: 200, d: DRAFT }) });
  assert.equal(w.AC.html(['wizard-messenger/draft-1']), '');
  const n = w.node('wizard-messenger/draft-1'); w.AC.paint(); await w.settle();
  assert.equal(w.AC.tap(btn(n, 'approve')), true); await w.settle();
  assert.equal(w.calls.length, 0);
});

test('switch on: the card reads the app\'s own item at the fixed same-origin path and shows its words', async () => {
  const items = { 'draft-1': clone(DRAFT) };
  const w = cardsWorld({ answer: (url, method) => { const id = decodeURIComponent(url.split('/').pop()); return items[id] ? { status: 200, d: items[id] } : { status: 404, d: {} }; } });
  const first = w.AC.html(['wizard-messenger/draft-1']);
  assert.match(first, /Loading from Messenger/);
  assert.equal(w.calls[0].url, '/wizard-messenger/api/actions/draft-1'); assert.equal(w.calls[0].method, 'GET'); assert.equal(w.calls[0].credentials, 'same-origin');
  const n = w.node('wizard-messenger/draft-1'); await w.settle();
  assert.match(n.innerHTML, /Reply to Sam/); assert.match(n.innerHTML, /See you at 7!/);
  assert.match(n.innerHTML, /data-act="approve"[^>]*>Send</); assert.match(n.innerHTML, /data-act="edit"/); assert.match(n.innerHTML, /data-act="open"/); assert.match(n.innerHTML, /data-act="reject"/);
  // the agent's words never reach the markup: html escapes the app's strings too
  items['draft-1'].title = '<img src=x onerror=alert(1)>'; w.AC._cards.get('wizard-messenger/draft-1').at = 0; w.AC.paint(); await w.settle();
  assert.doesNotMatch(n.innerHTML, /<img/); assert.match(n.innerHTML, /&lt;img/);
  // gone from the app
  const g = w.node('wizard-messenger/gone'); w.AC.paint(); await w.settle();
  assert.match(g.innerHTML, /no longer in Messenger/);
});

test('Edit then Approve sends only the edited editable fields, with X-Wizard-Action, and the card shows the app\'s new state', async () => {
  const items = { 'draft-1': clone(DRAFT) };
  const w = cardsWorld({ answer: (url, method, body) => {
    const it = items['draft-1'];
    if (method === 'POST') { if (body.decision === 'approve') { for (const [k, v] of Object.entries(body.fields || {})) it.fields.find(f => f.id === k).value = v; it.state = 'approved'; it.message = 'Sent'; } }
    return { status: 200, d: it };
  } });
  const n = w.node('wizard-messenger/draft-1'); w.AC.paint(); await w.settle();
  assert.equal(w.AC.tap(btn(n, 'edit')), true);
  assert.match(n.innerHTML, /<input data-act-field="text"[^>]*value="See you at 7!"/); assert.doesNotMatch(n.innerHTML, /data-act-field="to"/, 'only editable fields become boxes');
  w.AC._cards.get('wizard-messenger/draft-1').draft.text = 'See you at 8!'; // what the input listener records
  w.AC.tap(btn(n, 'approve')); await w.settle();
  const post = w.calls.find(c => c.method === 'POST');
  assert.equal(post.url, '/wizard-messenger/api/actions/draft-1');
  assert.equal(post.headers['X-Wizard-Action'], '1');
  assert.deepEqual(post.body, { decision: 'approve', fields: { text: 'See you at 8!' } });
  assert.match(n.innerHTML, /✓ Approved · Sent/); assert.match(n.innerHTML, /See you at 8!/);
  assert.doesNotMatch(n.innerHTML, /data-act="approve"/, 'done: no Approve again');
  w.AC.tap(btn(n, 'approve')); await w.settle();
  assert.equal(w.calls.filter(c => c.method === 'POST').length, 1, 'a done item is never sent twice');
});

test('a refused decision keeps the item pending and says why; Reject sends reject without fields', async () => {
  let refuse = true; const it = clone(DRAFT);
  const w = cardsWorld({ answer: (url, method, body) => method !== 'POST' ? { status: 200, d: it } : refuse ? { status: 403, d: { error: 'forbidden', message: 'Only the owner can send this' } } : (it.state = 'rejected', { status: 200, d: it }) });
  const n = w.node('wizard-messenger/draft-1'); w.AC.paint(); await w.settle();
  w.AC.tap(btn(n, 'approve')); await w.settle();
  assert.match(n.innerHTML, /Only the owner can send this/); assert.match(n.innerHTML, /data-act="approve"/);
  refuse = false; w.AC.tap(btn(n, 'reject')); await w.settle();
  assert.deepEqual(w.calls.filter(c => c.method === 'POST').map(c => c.body), [{ decision: 'approve' }, { decision: 'reject' }]);
  assert.match(n.innerHTML, /Rejected/);
});

test('Open in app opens the item\'s own page inside that app only; anything outside falls back to the app', async () => {
  for (const [open, want] of [['?thread=sam', '/wizard-messenger/?thread=sam'], ['threads/9#m2', '/wizard-messenger/threads/9#m2'], ['/wizard-mail/x', ''], ['https://evil.example/wizard-messenger/', '']]) {
    const w = cardsWorld({ answer: () => ({ status: 200, d: { ...clone(DRAFT), open } }) });
    const n = w.node('wizard-messenger/draft-1'); w.AC.paint(); await w.settle();
    w.AC.tap(btn(n, 'open'));
    assert.deepEqual(w.opened[0], want ? ['wizard-messenger', want] : ['wizard-messenger', ''], open);
  }
});

test('an app that isn\'t installed, or lives on another origin, is never called', async () => {
  for (const apps of [[], [{ id: 'wizard-messenger', name: 'Messenger', kind: 'wizard', url: 'https://evil.example/wizard-messenger/' }]]) {
    const w = cardsWorld({ apps, answer: () => ({ status: 200, d: DRAFT }) });
    const n = w.node('wizard-messenger/draft-1'); w.AC.paint(); await w.settle();
    assert.match(n.innerHTML, /isn’t installed on this Wizard/);
    w.AC.tap(btn(n, 'approve')); await w.settle();
    assert.equal(w.calls.length, 0);
  }
});

test('an answer for another item or another schema is not shown', () => {
  const { AC } = cardsWorld();
  assert.equal(AC.normalize({ ...DRAFT, id: 'other' }, 'draft-1'), null);
  assert.equal(AC.normalize({ ...DRAFT, schema: 'wizard.app-actions/9' }, 'draft-1'), null);
  assert.equal(AC.normalize({ ...DRAFT, state: 'weird' }, 'draft-1').state, 'pending');
});

// Agent chat parity (AGENTS.md; wizard-agent-service qa/agent-parity/features.json "chat-action-cards"): the same reply in
// a main thread and in host-profile, container and restricted routed threads gives the same card from the same app
// item, the same decision and the same clean Chats preview. Routed ids and agent pins as the Service sends them.
const ROUTES = { main: ['wizard_1793157258294_34b4a71ae61a', ''], 'host-profile': ['20261028_101500_ab12cd', 'qa-host-profile'],
  container: ['agent-research:20261028_101501_ef34', 'agent-research'], restricted: ['restricted.vault_20261028-101502', 'restricted.vault'] };
function listNormalizer() {
  const live = withLiveParts(read('web/live.js')), a = live.indexOf('  const READY_OR_ATTENTION'), b = live.indexOf('  /* ---- thread-seen');
  assert.ok(a > 0 && b > a, 'live.js normalizer block found');
  const context = modelContext({});
  vm.runInContext(`${live.slice(a, b)}\nthis.normalize = normalize;`, context);
  return context.normalize;
}
test('parity: main and routed threads (host-profile, container, restricted) get the same card, decision and preview', async () => {
  const normalize = listNormalizer(), cards = new Map(), reply = `I drafted a reply:\n\n${MARK('wizard-messenger', 'draft-1')}\n\nSend it?`;
  for (const [kind, [sid, agent]] of Object.entries(ROUTES)) {
    const history = rows(reply).map(r => ({ ...r, session_id: sid, ...(agent ? { agent } : {}) }));
    const [tn] = KIT.parseRows(history);
    assert.deepEqual(clone(tn.a.actions), ['wizard-messenger/draft-1'], `${kind}: action parsed from history`);
    assert.doesNotMatch(tn.a.text + tn.a.plainText, /WIZARD_ACTION|draft-1/, `${kind}: marker hidden in thread and copy`);
    const it = clone(DRAFT);
    const w = cardsWorld({ answer: (url, method, body) => { if (method === 'POST') it.state = body.decision === 'approve' ? 'approved' : 'rejected'; return { status: 200, d: it }; } });
    const n = w.node(tn.a.actions[0]); w.AC.html(tn.a.actions); await w.settle(); w.AC.paint();
    cards.set(kind, n.innerHTML);
    w.AC.tap(btn(n, 'approve')); await w.settle();
    assert.deepEqual(w.calls.map(c => [c.method, c.url, c.body]), [['GET', '/wizard-messenger/api/actions/draft-1', null], ['POST', '/wizard-messenger/api/actions/draft-1', { decision: 'approve' }]], `${kind}: same item, same decision`);
    assert.match(n.innerHTML, /✓ Approved/, kind);
    const full = normalize({ id: sid, title: 'Synthetic', status: 'completed', ...(agent ? { agent } : {}), latest_message: { role: 'assistant', content: reply, timestamp: 2 } });
    assert.equal(full.agent, agent, `${kind}: row keeps its agent`);
    assert.equal(full.preview, 'I drafted a reply: Send it?', `${kind}: full-list preview`);
  }
  assert.equal(new Set(cards.values()).size, 1, 'byte-identical card for every runtime kind');
});
