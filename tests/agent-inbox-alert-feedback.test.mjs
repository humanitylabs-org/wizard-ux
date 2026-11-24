// Alert rules feedback (switch wizard/agent-inbox, wizard-ux issue 1589; box half wizard-agent-service issue 552):
// the live.js reader cut out of the file and run against a fake box (alerts, Later list, PATCH not_urgent |
// should_alert), and the chats.js block (real normalizer + real chat-kit) drawn and tapped: Not urgent on the Alerts
// channel's alert records, the collapsed "More alerts today" alert with its count, Should have alerted on the sweep
// card's items and its Later list.
// Run: node --test tests/agent-inbox-alert-feedback.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { withParts } from './fixtures/chats-parts.mjs';
import { block as sliceBlock, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/w1-css.mjs';
import { freshDevice } from './fixtures/w1-experience.mjs';

const live = withLiveParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const chats = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const running = readFileSync(new URL('../web/core/chats-running.js', import.meta.url), 'utf8'); // the agent inbox parts (issue 1665)
const kitSrc = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const clone = v => JSON.parse(JSON.stringify(v));
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, `${a} is in the file`); return src.slice(i, j); };

const id = c => 'inbox_' + c.repeat(24);
const AL = id('a'), COL = id('c'), RT = id('9'), W1 = id('1'), DN = id('f'), L1 = id('2'), L2 = id('3'), CARD = 'sweep_' + 'e'.repeat(24);
const alertRecs = () => [
  { id: AL, kind: 'alert', agent: 'hermes', thread_id: 'alert_x1', title: 'Payment failed: Netflix', ask: 'Your card was declined for €15.99', severity: 'high', state: 'new', updated_at: 2000, run_sigs: ['x'] },
  { id: COL, kind: 'alert', agent: 'hermes', thread_id: 'alert_c1', title: 'More alerts today', ask: '4 more alerts today. They wait in the next sweep; the alert rules may be too loose.', severity: 'high', state: 'new', alert_collapsed: true, alert_extra: 4, updated_at: 1500 },
  { id: RT, kind: 'alert', agent: 'box', thread_id: 'alert_r1', title: 'Disk almost full', ask: '95% used', severity: 'urgent', state: 'new', updated_at: 1800 },
  { id: id('b'), kind: 'needs_you', agent: 'hermes', thread_id: 'w1', title: 'not an alert', state: 'new', updated_at: 1 },
  { id: '../evil', kind: 'alert', title: 'bad id', state: 'new' },
];
const laterRecs = () => [
  { id: L1, kind: 'fyi', agent: 'hermes', thread_id: 'mail_1', title: 'Newsletter from the school', ask: 'Sports day moved to Friday', state: 'new', updated_at: 30 },
  { id: L2, kind: 'note', agent: 'hermes', thread_id: 'mail_2', title: 'Parcel shipped', ask: '', state: 'surfaced', feedback: 'should_alert', updated_at: 20 },
  { id: W1, kind: 'needs_you', agent: 'hermes', thread_id: 'w1', title: 'a waiting item', state: 'surfaced', updated_at: 10 },
];
const card = () => ({
  schema: 'wizard.agent-sweep/1', id: CARD, at: 1_763_500_000_000, day: '2026-11-19', thread_id: 'wizard_daily_1', agent: 'hermes',
  waiting: { items: [{ id: W1, agent: 'hermes', thread_id: 'w1', title: 'Lisbon flights', ask: 'Early or late?', options: [{ token: 'early' }, { token: 'late' }], default_option: 'early', confirm: false, seen: 1, state: 'surfaced', link: '/wizard-os-home/?session=w1' }], more: 0, link: '/wizard-os-home/?inbox=waiting' },
  done: { items: [{ id: DN, title: 'Tax form filed', link: '/wizard-os-home/?session=wf' }], more: 0, link: '/wizard-os-home/?inbox=done' },
  running: { count: 0, stale: 0, link: '/wizard-os-home/?inbox=running' }, later: { count: 2, link: '/wizard-os-home/?inbox=later' }, parked: { count: 0, link: '/wizard-os-home/?inbox=parked' },
  missing: 0, rules_flag: { day: '2026-11-19', alerts: 5, cap: 3, link: '/wizard-os-home/?inbox=alert-rules' }, yes_to_all: { count: 1, skipped: 0 },
});

function inboxReader(answer, opts = {}) {
  const calls = [], ctx = {};
  vm.createContext(ctx);
  vm.runInContext(slice(live, '  /* ---- agent inbox (wizard-ux issue 1569)', '/* ---- end agent inbox ---- */') + '\nthis.agentInbox = agentInbox;', ctx);
  const req = async (path, init = {}) => { calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); const a = await answer(path, init); if (a.status) { const e = new Error('HTTP ' + a.status); e.status = a.status; throw e; } return { json: async () => a.json }; };
  let emits = 0;
  return { inbox: ctx.agentInbox({ req, emit: () => { emits++; }, ...opts }), calls, emits: () => emits };
}
const box = () => {
  const s = { alerts: alertRecs(), later: laterRecs(), ex: { not_urgent: 2, should_alert: 0 } };
  return { s, answer: (path, init = {}) => {
    if (path.startsWith('/wizard/v1/agent-inbox?kind=alert')) return { json: { records: s.alerts, check: null, stay: [] } };
    if (path.startsWith('/wizard/v1/agent-inbox?state=new,surfaced')) return { json: { records: s.later, check: null, stay: [] } };
    const m = /^\/wizard\/v1\/agent-inbox\/(inbox_[a-f0-9]{24})$/.exec(path);
    if (m && init.method === 'PATCH') {
      const { action } = JSON.parse(init.body), rec = [...s.alerts, ...s.later].find(r => r.id === m[1]);
      if (!rec) return { status: 404 };
      s.ex[action]++;
      if (action === 'not_urgent') { s.alerts = s.alerts.filter(r => r.id !== rec.id); rec.kind = rec.alert_collapsed ? 'alert' : 'fyi'; }
      rec.feedback = action;
      return { json: { record: rec, examples: s.ex } };
    }
    return { json: {} };
  } };
};
const settle = () => new Promise(r => setTimeout(r, 0));

test('alerts(): GET kind=alert&state=new,surfaced, alert records only, checked, newest first, per agent', async () => {
  const b = box(), f = inboxReader(b.answer);
  assert.deepEqual(clone(f.inbox.alerts()), [], 'nothing until the box answered');
  await f.inbox.readAlerts();
  assert.deepEqual(f.calls.map(c => c.path), ['/wizard/v1/agent-inbox?kind=alert&state=new,surfaced&limit=50'], 'one read');
  assert.deepEqual(clone(f.inbox.alerts()).map(r => [r.id, r.collapsed, r.extra]), [[AL, false, 0], [COL, true, 4]], 'main agent: two alerts, the collapsed one with its count');
  assert.deepEqual(clone(f.inbox.alerts('box')).map(r => r.id), [RT], 'a routed agent keeps its own');
  assert.equal(JSON.stringify(f.inbox.alerts()).includes('run_sigs'), false, 'only the fields the shell draws');
  assert.ok(f.emits() >= 1, 'the lists repaint when the read lands');
});

test('alerts(): a 404 (box switch off, older box) is an empty list', async () => {
  const f = inboxReader(() => ({ status: 404 }));
  await f.inbox.readAlerts();
  assert.deepEqual(clone(f.inbox.alerts()), []);
  assert.equal(f.inbox.alertState().gone, true);
});

test('later(): the Later and FYI records (kinds fyi and note) with their feedback', async () => {
  const f = inboxReader(box().answer);
  const list = clone(await f.inbox.later());
  assert.deepEqual(f.calls.map(c => c.path), ['/wizard/v1/agent-inbox?state=new,surfaced&limit=200']);
  assert.deepEqual(list.map(r => [r.id, r.kind, r.feedback]), [[L1, 'fyi', ''], [L2, 'note', 'should_alert']]);
});

test('feedback(): PATCH {action}, the reply carries the example counts; Not urgent drops the alert at once; bad input sends nothing', async () => {
  const b = box(), f = inboxReader(b.answer);
  await f.inbox.readAlerts(); f.calls.length = 0;
  const r = await f.inbox.feedback(AL, 'not_urgent');
  assert.deepEqual(clone(f.calls[0]), { path: `/wizard/v1/agent-inbox/${AL}`, method: 'PATCH', body: { action: 'not_urgent' } });
  assert.deepEqual(clone(r.examples), { not_urgent: 3, should_alert: 0 });
  assert.equal(r.record.kind, 'fyi', 'the alert moved to the sweep');
  assert.ok(!f.inbox.alertState().records.some(x => x.id === AL), 'gone from Alerts on this frame');
  assert.equal(f.calls[1].path, '/wizard/v1/agent-inbox?kind=alert&state=new,surfaced&limit=50', 'read again right after');
  await settle();
  const s = await f.inbox.feedback(L1, 'should_alert');
  assert.deepEqual(clone(s.examples), { not_urgent: 3, should_alert: 1 });
  const n = f.calls.length;
  await assert.rejects(f.inbox.feedback('../x', 'not_urgent'), /invalid/);
  await assert.rejects(f.inbox.feedback(AL, 'delete'), /invalid/);
  assert.equal(f.calls.length, n, 'nothing sent for a bad id or action');
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

// The chats.js block (sweep card + alert feedback) with the real live.js reader on the fake box.
function block({ on = true, channels = [{ id: 'chan_alerts', kind: 'alerts' }, { id: 'chan_trip', kind: '' }], sessions = [] } = {}) {
  const b = box(), reader = inboxReader(b.answer);
  const toasts = [], paints = { threads: 0, lists: 0 }, listeners = {}, sw = { on };
  const ctx = {
    window: { addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); } },
    KIT: kit(), esc: v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    inboxSwitchOn: () => sw.on, inboxListed: () => true, toast: (i, t) => toasts.push(t),
    CH: { w1: {} }, H: { win: () => ({ id: 'w1', thread: 'wizard_daily_1' }) }, renderThreadNow: () => { paints.threads++; }, paintListsNow: () => { paints.lists++; },
    chanStore: () => ({ channels }), storeAgent: a => !a || a === 'hermes' ? 'hermes' : a,
    LIVE: { sessions, agentInbox: reader.inbox },
  };
  vm.createContext(ctx);
  vm.runInContext(slice(running, '  const SWEEP = new Map();', '  return { alertFeedback') + '\nthis.api = { sweepHtml, sweepLater, alertsHtml, alertFeedback, ALFB };', ctx);
  const flip = v => { sw.on = v; for (const fn of listeners['wos:experience'] || []) fn(); };
  return { api: ctx.api, toasts, paints, flip, b, reader };
}
const alertsOpen = { id: 'chan_alerts', name: 'Alerts', agent: 'hermes' };
const fbButtons = (html, action) => [...html.matchAll(new RegExp(`data-chalertfb="${action}" data-id="(inbox_[a-f0-9]{24})"`, 'g'))].map(m => m[1]);

test('the Alerts channel shows its alert records, each with Not urgent; the collapsed one shows its count', async () => {
  const f = block();
  assert.equal(f.api.alertsHtml(alertsOpen), '', 'nothing before the box answered');
  await f.reader.inbox.readAlerts();
  const html = f.api.alertsHtml(alertsOpen);
  assert.match(html, /^<section class="appr ch-sweep ch-alerts" role="group" aria-label="Alerts now"/);
  assert.deepEqual(fbButtons(html, 'not_urgent'), [AL, COL]);
  assert.match(html, /Payment failed: Netflix/);
  assert.match(html, /class="ch-sw-i ch-al-i collapsed"[^>]*><div class="ch-sw-t"><b>More alerts today<\/b><span class="ch-sw-age ch-al-n" title="4 more alerts today">4<\/span>/);
  assert.doesNotMatch(html, /Disk almost full/, "a routed agent's alert stays in that agent's Alerts");
  assert.match(f.api.alertsHtml({ ...alertsOpen, agent: 'box' }), /Disk almost full/);
  assert.equal(f.api.alertsHtml({ id: 'chan_trip', name: 'Trip', agent: 'hermes' }), '', 'any other channel: nothing');
  assert.equal(f.api.alertsHtml({ id: 'chan_alerts', general: true }), '');
});

test('Not urgent: one PATCH, Sending… at once, the alert leaves Alerts and the toast says how many examples', async () => {
  const f = block();
  await f.reader.inbox.readAlerts();
  const p = f.api.alertFeedback(AL, 'not_urgent');
  assert.match(f.api.alertsHtml(alertsOpen), new RegExp(`data-id="${AL}" disabled>Sending…<`));
  await p;
  const sent = f.reader.calls.filter(c => c.method === 'PATCH');
  assert.deepEqual(clone(sent), [{ path: `/wizard/v1/agent-inbox/${AL}`, method: 'PATCH', body: { action: 'not_urgent' } }]);
  assert.deepEqual(f.toasts, ['Not urgent · it waits for the sweep (3 examples)']);
  await settle();
  assert.deepEqual(fbButtons(f.api.alertsHtml(alertsOpen), 'not_urgent'), [COL], 'only the collapsed alert is left');
  assert.ok(f.paints.lists >= 2, 'the lists repaint after the tap');
});

test('Not urgent on the collapsed alert just clears it', async () => {
  const f = block();
  await f.reader.inbox.readAlerts();
  await f.api.alertFeedback(COL, 'not_urgent', true);
  assert.deepEqual(f.toasts, ['Cleared']);
  await settle();
  assert.deepEqual(fbButtons(f.api.alertsHtml(alertsOpen), 'not_urgent'), [AL]);
});

test('the sweep card: Should have alerted on Waiting and Done items, the Later list opens in place, the rules line shows', async () => {
  const f = block();
  let html = f.api.sweepHtml(card());
  assert.deepEqual(fbButtons(html, 'should_alert'), [W1, DN], 'one per card item');
  assert.match(html, /Alert rules let 5 alerts through on 2026-11-19 \(more than 3\): check the rules/, 'the rules flag line');
  assert.match(html, /data-chsweeplater="sweep_e{24}" aria-expanded="false">Later and FYI: 2</);
  const opening = f.api.sweepLater(CARD);
  assert.match(f.api.sweepHtml(card()), /Reading the Later list…/);
  await opening;
  html = f.api.sweepHtml(card());
  assert.match(html, /aria-expanded="true">Later and FYI: 2</);
  assert.match(html, /Newsletter from the school/);
  assert.deepEqual(fbButtons(html, 'should_alert'), [W1, DN, L1], 'Later items carry it too');
  assert.match(html, /Parcel shipped<\/b><\/div><small class="ch-sw-st ch-al-done">Marked · alerts like this get through next time/, 'one marked before shows as marked');
  await f.api.alertFeedback(L1, 'should_alert');
  assert.deepEqual(clone(f.reader.calls.filter(c => c.method === 'PATCH')), [{ path: `/wizard/v1/agent-inbox/${L1}`, method: 'PATCH', body: { action: 'should_alert' } }]);
  assert.deepEqual(f.toasts, ['Got it · alerts like this get through next time (1 example)']);
  html = f.api.sweepHtml(card());
  assert.deepEqual(fbButtons(html, 'should_alert'), [W1, DN]);
  await f.api.alertFeedback(L1, 'should_alert');
  assert.equal(f.reader.calls.filter(c => c.method === 'PATCH').length, 1, 'a marked item sends nothing again');
  await f.api.sweepLater(CARD);
  assert.doesNotMatch(f.api.sweepHtml(card()), /Newsletter from the school/, 'a second tap folds it');
});

test('a failed tap keeps the button and says so', async () => {
  const f = block();
  f.reader.inbox.feedback = async () => { throw Object.assign(new Error('x'), { status: 503 }); };
  await f.api.alertFeedback(W1, 'should_alert');
  assert.deepEqual(fbButtons(f.api.sweepHtml(card()), 'should_alert'), [W1, DN]);
  assert.deepEqual(f.toasts, ['Couldn’t send it · try again']);
});

test('switch off: no alert block, no Later list read, a stale button sends nothing (Alerts exactly as now)', async () => {
  const f = block({ on: false });
  assert.equal(f.api.alertsHtml(alertsOpen), '');
  assert.equal(f.api.sweepHtml(card()), '');
  await f.api.alertFeedback(AL, 'not_urgent');
  await f.api.sweepLater(CARD);
  assert.deepEqual(f.reader.calls, [], 'nothing asks the box');
  // The real channel feed (core/chats-feed.js) draws the block only through the late-bound alertsHtml; with
  // nothing to show (switch off: alertsHtml gives '') an empty channel reads exactly as before.
  const feed = channelFeedPart();
  const open = { id: 'alerts', agent: 'hermes' }, w = { id: 'w' };
  const none = '<div class="ch-chan-feed"><span class="ch-none">No posts in the last 30 days.</span></div>';
  assert.equal(feed.channelFeed(w, open, []), none, 'before alertsHtml is bound');
  feed.bindLate({ alertsHtml: () => f.api.alertsHtml(alertsOpen) });
  assert.equal(feed.channelFeed(w, open, []), none, 'switch off: the same empty feed');
  const seen = [];
  feed.bindLate({ alertsHtml: o => { seen.push(o); return '<div class="ch-al">A</div>'; } });
  assert.equal(feed.channelFeed(w, open, []), '<div class="ch-chan-feed"><div class="ch-al">A</div></div>', 'with alerts: the block instead of the empty line');
  assert.equal(seen[0], open, 'asked for this channel');
});

// core/chats-feed.js's part factory run with stand-ins for the Chats names it reads (an empty, unarchived channel).
function channelFeedPart() {
  const window = { WizCore: {}, WizConfig: { owner: () => 'James' } };
  vm.runInNewContext(readFileSync(new URL('../web/core/chats-feed.js', import.meta.url), 'utf8'), { window });
  return window.WizCore.chatsParts.feed({ agentName: () => 'Wizard', agentRec: id => ({ id }), ago: () => '', AGS: () => null, CHAN_CLAMP: 240,
    chanActs: {}, chanArchived: () => false, chanAt: () => 0, chanChanged: () => false, chanGenAgent: () => '', chanKey: s => s.id, chanMore: new Set(),
    chanNeeds: () => false, chanNewN: () => 0, chanPostOrder: () => 0, chanPostText: () => ({ text: '' }), chanReadKey: () => 'k', chanReplies: () => null,
    chanStart: () => null, chanUnread: () => false, esc: String, firstAgent: () => '', firstPost: () => null, firstWant: new Set(), focusedAgent: () => '',
    focusOf: () => null, inChannel: () => true, isWorking: () => false, KIT: null, LIVE: { cardAt: () => '' }, pullFirst() {}, replyWant: new Set(), rowDraft: () => false });
}

// The real Chats click handler (core/chats-bind.js) on the real markup the block above draws, parsed into the tiny DOM.
function clicks(html) {
  const doc = createDocument(); doc.body.innerHTML = html;
  const ctx = runRecording(sliceBlock(chats, '  function click(e, id) {') + '\nglobalThis.click = click;',
    { INC: null, W: {}, H: { win: () => ({ id: 'w1', thread: 'wizard_daily_1' }) }, LIVE: {}, window: {}, replyStd: null });
  const tap = el => { ctx.calls.length = 0; ctx.click({ target: el }, 'w1'); return ctx.calls.filter(c => ['sweepLater', 'alertFeedback'].includes(c[0])).map(c => [...c]); };
  return { doc, tap };
}
test('the buttons are wired in the click handler and the new rules are scoped to the switch with skin tokens', async () => {
  const f = block(); await f.reader.inbox.readAlerts();
  const c = clicks(f.api.alertsHtml(alertsOpen) + f.api.sweepHtml(card()));
  const fb = (action, rid) => c.doc.querySelector(`[data-chalertfb="${action}"][data-id="${rid}"]`);
  assert.deepEqual(c.tap(fb('not_urgent', AL)), [['alertFeedback', AL, 'not_urgent', false]], 'Not urgent on an alert');
  assert.deepEqual(c.tap(fb('not_urgent', COL)), [['alertFeedback', COL, 'not_urgent', true]], 'the collapsed one says so');
  assert.deepEqual(c.tap(fb('should_alert', W1)), [['alertFeedback', W1, 'should_alert', false]], 'Should have alerted on a sweep item');
  assert.deepEqual(c.tap(c.doc.querySelector('[data-chsweeplater]')), [['sweepLater', CARD]], 'the Later list');
  fb('should_alert', DN).setAttribute('disabled', ''); assert.deepEqual(c.tap(fb('should_alert', DN)), [], 'a sending button sends nothing');
  // The new rules apply only with the switch on, and their colours are skin tokens
  const css = readFileSync(new URL('../web/tweaks/wizard/agent-inbox/tweak.css', import.meta.url), 'utf8');
  const rows = ['.ch-alerts', '.ch-al-i', '.ch-al-n', '[data-chalertfb]', '.ch-sw-lb'].map(sel => c.doc.querySelector(sel)).filter(Boolean);
  assert.ok(rows.length >= 4, 'the drawn alert block');
  const seen = new Set();
  for (const el of rows) {
    assert.deepEqual(cascade(el, css), {}, 'switch off: no rule reaches ' + el.className);
    c.doc.documentElement.setAttribute('data-tweaks', 'wizard/agent-inbox');
    const on = cascade(el, css);
    for (const [prop, d] of Object.entries(on)) { seen.add(prop); for (const v of d.value.match(/var\(--[a-z0-9-]+/g) || []) assert.match(v, /^var\(--wz-/, `${prop}: skin tokens only`); }
    c.doc.documentElement.removeAttribute('data-tweaks');
  }
  assert.ok(seen.size >= 3, 'switch on: the rules reach the block');
  // The shell lists the switch with this issue (core/experience.js reads the catalog and manifest)
  const { manifest } = await freshDevice().listing('wizard/agent-inbox');
  assert.ok(manifest.issues.includes('humanitylabs-org/wizard-ux#1589'));
});
