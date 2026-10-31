// One selection menu for every app (James, 31 Oct 2026; credits Oscar's wizard-ux #751 Reply to selected words).
// The shell owns the pop-up; Chats and installed apps add items; no second floating Reply implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const sel = read('core/sel-menu.js'), services = read('core/app-services.js'), client = read('core/app-client.js');
const chats = read('core/chats.js'), desk = read('desktop/desktop.js'), css = read('core/sel-menu.css');

test('floating menu pairs skin text with an opaque skin base, never a fixed dark tint', () => {
  assert.match(css, /var\(--wz-base, var\(--bg, #05030c\)\)/);
  assert.match(css, /color: var\(--wz-text, var\(--ink, #efeaff\)\)/);
  assert.doesNotMatch(css, /rgba\(24, 16, 48/);
});

test('one implementation: no per-app floating Reply button, the shell menu serves apps', () => {
  for (const [name, src] of [['app-services', services], ['desktop', desk], ['css', css]]) assert.doesNotMatch(src, /app-sel-reply/, name);
  assert.match(services, /window\.WosSelMenu\?\.watch\?\.\(\{ doc, frame: st\.frame/);
  assert.match(services, /window\.WosSelMenu\?\.forget\?\.\(st\.doc\)/, 'a reset app document leaves the menu');
  assert.match(services, /selection: Object\.freeze\(\{\s*items\(list, pick\)/);
  assert.match(client, /selection: Object\.freeze\(\{\s*get available\(\)/);
});

test('Chats registers its own Quote on the shared menu instead of the core knowing about threads', () => {
  assert.match(chats, /window\.WosSelMenu\?\.register\('chats'/);
  assert.match(chats, /items: ctx => ctx\.wid \? \['quote'\] : \[\]/);
  assert.doesNotMatch(sel, /\.ch-thread/, 'the core no longer reads Chats markup');
});

test('idle costs nothing: no polling, intervals or animation loops in the menu', () => {
  assert.doesNotMatch(sel, /setInterval\(/);
  assert.equal((sel.match(/requestAnimationFrame\(/g) || []).length, 1, 'one frame only, to fade the menu in');
  assert.doesNotMatch(services.slice(services.indexOf('WosSelMenu?.watch'), services.indexOf('WosSelMenu?.watch') + 600), /setInterval|setTimeout/);
});

test('Back, Escape and a tap outside close the menu and let go of the words', () => {
  assert.match(sel, /function back\(\) \{[\s\S]*dismiss\(\); return 'selection';/);
  assert.match(sel, /e\.key === 'Escape' && cur && el && !el\.hidden/);
  assert.match(sel, /if \(!mineDoc\) \{ dismiss\(\);/, 'a press in another document closes it');
  assert.match(sel, /if \(c\.explicit\) \{ const x = c\.src\.explicit; c\.src\.explicit = null; try \{ x\?\.dismissed\?\.\(\); \}/, 'an app that draws its own selection hears the dismissal');
});

test('Reply in chat opens an unsent MAIN Chats draft through the verified frame, never a run', () => {
  assert.match(services, /reply: \(id, item\) => \{ if \(!valid\(st, doc\) \|\| typeof st\.openContextDraft !== 'function'\) throw fault\('Context draft unavailable'\); return st\.openContextDraft\(st\.appId \+ ':' \+ id, item\); \}/);
  assert.doesNotMatch(sel, /sendChat|\/v1\/runs/);
  // openContextDraft targets the main agent even when another agent is focused (two-agent rule).
  assert.match(chats, /function openContextDraft\(wid, key, item, text = ''\) \{[\s\S]{0,400}if \(winAgent\(w\)\) setFocus\(w, null\);/);
});

test('⌥A on desktop replies about the app in front through the same menu', () => {
  assert.match(desk, /alt && !shift && code === 'KeyA'\) return hit\(\(\) => \{ if \(!e\.repeat\) replyAbout\(\); \}\)/);
  assert.match(desk, /window\.WosSelMenu\?\.replyAbout\?\.\(fr,/);
});

test('app items are validated data, never app markup, and at most six', () => {
  const start = sel.indexOf('  const SAFE_ID'), end = sel.indexOf('  // WizardApp.selection.items(list, pick)');
  const ICON = { note: 'x' };
  const fn = vm.runInNewContext(`const ICON = ${JSON.stringify(ICON)};${sel.slice(start, end)}; cleanItems`);
  assert.deepEqual(JSON.parse(JSON.stringify(fn([{ id: 'note', label: ' Note ', icon: 'note' }, { id: 'ask', label: 'Ask AI', icon: '<svg onload=x>' }]))), [{ id: 'note', label: 'Note', icon: 'note' }, { id: 'ask', label: 'Ask AI', icon: '' }]);
  assert.throws(() => fn([{ id: 'Bad id', label: 'x' }]));
  assert.throws(() => fn(Array.from({ length: 7 }, (_, i) => ({ id: 'a' + i, label: 'x' }))));
  assert.match(sel, /\$\{esc\(it\.label\)\}/, 'labels are escaped');
});

test('a list saved before Reply in chat existed gains it once; a newer list stays as chosen', () => {
  const store = new Map();
  const ctx = { localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, JSON };
  const start = sel.indexOf('  const ITEMS = ['), end = sel.indexOf('  /* ---- surfaces ---- */');
  const api = vm.runInNewContext(`const KEY='wos.selmenu', ICON={};${sel.slice(start, end)}; ({ enabled, setEnabled })`, ctx);
  store.set('wos.selmenu', JSON.stringify(['copy', 'quote']));
  assert.deepEqual([...api.enabled()], ['copy', 'reply', 'quote']);
  api.setEnabled(['copy', 'quote']);
  assert.deepEqual([...api.enabled()], ['copy', 'quote']);
});
