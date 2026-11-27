// Reply buttons that act on an app directly, with no agent turn (wizard-ux issue 1973, part 2; switch
// wizard/reply-actions on top of wizard/reply-buttons). A button may declare "action":{"app","tool","args"}; the shell
// sends only which button was tapped to the Agent Service (POST /wizard/v1/reply-actions), never an owner message, and
// draws the box's saved outcome: the pick (✓) and one machine line, or the failure with Retry. Runs the real
// chat-kit.js and action-cards.js for a main thread and the three routed kinds.
import { modelContext } from './fixtures/chats-list-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ACTION = { app: 'checklist', tool: 'tick', args: { step: 'workout' } };
const GROUP = (group, buttons) => `[WIZARD_BUTTONS_V1]${JSON.stringify({ group, buttons })}[/WIZARD_BUTTONS_V1]`;
const POST = act => `Morning checklist\n1. Workout\n${GROUP('Workout', [{ id: 'done', label: 'Done', ...(act ? { action: ACTION } : {}) }, { id: 'skip', label: 'Skip' }])}\n2. Read\n${GROUP('Read', [{ id: 'done', label: 'Done' }])}`;
const rows = content => [{ id: 41, role: 'assistant', timestamp: 2, content }];
const md = s => `<p>${s.replace(/\n+/g, ' ')}</p>`;
const KINDS = [['main', ''], ['host-profile', 'host'], ['container', 'box'], ['restricted', 'locked']];

function world({ buttons = true, actions = true, agent = '', box = {} } = {}) {
  const docEl = { dataset: { tweaks: [buttons && 'wizard/reply-buttons', actions && 'wizard/reply-actions'].filter(Boolean).join(' ') } };
  const calls = [], saved = new Map(), state = { fail: '', down: false, ...box };
  const ctx = { URL, Intl, Date, JSON, Promise, Map, Set, navigator: {}, setTimeout, clearTimeout, CSS: { escape: s => String(s) },
    location: { origin: 'https://box.example', href: 'https://box.example/wizard-os-home/' },
    document: { documentElement: docEl, activeElement: null, visibilityState: 'visible', addEventListener() {}, querySelector() { return null; }, querySelectorAll: () => [] },
    addEventListener() {},
    WizLive: { agentOf: () => agent },
    // The fake box: what POST /wizard/v1/reply-actions answers, and what it has saved for GET.
    fetch: async (url, init = {}) => {
      const u = new URL(url, 'https://box.example'), body = init.body ? JSON.parse(init.body) : null;
      calls.push({ path: u.pathname, method: init.method || 'GET', query: Object.fromEntries(u.searchParams), body, key: init.headers?.['Idempotency-Key'] || '' });
      if (state.down) throw new TypeError('Failed to fetch');
      if (u.pathname !== '/wizard/v1/reply-actions') return { ok: false, status: 404, json: async () => ({}) };
      if (!body) return { ok: true, status: 200, json: async () => ({ schema: 'wizard.reply-actions/1', actions: [...saved.values()] }) };
      const rec = state.fail ? { message: body.message, group: body.group, button: body.button, label: 'Done', ok: false, error: state.fail, at: Date.now() }
        : { message: body.message, group: body.group, button: body.button, label: 'Done', ok: true, line: 'Workout ticked · 1 of 4', at: Date.now() };
      saved.set(`${body.message}\n${body.group}`, rec);
      return { ok: true, status: 200, json: async () => ({ ok: rec.ok, action: rec }) };
    } };
  ctx.window = ctx; modelContext(ctx);
  vm.createContext(ctx);
  vm.runInContext(read('web/core/chat-kit.js'), ctx);
  vm.runInContext(read('web/core/action-cards.js'), ctx);
  return { KIT: ctx.WosChat, AC: ctx.WosActionCards, calls, saved, state };
}
const render = (w, sid, content = POST(true)) => {
  const [tn] = w.KIT.parseRows(rows(content));
  return w.AC.replyHtml(tn.a.btext, tn.a.buttons, md, w.AC.replyPicks([tn], sid));
};
// A tapped button as core/chats-bind.js hands it over: its row carries the message and group (and `ch-rb-acts`).
const button = (msg, group, id, label, { act = true } = {}) => {
  const box = { dataset: { rbMsg: msg, rbGroup: group }, classList: { contains: c => act && c === 'ch-rb-acts' } };
  return { dataset: { rb: id }, textContent: label, disabled: false, hasAttribute: a => act && a === 'data-rb-act', getAttribute: a => (a === 'aria-pressed' ? 'false' : null), closest: q => (q === '.ch-rb' ? box : null) };
};
const settle = () => new Promise(r => setTimeout(r, 0));

test('parse: a button that declares an action is marked, without carrying the action into the shell', () => {
  const { KIT } = world();
  const [tn] = KIT.parseRows(rows(POST(true)));
  assert.deepEqual(JSON.parse(JSON.stringify(tn.a.buttons[0].buttons)), [{ id: 'done', label: 'Done', act: true }, { id: 'skip', label: 'Skip' }]);
  assert.doesNotMatch(JSON.stringify(tn.a.buttons), /checklist|tick|workout"/, 'the app, tool and args stay in the history');
  for (const t of [tn.a.text, tn.a.plainText]) assert.match(t, /Workout: \[Done\] \[Skip\]/, 'text fallback unchanged');
});

test('switch off: an action button looks and taps exactly like today\'s reply button', async () => {
  for (const actions of [false]) {
    const w = world({ actions });
    assert.equal(render(w, 's1', POST(true)), render(w, 's1', POST(false)), 'byte-identical to a button without an action');
    const sent = [];
    w.AC.replyTap(button('41', 'Workout', 'done', 'Done', { act: false }), { sid: 's1', send: async t => (sent.push(t), { id: 'ob' }) });
    await w.AC.replyFlush('s1');
    assert.equal(sent.length, 1, 'an owner message, as today'); assert.match(sent[0], /^Tapped Done · Workout/);
    assert.deepEqual(w.calls, [], 'the box is never asked');
  }
  // Reply buttons off: no buttons at all, whatever the action switch says.
  assert.equal(world({ buttons: false }).AC.replyOn(), false);
  assert.equal(world({ buttons: false }).AC.actionsOn(), false);
});

for (const [kind, agent] of KINDS) {
  test(`switch on: a tap goes to the box, not the agent; ✓ and the app's line show; reload and a second device agree / ${kind}`, async () => {
    const w = world({ agent }), sid = `wizard_morning_${kind}`, sent = [], painted = [];
    const first = render(w, sid);
    assert.match(first, /class="ch-rb ch-rb-acts" role="group" aria-label="Workout" data-rb-group="Workout" data-rb-msg="41" data-rb-sid="wizard_morning_/);
    assert.match(first, /data-rb="done" data-rb-act aria-pressed="false">Done</);
    assert.doesNotMatch(first.split('data-rb-group="Read"')[1], /ch-rb-acts|data-rb-act/, 'a group with no action stays a plain reply-button row');
    await settle();
    assert.deepEqual(w.calls.map(c => [c.method, c.query.thread, c.query.agent || '']), [['GET', sid, agent]], 'the saved outcomes are read once, scoped to the thread\'s agent');
    const ctx = { sid, send: async t => (sent.push(t), { id: 'ob' }), repaint: () => painted.push(1), toast: () => {} };
    assert.equal(w.AC.replyTap(button('41', 'Workout', 'done', 'Done'), ctx), true);
    const busy = render(w, sid);
    assert.match(busy, /aria-busy="true"/, 'the tap shows on its frame'); assert.match(busy, /disabled/);
    await settle(); await settle();
    const post = w.calls.find(c => c.method === 'POST');
    assert.deepEqual(post.body, { thread: sid, message: '41', group: 'Workout', button: 'done', ...(agent ? { agent } : {}) }, 'only which button: no action, no text');
    await w.AC.replyFlush(sid);
    assert.deepEqual(sent, [], 'no owner message, so no agent turn and no model lookup');
    const after = render(w, sid);
    assert.match(after, /aria-pressed="true">✓ Done</); assert.match(after, /class="ch-rb-btn dim" data-rb="skip"/);
    assert.match(after, /<p class="ch-rb-line" role="status">Workout ticked · 1 of 4<\/p>/);
    // A second device (or a reload): only the box's saved outcome, read back.
    const other = world({ agent }); other.saved.set('41\nWorkout', w.saved.get('41\nWorkout'));
    render(other, sid); await settle();
    assert.equal(render(other, sid), after, 'the same ✓ and line on another device');
    // Tapping the done pick again does nothing more.
    const n = w.calls.length; w.AC.replyTap(button('41', 'Workout', 'done', '✓ Done'), ctx); await settle();
    assert.equal(w.calls.length, n);
  });

  test(`a failing app shows inline with Retry, and Retry works once it is back / ${kind}`, async () => {
    const w = world({ agent }), sid = `wizard_retry_${kind}`, toasts = [];
    render(w, sid); await settle();
    w.state.fail = 'Checklist QA could not run tick: it is not reachable.';
    w.AC.replyTap(button('41', 'Workout', 'done', 'Done'), { sid, send: async () => ({}), repaint() {}, toast: (i, t) => toasts.push(t) });
    await settle(); await settle();
    const failed = render(w, sid);
    assert.match(failed, /<p class="ch-rb-err" role="alert"><span>Done didn’t go through · Checklist QA could not run tick: it is not reachable\.<\/span><button type="button" class="ch-rb-retry" data-rb="done" data-rb-act data-rb-retry>Retry<\/button><\/p>/);
    assert.doesNotMatch(failed, /aria-pressed="true"|Not sent|Model provider/);
    assert.deepEqual(toasts, [], 'the failure is said once, in the row');
    w.state.fail = '';
    w.AC.replyTap(button('41', 'Workout', 'done', 'Retry'), { sid, send: async () => ({}), repaint() {} });
    await settle(); await settle();
    const ok = render(w, sid);
    assert.match(ok, /✓ Done/); assert.match(ok, /ch-rb-line/); assert.doesNotMatch(ok, /ch-rb-err/);
    const posts = w.calls.filter(c => c.method === 'POST');
    assert.equal(posts.length, 2);
    // Each attempt has its own key, so the shell's write guard never hands Retry the failed answer again (core/write-guard.js).
    assert.ok(posts.every(c => c.key) && new Set(posts.map(c => c.key)).size === 2, 'a fresh Idempotency-Key per attempt');
  });

  test(`the box unreachable: saved as nothing done, Retry offered / ${kind}`, async () => {
    const w = world({ agent }), sid = `wizard_down_${kind}`;
    w.state.down = true;
    w.AC.replyTap(button('41', 'Workout', 'done', 'Done'), { sid, send: async () => ({}), repaint() {}, toast() {} });
    await settle(); await settle();
    assert.match(render(w, sid), /Couldn’t reach Wizard · nothing was done.*data-rb-retry/);
  });
}
