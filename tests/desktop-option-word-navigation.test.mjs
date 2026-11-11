import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

// The very same assertions can run against the exact serving donor, without editing it.
const root = process.env.QA_SOURCE_ROOT || new URL('../', import.meta.url).pathname;
const read = file => readFileSync(resolve(root, file), 'utf8');
const desktop = read('web/desktop/desktop.js');
const layout = read('web/layouts/ai-apps/desktop.js');
function between(src, start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `exact production extraction: ${start}`);
  return src.slice(a, b);
}
function event(code, extra = {}) {
  return { key: code, code, altKey: true, shiftKey: false, ctrlKey: false, metaKey: false,
    target: { value: '', matches: () => false, closest: () => null },
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
}
function shell({ field = false, value = '', chat = true, picker = false, skinConsumes = false, home = false, realTyping = false, skinKey = null, mac = true } = {}) {
  const calls = [];
  const action = name => (...args) => calls.push([name, ...args]);
  const context = {
    pick: { active: () => picker, key: action('pick') },
    window: { WosSkinHost: { key: () => { calls.push(['layout']); return skinConsumes; } } },
    WosSkinHost: skinKey && { key: e => { calls.push(['layout']); return skinKey(e); } }, keyHints: { pinned: () => false, down() {} }, NATIVE_MENU: false,
    homeOpen: home, focused: () => ({ id: 'synthetic', app: chat ? 'chats' : 'frame', thread: 'synthetic-thread' }),
    typing: () => field, CHATS: { threadAct: action('threadAct') },
    winEl: () => ({ querySelector: () => ({}) }), VOICE: { state: 'idle' },
    pal: { hidden: true }, LINKS: null, settingsFocused: () => false,
    ws: [{ wins: [] }], cur: 0, document: { activeElement: null },
    jumpBack: action('back'), swapWin: action('swap'), dirFocus: action('focus'),
    stepWin: action('step'), speakScreen: action('speak'), commandVoice: action('command'),
    closePalette() {}, toggleKeys() {}, closeSettings() {}, closeUsage() {},
    chatsUpDown: action('ready'), resizeFocused: action('resize'), IS_MAC: mac, MOD: '⌥', log() {}, toast: action('toast'),
  };
  vm.createContext(context);
  // The production field lookup (and, on request, the production typing test) run as shipped.
  if (desktop.includes('  const keyField = ')) vm.runInContext(['textField', 'keyField'].map(n => between(desktop, `  const ${n} = `, '\n') + `\nthis.${n} = ${n};`).join('\n'), context);
  else Object.assign(context, { keyField: e => e.target, textField: t => context.typing(t) }); // a donor from before issue 1279
  if (realTyping) vm.runInContext(between(desktop, '  const typing = ', '\n') + '\nthis.typing = typing;', context);
  vm.runInContext(between(desktop, '  function onKey(e, fromFrame = false) {', "  addEventListener('keydown', e => onKey(e), true);"), context);
  return { calls, key(code, extra = {}) { const e = event(code, { target: { value, matches: () => false, closest: () => null }, ...extra }); context.onKey(e); return e; } };
}
function ai({ modal = '', typing = false, docked = true } = {}) {
  const calls = [], act = name => (...args) => calls.push([name, ...args]);
  const context = {
    allOpenNow: () => modal === 'all', settingsOpen: () => modal === 'settings', snoozeOpen: () => modal === 'snooze',
    KEY_LIKE: /^(Key[A-Z]|Digit\d|Arrow|Bracket|Space)/,
    typing: () => typing, appFront: () => false, docked, pane: null, leftOption: false,
    doc: { querySelector: selector => ({ click: act(selector) }) },
    chatBtn: name => ({ click: act(name) }), settings: act('settings'), openAll: act('all'),
    closeAll: act('closeAll'), closeSettings: act('closeSettings'),
    stepReady: act('ready'), vtRows: () => [],
  };
  vm.createContext(context);
  // The live left-Option picker adds physical-key bookkeeping before altKey's
  // guard. Extract the complete production handler, not its former first line.
  const start = layout.includes("  api.keys.on({ down: e => {\n    if (e.code === 'AltLeft')")
    ? "  api.keys.on({ down: e => {\n    if (e.code === 'AltLeft')"
    : '  api.keys.on({ down: e => {\n    if (!e.altKey';
  const src = between(layout, start, '\n  const vtRows = ');
  vm.runInContext('var down; var api = {keys:{on(h){down=h.down;}}};\n' + src, context);
  return { calls, down: e => context.down(e), key: (code, extra = {}) => context.down(event(code, extra)) };
}
for (const code of ['ArrowLeft', 'ArrowRight']) {
  for (const scene of [
    { name: 'empty composer', field: true }, { name: 'whitespace composer', field: true, value: '   ' },
    { name: 'populated composer', field: true, value: 'alpha beta' }, { name: 'thread body' },
    { name: 'non-chat app', chat: false }, { name: 'Home', home: true },
    { name: 'picker', picker: true }, { name: 'layout-first dispatcher', skinConsumes: true },
  ]) test(`standard ${code}: ${scene.name} leaves default, propagation and actions untouched`, () => {
    const w = shell(scene), e = w.key(code);
    assert.ok(!e.defaultPrevented && !e.stopped, 'word navigation must remain native');
    assert.deepEqual(w.calls, [], 'no thread, picker, layout or window dispatch');
  });
  for (const modal of ['', 'all', 'settings', 'snooze']) for (const typing of [false, true])
    test(`AI apps ${code}: modal=${modal || 'none'}, typing=${typing} passes through without action`, () => {
      const w = ai({ modal, typing });
      assert.equal(w.key(code), false, 'unclaimed, including with a sheet open');
      assert.deepEqual(w.calls, []);
    });
}
test('standard: shifted swaps, bracket navigation, Ready, Z Back and S speak are unchanged', () => {
  for (const [code, extra, expected] of [
    ['ArrowLeft', { shiftKey: true }, ['swap', -1]], ['ArrowRight', { shiftKey: true }, ['swap', 1]],
    ['BracketLeft', {}, ['step', -1]], ['BracketRight', {}, ['step', 1]],
    ['ArrowDown', {}, ['ready', 1]], ['ArrowUp', {}, ['ready', -1]],
    ['KeyZ', {}, ['back']], ['KeyS', {}, ['speak']],
  ]) {
    const w = shell(), e = w.key(code, extra);
    assert.ok(e.defaultPrevented && e.stopped, code);
    assert.deepEqual(w.calls.filter(c => c[0] !== 'layout'), [expected], code);
  }
  const w = shell({ field: true });
  assert.ok(!w.key('ArrowLeft', { shiftKey: true }).defaultPrevented, 'native word selection remains native');
});
test('AI apps: E Archive, Z Snooze, A All apps, S Settings and sheet Z close retain exact meanings', () => {
  for (const [code, expected] of [['KeyE', 'done'], ['KeyZ', 'snooze'], ['KeyA', 'all'], ['KeyS', 'settings']]) {
    const w = ai(); assert.equal(w.key(code), true); assert.deepEqual(w.calls, [[expected]]);
    const held = ai(); assert.equal(held.key(code, { repeat: true }), true); assert.deepEqual(held.calls, []);
  }
  const w = ai({ modal: 'snooze' }); assert.equal(w.key('KeyZ'), true);
  assert.deepEqual(w.calls, [['.boom-sheet [data-boom-close]']]);
  const field = ai({ typing: true }); assert.equal(field.key('KeyE'), false); assert.deepEqual(field.calls, [], 'Mac accent entry');
});
test('help and hints cannot advertise the removed arrow actions or Someday chord', () => {
  assert.doesNotMatch(desktop, /\['→  ←', 'Archive \/ Snooze'|\['\[data-chact="(?:done|snooze)"\]', '[←→]'/);
  assert.match(layout, /\[\['snooze', 'Z'\], \['done', 'E'\], \['resolve', 'X'\]\]/);
  assert.doesNotMatch(layout, /putIn\(doc\.querySelector\('\.boom-sheet \[data-boom-someday\]'\), '←'\)/);
  assert.doesNotMatch(layout, /ArrowLeft: 'snooze'|ArrowRight: 'done'/);
});

// Issue 1279: ⌥⇧← / → in an app's text field (Messenger's composer inside its frame) selected nothing, because the
// AI apps view's key handler (WosSkinHost.key) runs first and only sees the shell document, where the focused thing is
// the app's iframe. The text field must keep the chord before any layout key; outside a field the swap still works.
const textarea = () => ({ tagName: 'TEXTAREA', isContentEditable: false, value: 'alpha beta', matches: () => false, closest: () => null });
const frameWith = inner => ({ tagName: 'IFRAME', isContentEditable: false, contentDocument: { activeElement: inner }, matches: () => false, closest: () => null });
for (const code of ['ArrowLeft', 'ArrowRight']) {
  for (const [name, target] of [
    ['an app frame textarea (forwarded frame event)', textarea()],
    ['the app iframe itself (shell document focus)', frameWith(textarea())],
    ['a contenteditable inside a shadow root', { tagName: 'X-EDITOR', isContentEditable: false, shadowRoot: { activeElement: { tagName: 'DIV', isContentEditable: true } }, matches: () => false, closest: () => null }],
    ['a nested app frame input', frameWith(frameWith({ tagName: 'INPUT', isContentEditable: false }))],
    ['a search box in an app frame', frameWith({ tagName: 'INPUT', type: 'search', isContentEditable: false })],
  ]) test(`⌥⇧${code} in ${name} stays the field's word selection, even with a layout that claims arrows`, () => {
    // The real AI apps view handler as the layout key: its own typing() sees only the shell's focused iframe.
    const w = shell({ realTyping: true, skinKey: ai({ typing: false }).down }), e = w.key(code, { shiftKey: true, target });
    assert.ok(!e.defaultPrevented && !e.stopped, 'native word selection');
    assert.deepEqual(w.calls, [], 'no layout, swap or focus dispatch');
  });
  test(`⌥⇧${code} outside a text field still swaps windows`, () => {
    const body = { tagName: 'BODY', isContentEditable: false, matches: () => false, closest: () => null };
    const control = type => ({ tagName: 'INPUT', type, isContentEditable: false, matches: () => false, closest: () => null });
    for (const target of [body, frameWith(body), frameWith(null), control('checkbox'), frameWith(control('radio')), control('button'), { tagName: 'SELECT', isContentEditable: false, matches: () => false, closest: () => null }]) {
      // (a checkbox, button or picker has no words to select: from an app frame the chord stays the shell's)
      if (target.tagName !== 'IFRAME' && target.tagName !== 'BODY') { const w = shell({ realTyping: true, skinKey: () => true }), e = w.key(code, { shiftKey: true, target }); assert.ok(e.defaultPrevented, 'a layout still owns the chord on ' + target.tagName); continue; }
      const w = shell({ realTyping: true }), e = w.key(code, { shiftKey: true, target });
      assert.ok(e.defaultPrevented, 'the shell chord');
      assert.deepEqual(w.calls.filter(c => c[0] !== 'layout'), [['swap', code === 'ArrowLeft' ? -1 : 1]]);
    }
  });
}
test('a cross-origin app frame (unreadable document) never throws and counts as not typing', () => {
  const target = { tagName: 'IFRAME', get contentDocument() { throw new Error('SecurityError'); }, matches: () => false, closest: () => null };
  const w = shell({ realTyping: true }), e = w.key('ArrowLeft', { shiftKey: true, target });
  assert.deepEqual(w.calls.filter(c => c[0] !== 'layout'), [['swap', -1]]);
  assert.ok(e.defaultPrevented);
});

// Issue 1278: on a Mac ⌥- types – and ⌥⇧- types — (⌥= ≠, ⌥⇧= ±). The shell's ⌥− / ⌥= window resize (and the AI apps
// view's) swallowed them in every text field, an app frame's included. In a field the character wins; elsewhere, and
// off the Mac (where Alt+- types nothing), the resize keys are unchanged.
for (const code of ['Minus', 'Equal']) for (const shiftKey of [false, true]) {
  const chord = `⌥${shiftKey ? '⇧' : ''}${code}`;
  for (const [name, target] of [
    ['the chat composer', textarea()],
    ['an app frame textarea (Notes, Messenger: forwarded frame event)', textarea()],
    ['the app iframe itself (shell document focus)', frameWith(textarea())],
    ['a contenteditable inside a shadow root', { tagName: 'X-EDITOR', isContentEditable: false, shadowRoot: { activeElement: { tagName: 'DIV', isContentEditable: true } }, matches: () => false, closest: () => null }],
  ]) test(`${chord} in ${name} types its character on a Mac, even with a layout that resizes`, () => {
    const w = shell({ realTyping: true, skinKey: ai({ typing: false }).down }), e = w.key(code, { shiftKey, target });
    assert.ok(!e.defaultPrevented && !e.stopped, 'the field gets the key');
    assert.deepEqual(w.calls, [], 'no layout or resize dispatch');
  });
  test(`${chord} outside a text field, or off the Mac, still resizes the window`, () => {
    const body = { tagName: 'BODY', isContentEditable: false, matches: () => false, closest: () => null };
    for (const [target, mac] of [[body, true], [frameWith(body), true], [{ tagName: 'INPUT', type: 'checkbox', isContentEditable: false, matches: () => false, closest: () => null }, true], [textarea(), false]]) {
      const w = shell({ realTyping: true, mac }), e = w.key(code, { shiftKey, target });
      assert.ok(e.defaultPrevented, 'the shell chord');
      assert.deepEqual(w.calls.filter(c => c[0] !== 'layout'), [['resize', code === 'Equal' ? 1 : -1]]);
    }
  });
}
