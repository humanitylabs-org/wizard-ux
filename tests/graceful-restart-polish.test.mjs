// wizard-ux issue 1432: polish of the graceful restart note (switch wizard/graceful-restart, issue 1362).
//   1. the note always sits on its own opaque panel (the desktop message box with no chat open floats on the wallpaper);
//   2. a held chat's message box is a normal idle box: no Stop, no "Steer …";
//   3. a new chat the box already lists as "New chat" shows the owner's words from the tap (main and routed kinds);
//   4. the note is put back at once when the page shows no note at all (thread -> Chats list on the phone).
// Browser proof: tests/qa-graceful-restart-polish.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/graceful-restart';

test('the note has an opaque panel wherever it sits, not only when it floats', () => {
  const css = read('tweaks/wizard/graceful-restart/tweak.css');
  const rule = css.split('\n').find(l => l.startsWith('html[data-tweaks~="wizard/graceful-restart"] .ch-restart-notice {'));
  assert.ok(rule, 'base rule for the note');
  for (const want of ['background: var(--bg', 'border: 1px solid', 'border-radius:', 'padding:']) assert.ok(rule.includes(want), want);
  assert.doesNotMatch(rule, /background: (transparent|none)/);
});

test('a held send: the message box shows neither Stop nor Steer, a running chat still does', () => {
  const chats = read('core/chats.js');
  const stop = chats.match(/const canStop = [^\n]+/)[0];
  assert.match(stop, /working && !held && /, 'Stop only for a chat that really runs');
  assert.match(chats, /: working && !held \? `Steer \$\{esc\(agentName\(TAG\)\)\}…` : `Message \$\{esc\(agentName\(TAG\)\)\}`/);
  // held is the one rule (WizReach.restartHeld), computed before both lines.
  const at = chats.indexOf('held = working && !!globalThis.WizReach?.restartHeld?.(s)');
  assert.ok(at > 0 && at < chats.indexOf('const canStop = '));
});

for (const [agent, kind] of [['', 'main'], ['host-ops', 'host-profile'], ['box', 'container'], ['locked', 'restricted']]) {
  test(`${kind}: a new chat the box lists as "New chat" shows the owner's words from the tap`, async () => {
    const live = read('live.js');
    const start = live.indexOf('  const PEND = new Map()'), end = live.indexOf('  const commandId =', start);
    const { runWithChatsModel } = await import('./fixtures/chats-list-model.mjs');
    const now = 1_800_000_000_000;
    const item = (id, kind, extra = {}) => ({ id: 'ob-' + id, kind, sessionId: id, state: 'sent', sentAt: now, createdAt: now - 500, runId: 'wizardq_' + id,
      text: 'Find a ferry time', ...(agent ? { agent } : {}), restartPending: true, ...extra });
    const box = (id, title, status = 'queued') => ({ id, title, status, runtime: 'direct', updatedAt: new Date(now).toISOString(), ...(agent ? { agent } : {}) });
    const rows = [box('wizard_new', 'New chat'), box('wizard_untitled', 'Untitled chat'), box('wizard_named', 'Ferry plans'), box('wizard_reply', 'New chat', 'completed')];
    const L = { sessions: agent ? [] : rows, agentSessions: agent ? { [agent]: rows } : {} };
    const OB = { _items: new Map([
      ['ob-wizard_new', item('wizard_new', 'new')], ['ob-wizard_untitled', item('wizard_untitled', 'new')],
      ['ob-wizard_named', item('wizard_named', 'new')], ['ob-wizard_reply', item('wizard_reply', 'reply', { text: 'Add sandwiches' })]]) };
    const c = { L, OB, WORKING: new Set(['submitting', 'queued', 'running', 'stopping']), otherAgent: a => !!a && a !== 'hermes', AGENT_OF: new Map(),
      Date: class extends Date { static now() { return now; } }, WizReach: { restart: () => ({ phase: 'waiting' }) } };
    runWithChatsModel(live.slice(start, end) + '\nthis.api = { syncPending };', c);
    c.api.syncPending(OB);
    const list = agent ? L.agentSessions[agent] : L.sessions, title = id => list.find(s => s.id === id).title;
    assert.equal(title('wizard_new'), 'Find a ferry time', 'the owner\'s words, not "New chat"');
    assert.equal(title('wizard_untitled'), 'Find a ferry time');
    assert.equal(title('wizard_named'), 'Ferry plans', 'a real name the box gave is kept');
    assert.equal(title('wizard_reply'), 'New chat', 'a reply never renames its chat');
  });
}

test('the note comes back at once when no note shows anywhere (phone: thread -> Chats list)', async () => {
  const src = read('core/reach.js');
  const observers = []; let painted = 0, notes = [], composes = [];
  const document = { documentElement: { dataset: { tweaks: SWITCH }, nodeType: 1 }, hidden: false, body: { nodeType: 1 },
    querySelectorAll: sel => sel === '.ch-compose' ? composes : sel === '[data-restart-notice]' ? notes : [], addEventListener() {} };
  const ctx = { document, navigator: { onLine: true }, location: { hostname: 'wizard.example.com' }, Event, AbortController, Date, console,
    addEventListener() {}, dispatchEvent() {}, setTimeout: () => 0, clearTimeout() {},
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe(target, opts) { observers.push({ fn: this.fn, target, opts }); } disconnect() {} },
    WosOutbox: { paintNotice: () => { painted++; } },
    fetch: async url => url === '/wizard/health'
      ? { ok: true, status: 200, json: async () => ({ status: 'ok', restart: { phase: 'waiting', holding: true, active: 1, held: 1 } }) }
      : { ok: true, status: 200, json: async () => ({ checks: [], overall: 'ok' }) },
    WizLive: { unified: () => [] } };
  ctx.window = ctx; ctx.globalThis = ctx; vm.runInNewContext(src, ctx);
  for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
  const keep = observers.find(o => o.target === document.body);
  assert.ok(keep, 'watching while a restart is known');
  // The thread's box is hidden (no client rects) and still holds the old note; nothing else shows one.
  const hiddenNote = { getClientRects: () => [] };
  composes = [{ getClientRects: () => [], querySelector: () => hiddenNote }]; notes = [hiddenNote];
  let before = painted; keep.fn([]);
  assert.equal(painted, before + 1, 'painted again, onto the list\'s own panel');
  // Once the floating note shows, nothing more to do.
  notes = [hiddenNote, { getClientRects: () => [1] }];
  before = painted; keep.fn([]);
  assert.equal(painted, before, 'no repaint while a note shows');
});
