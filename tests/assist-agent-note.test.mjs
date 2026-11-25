// Side button opens the Agent chat (wizard-ux issue 1528, switch wizard/assist-agent-note, off by default).
// The shell copies the switch to the Android app (real android-relay.js in a vm, stand-in native bridge); the real
// WizardSession.onShow and AssistLockActivity.onCreate decide per press (run as JS with stand-ins); MainActivity turns
// the press into the shell's 'agent-note' handoff; app-boot.js's agentNote() opens Messenger at its Agent chat.
// The pure rule itself is a JVM test: android/app/src/test/.../assist/AssistNoteTest.java.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { java, method } from './fixtures/s1-java-slice.mjs';
import { between } from './fixtures/source-slice.mjs';
import { lookBox } from './fixtures/r5A-experience.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/assist-agent-note';
// Java locals (`boolean x =`, `String x =`, `File x =`) read as JS `let`; a Java String constant answers equals().
const locals = src => src.replace(/\b(?:final )?(?:boolean|String|File|int|long|Intent) (\w+) = /g, 'let $1 = ').replace(/\(\) -> \{/g, '() => {');
const jstr = s => ({ equals: v => v === s, toString: () => s });

function relay({ on = false, native = true } = {}) {
  const calls = [], timers = [], observers = [], winListeners = {};
  const root = { dataset: { tweaks: on ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats' } };
  const c = { URL, console, JSON, Date, location: new URL('https://wizard.example/wizard-os-home/'),
    document: { readyState: 'complete', hidden: false, documentElement: root, body: { appendChild() {} }, querySelectorAll: () => [],
      createElement: () => ({}), getElementById: () => null, addEventListener() {} },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} },
    navigator: {}, dispatchEvent() {}, CustomEvent: class {},
    setInterval() {}, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    addEventListener: (n, f) => (winListeners[n] ||= []).push(f) };
  if (native) c.WizardOSNative = { assistNoteSwitch: v => calls.push(v) };
  c.window = c; vm.createContext(c);
  vm.runInContext(read('web/core/android-relay.js'), c);
  const flip = v => { root.dataset.tweaks = v ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats'; for (const o of observers) o.fn([]); };
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  const experience = () => { for (const f of winListeners['wos:experience'] || []) f(); };
  return { calls, flip, settle, experience };
}

test('the shell copies the switch to the Android app: off once settled, on at once, never the same state twice', () => {
  const off = relay();
  assert.deepEqual(off.calls, [], 'nothing before the switches settle');
  off.settle(); off.experience();
  assert.deepEqual(off.calls, [false]);
  const on = relay({ on: true });
  assert.deepEqual(on.calls, [true]);
  on.flip(false); assert.deepEqual(on.calls, [true], 'an off waits for the switches to settle');
  on.experience(); assert.deepEqual(on.calls, [true, false]);
  on.flip(true); assert.deepEqual(on.calls, [true, false, true]);
  const old = relay({ on: true, native: false }); old.settle(); old.flip(false); old.experience();
  assert.deepEqual(old.calls, [], 'a browser or an older APK is left alone');
});

test('the switch is in the catalog, off by default, phone only', async () => {
  const box = await lookBox();
  const row = box.row(SWITCH);
  assert.ok(row, 'Settings › Look lists the switch');
  assert.equal(row.on, false, 'a fresh device has it off');
  assert.match(row.description, /Agent chat/);
  assert.ok(!box.active().includes(SWITCH), 'and never loads it');
  assert.ok(!box.E.promotedDefaults.includes(SWITCH));
});

// The real WizardSession.onShow with stand-ins: which way a press goes.
function press({ on, locked = false, handoff = false, listening = false }) {
  const log = [], session = locals(java('assist/WizardSession.java'));
  const capture = { attach: () => log.push('attach'), listening: () => listening, busy: () => listening, send: why => log.push('send:' + why),
    start: () => log.push('start'), takeLastCounts: () => null, paused: () => false };
  const scope = { capture, keyguard: { isKeyguardLocked: () => locked }, getContext: () => 'ctx', Log: { i() {} }, TAG: 't',
    AssistNote: { on: c => { assert.equal(c, 'ctx'); return on; }, opensAgentChat: (o, l, h, li) => o && !l && !h && !li, intent: () => 'agent-note-intent' },
    Intent: class { setAction() { return this; } addFlags() { return this; } }, AssistLockActivity: {}, ARG_HANDOFF: 'h', ARG_HEARD: 'heard',
    ai: { wizards: { os: { SideButton: { markUsed: () => log.push('used') } } } }, VoiceCapture: { takeQaNext: () => null, qaAutoSendMs: () => 0 },
    startAssistantActivity: i => log.push('activity:' + (typeof i === 'string' ? i : 'lock')), hide: () => log.push('hide'),
    syncAwake() {}, away() {}, js() {}, whenReady: r => r(), onHeard() {}, awake: false, heard: '' };
  const args = { args: { getBoolean: k => k === 'h' ? handoff : false, getString: () => ({ isEmpty: () => true }) }, showFlags: 0 };
  method(session, 'public void onShow(Bundle args, int showFlags)', { args, scope, base: class { onShow() {} } });
  return log;
}

test('switch on: a press on an unlocked phone opens the Agent chat and starts no take', () => {
  assert.deepEqual(press({ on: true }), ['used', 'activity:agent-note-intent', 'hide']);
});

test('switch off: every press works exactly as before', () => {
  assert.deepEqual(press({ on: false }), ['attach', 'used', 'start'], 'a fresh press listens for a new Wizard chat');
  assert.deepEqual(press({ on: false, listening: true }), ['attach', 'used', 'send:button'], 'a press during a take sends it');
  assert.deepEqual(press({ on: false, locked: true }), ['activity:lock', 'hide'], 'locked: the lock-screen surface');
});

test('switch on: the lock screen, hand-overs and an open take keep the orb', () => {
  assert.deepEqual(press({ on: true, locked: true }), ['activity:lock', 'hide']);
  assert.deepEqual(press({ on: true, listening: true }), ['attach', 'used', 'send:button']);
  assert.ok(!press({ on: true, handoff: true }).includes('activity:agent-note-intent'));
});

test('an assistant press that lands on the lock-screen activity while unlocked opens the Agent chat too', () => {
  const src = java('assist/AssistLockActivity.java');
  const slice = between(src, '        // Side button opens the Agent chat (wizard-ux issue 1528', '        if (Intent.ACTION_ASSIST.equals(getIntent().getAction())) ai.wizards.os.SideButton.markUsed(this);');
  const run = ({ on, locked, action = 'assist' }) => {
    const log = [];
    const ctx = { log, keyguard: { isKeyguardLocked: () => locked }, capture: { listening: () => false }, TAG: 't', Log: { i() {} },
      Intent: { ACTION_ASSIST: jstr('assist') }, getIntent: () => ({ getAction: () => action }), self: { handingOff: false },
      AssistNote: { on: () => on, opensAgentChat: (o, l, h, li) => o && !l && !h && !li, intent: () => 'agent-note-intent' },
      ai: { wizards: { os: { SideButton: { markUsed: () => log.push('used') } } } },
      startActivity: i => log.push('activity:' + i), finish: () => log.push('finish') };
    vm.createContext(ctx);
    vm.runInContext(`(function () { ${slice.replace('handingOff = true', 'self.handingOff = true').replace('this', 'null')} log.push('surface'); })()`, ctx);
    return { log, handingOff: ctx.self.handingOff };
  };
  assert.deepEqual(run({ on: true, locked: false }), { log: ['used', 'activity:agent-note-intent', 'finish'], handingOff: true });
  assert.deepEqual(run({ on: true, locked: true }).log, ['surface'], 'locked: the surface as before');
  assert.deepEqual(run({ on: false, locked: false }).log, ['surface'], 'off: the surface as before');
});

test('MainActivity hands the press to the shell as the agent-note handoff', () => {
  const src = locals(java('MainActivity.java'));
  const posted = [];
  const intent = { getAction: () => 'ai.wizards.os.action.AGENT_NOTE', getStringExtra: () => null, setAction() {} };
  const { ctx } = method(src, 'void queueHandoff(Intent intent)', { args: { intent },
    scope: { ACTION_SIDE_BUTTON: jstr('side'), ACTION_SETTINGS: jstr('settings'), ACTION_UNSENT: jstr('unsent'), ACTION_FOOD: jstr('food'), ACTION_USUALS: jstr('usuals'),
      ACTION_THREAD: jstr('thread'), EXTRA_THREAD: 'x', EXTRA_SETTINGS_FOCUS: 'f', Intent: { ACTION_MAIN: 'main', EXTRA_TEXT: 't' },
      ai: { wizards: { os: { assist: { AssistNote: { ACTION: jstr('ai.wizards.os.action.AGENT_NOTE') } } } } },
      Handoff: { json: () => null, settings: () => null, quote: JSON.stringify }, android: { util: { Log: { i() {} } } },
      main: { removeCallbacks() {}, post: r => posted.push(r) }, deliverHandoff: 'deliver', pendingHandoff: null, handoffTries: 0 } });
  assert.equal(ctx.pendingHandoff, '{"action":"agent-note"}');
  assert.deepEqual(posted, ['deliver']);
});

// The real agentNote() from app-boot.js with a stand-in app registry.
function shell({ apps = {}, later = {} } = {}) {
  const log = [], APP = { ...apps };
  const ctx = { APP, log, V: { state: 'idle' }, URL, Promise, location: new URL('https://box.test/wizard-os-home/index.html'),
    toast: (i, t) => log.push('toast:' + t), startVoice: m => log.push('listen:' + m), window: null };
  ctx.window = { __backLog: [], WizCanOpen: id => !!APP[id], WizOpenApp: (id, url) => { log.push('open:' + id + ' ' + url); return true; },
    WizCore: { appsLoaded: async () => { Object.assign(APP, later); } } };
  vm.createContext(ctx);
  vm.runInContext(between(read('web/app-boot.js'), '  const AGENT_NOTE_APPS', '  window.__wosHandoff = h => {') + '\nthis.agentNote = agentNote;', ctx);
  return { log, run: async () => { ctx.agentNote(); await new Promise(r => setTimeout(r, 0)); return log; } };
}

test('the shell opens Messenger at its pinned Agent chat, also when the app list arrives a moment later', async () => {
  const messenger = { id: 'messenger', url: '/messenger/', kind: 'wizard' };
  assert.deepEqual(await shell({ apps: { messenger } }).run(), ['open:messenger https://box.test/messenger/#chat=agent:notes']);
  assert.deepEqual(await shell({ later: { messenger } }).run(), ['open:messenger https://box.test/messenger/#chat=agent:notes'], 'cold start');
  assert.deepEqual(await shell({ apps: { 'wizard-messenger': { url: '/wizard-messenger/' } } }).run(), ['open:wizard-messenger https://box.test/wizard-messenger/#chat=agent:notes']);
});

test('without Messenger the press is never dead: it says where the Agent chat is and listens as before', async () => {
  const log = await shell().run();
  assert.equal(log.length, 2);
  assert.match(log[0], /^toast:.*Messenger/);
  assert.equal(log[1], 'listen:auto');
});

test('the handoff routes agent-note to agentNote() before any app id lookup', () => {
  const src = read('web/app-boot.js');
  const handoff = between(src, '  window.__wosHandoff = h => {', '    if (APP[h.action]?.kind === \'wizard\')');
  const ctx = { called: 0, agentNote() { ctx.called++; }, closeSheets() {}, appVars: { idx: 0 }, HOME: 0, goDesk() {}, window: {} };
  vm.createContext(ctx);
  const fn = vm.runInContext(handoff.replace('  window.__wosHandoff = h => {', '(h => {') + '  return "fell-through"; })', ctx);
  assert.equal(fn({ action: 'agent-note' }), true);
  assert.equal(ctx.called, 1);
});
