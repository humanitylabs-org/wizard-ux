// Settings and previews behave like windows (wizard-os#265, APP-DESIGN-RULES.md rule 7).
// Desktop: Settings and same-origin page previews are normal shell windows (title-bar ✕, ⌥W, Esc).
// Phone: Settings stays the full-height sheet and now also closes by swiping its grip down.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const desk = read('web/desktop/desktop.js'), deskCss = read('web/desktop/desktop.css');
const phone = read('web/app.js'), phoneCss = read('web/styles.css'), links = read('web/core/links.js');
const slice = (s, from, to) => { const a = s.indexOf(from); assert.ok(a >= 0, from); const b = s.indexOf(to, a); assert.ok(b > a, to); return s.slice(a, b); };

test('desktop Settings opens as a window and every way of closing the window hides it', () => {
  const open = slice(desk, '  function openSettings(focus) {', '  function closeSettings()');
  assert.match(open, /if \(w\) focusWin\(w\.id\); else \{ settingsFocus = document\.activeElement; newWin\(\{ app: 'settings' \}\); \}/);
  assert.match(desk, /    const w = settingsWin\(\); if \(w\) closeWin\(w\.id\); else hostSettings\(\);\n  \}/, 'on a desk Settings is a window');
  // From Home (not a desk) it is a centred panel over Home; Esc, ✕ or a click outside closes it.
  assert.match(open, /if \(homeOpen && !w\) \{/);
  assert.match(desk, /scrim\.addEventListener\('click', \(\) => closeSettings\(\)\);/);
  assert.match(desk, /if \(settingsModal\) closeSettings\(\);\n    homeOpen = false;/, 'leaving Home closes the panel');
  // ✕ in the title bar, ⌥W and a synced desk all go through closeWin → render → hostSettings.
  assert.match(desk, /queueMicrotask\(\(\) => window\.WosResources\?\.sync\(\)\);\n    afterRender\?\.\(\);/);
  assert.match(desk, /afterRender = hostSettings;/);
  const host = slice(desk, '  function hostSettings() {', '  afterRender = hostSettings;');
  assert.match(host, /if \(host\) \{ if \(setEl\.parentNode !== host\) host\.appendChild\(setEl\); return; \}/);
  assert.match(host, /setEl\.hidden = true;/);
  assert.match(desk, /if \(w\.app === 'settings'\) return '<div class="settings-host"><\/div>';/);
  assert.match(desk, /if \(w\.app === 'settings'\) return \{ id: 'settings', name: 'Settings'/, 'title bar names it Settings');
  assert.match(desk, /if \(w\?\.app === 'settings'\) delete W\[id\]; \/\/ Settings is a window, never restored/);
});

test('desktop Settings keys: ⌥, toggles, Esc closes only the focused Settings window, ⌥ window keys are not swallowed', () => {
  assert.equal((desk.match(/return hit\(toggleSettings\)/g) || []).length, 2);
  assert.match(desk, /function toggleSettings\(\) \{ if \(settingsFocused\(\)\) closeSettings\(\); else openSettings\(\); \}/);
  assert.match(desk, /if \(settingsFocused\(\)\) \{ if \(settingsView\.back\(\)\) return 'settings-page'; closeSettings\(\); return 'settings'; \}/);
  assert.match(desk, /if \(settingsFocused\(\) && !e\.altKey\) return;/);
  assert.doesNotMatch(desk, /setEl && !setEl\.hidden && !\(e\.altKey && code === 'Comma'\)/, 'the old modal swallow of every ⌥ key is gone');
  assert.equal((desk.match(/setEl\.setAttribute\('aria-modal'/g) || []).length, 1, 'only the Home panel is a dialog, never the window');
  assert.match(desk, /settingsModal = true; setEl\.classList\.add\('is-modal'\); setEl\.setAttribute\('aria-modal', 'true'\)/);
});

test('desktop Settings window chrome: the panel fills the window, its own ✕ gives way to the title bar', () => {
  assert.match(deskCss, /\.win \.dsettings \{ position: relative; inset: auto; width: auto; height: 100%;/);
  assert.match(deskCss, /\.win \.dsettings > \.st-close \{ display: none; \}/);
});

test('Settings and previews are local windows: never synced to other devices', () => {
  const sb = { console, JSON, Map, Set, Math, Date, setTimeout() {}, clearTimeout() {}, addEventListener() {}, navigator: { userAgent: 'x' }, localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(read('web/core/features.js'), { window: sb });
  sb.window = sb; vm.runInNewContext(read('web/core/workspace-sync.js'), sb);
  const S = sb.WosWorkspaceSync;
  assert.equal(S.syncable({ id: 'a', app: 'settings' }), false);
  assert.equal(S.syncable({ id: 'b', app: 'frame', url: '/x', preview: true }), false);
  assert.equal(S.syncable({ id: 'c', app: 'frame', url: '/x' }), true, 'a kept page still syncs');
});

test('desktop page previews open as a window; images still use the viewer and files still download', () => {
  const go = slice(links, '    function go(href, base, doc) {', '    function back() {');
  const img = go.indexOf('viewImage(u, doc)'), file = go.indexOf('download(u, doc)'), win = go.indexOf('asWindow(');
  assert.ok(img > 0 && file > img && win > file, 'asWindow only after the image and file branches');
  assert.ok(win < go.indexOf('stack.push'), 'before the pane opens');
  assert.match(desk, /asWindow: \(url, title\) => \{ const o = appAt\(url\); newWin\(\{ app: 'frame', url, title: o \? o\.name : title, preview: true,/);
  assert.match(desk, /if \(f\.preview\) \{ closeWin\(f\.id\); return 'preview'; \}/, 'Esc closes a preview window');
  assert.doesNotMatch(phone, /asWindow/, 'phone keeps its full-height link sheet');
});

test('phone Settings sheet closes by swiping its grip down (×, Back and the scrim already close it)', () => {
  const sw = slice(phone, "  { const grip = settingsEl.querySelector('.sheet-grip');", "  settingsEl.addEventListener('click', e => {");
  assert.match(sw, /if \(dy > 90 \|\| dy \/ \(\(performance\.now\(\) - t0\) \|\| 1\) > \.6\) closeSheets\(\)/);
  assert.match(phoneCss, /#settings > \.sheet-grip \{[^}]*touch-action: none;/);
  assert.match(phone, /if \(e\.target\.closest\('\[data-stclose\]'\)\) return closeSheets\(\);/);
});

test('a form in a window aimed at _top or _parent stays in its window (guardFrame), other targets are left alone', () => {
  const sb = { location: { origin: 'http://w.test', href: 'http://w.test/wizard-os-home/desktop.html' }, navigator: { userAgent: 'x' }, URL };
  sb.window = sb; vm.runInNewContext(links, sb);
  const ls = {}, doc = { addEventListener: (t, f) => { (ls[t] ||= []).push(f); } };
  const win = { document: doc, location: { href: 'http://w.test/files/a.html' }, open() {} };
  sb.WizLinks.guardFrame(win, '/files/', { open() {}, route: () => false });
  const form = t => { const a = { target: t }; return { getAttribute: k => a[k] ?? null, setAttribute: (k, v) => { a[k] = v; }, a }; };
  const submit = (f, b) => ls.submit.forEach(fn => fn({ target: f, submitter: b }));
  for (const t of ['_top', '_parent', '_TOP']) { const f = form(t); submit(f); assert.equal(f.a.target, '_self', t); }
  for (const t of ['_blank', 'named', null]) { const f = form(t); submit(f); assert.equal(f.a.target, t, String(t)); }
  const f = form(null), b = { attrs: { formtarget: '_top' }, hasAttribute(k) { return k in this.attrs; }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; } };
  submit(f, b); assert.equal(b.attrs.formtarget, '_self', 'a submit button\'s formtarget too');
});
