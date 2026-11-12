// Wizard for Mac draws its red/yellow/green window buttons over the top-left of a full-size web view.
// shell.js marks the page before first paint and desktop.css keeps the bar clear of the buttons (try-wizard#19).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const shell = read('web/core/shell.js');

function run({ mac = false, ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15' } = {}) {
  const dataset = { shell: 'desktop' };
  const window = {
    location: { search: '', href: 'https://box.example/wizard-os-home/desktop.html', hash: '', replace() {} },
    stop() {},
  };
  if (mac) window.webkit = { messageHandlers: { wizardNative: { postMessage() {} } } };
  const ctx = {
    window,
    location: window.location,
    navigator: { userAgent: ua },
    document: { documentElement: { dataset, style: {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: q => ({ matches: q === '(hover: hover)' || q === '(any-pointer: fine)' }),
    URL, URLSearchParams,
  };
  vm.runInNewContext(shell, ctx);
  return dataset;
}

test('the Mac app marks the page before first paint; browsers and phones do not', () => {
  assert.equal(run({ mac: true }).nativeChrome, 'mac');
  assert.equal(run().nativeChrome, undefined);
  assert.equal(run({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari' }).nativeChrome, undefined);
});

test('inside the Mac app the desktop bar reserves the native window-button area', () => {
  const css = read('web/desktop/desktop.css');
  // The Mac app measures the buttons into --wz-titlebar-left; without it, 96px matches the area
  // WizardDragView leaves to the window buttons (p.x < 96). 8px is the bar's normal edge padding.
  assert.match(css, /html\[data-native-chrome="mac"\] \.bar \{[^}]*padding-left:\s*max\(8px,\s*var\(--wz-titlebar-left,\s*96px\)\)/);
  assert.match(css, /html\[data-native-chrome="mac"\] \.ws-list \{[^}]*overflow-x:\s*auto/);
});

test('the measured inset only ever applies inside the Mac app', () => {
  const css = read('web/desktop/desktop.css');
  const uses = css.split('\n').filter(l => l.includes('--wz-titlebar-left') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'));
  assert.ok(uses.length >= 1);
  for (const l of uses) assert.match(l, /^html\[data-native-chrome="mac"\] /);
});

test('inside the Mac app the AI apps sidebar keeps its header and rail below the window buttons (wizard-os#543)', () => {
  const css = read('web/layouts/ai-apps/desktop.css');
  const scope = 'html\\[data-shell="desktop"\\]\\[data-layout="ai-apps"\\]\\[data-native-chrome="mac"\\]';
  // the 28pt title bar, scaled like the measured inset (page zoom); 0 when the app reports 0 (full screen)
  assert.match(css, new RegExp(scope + ' \\{[^}]*--aad-mac-top:\\s*calc\\(var\\(--wz-titlebar-left,\\s*80px\\)\\s*\\*\\s*0\\.35\\)'));
  assert.match(css, new RegExp(scope + ' \\.aad-sh \\{[^}]*margin-top:\\s*var\\(--aad-mac-top\\)'));
  assert.match(css, new RegExp(scope + ' \\.aad-rail \\{[^}]*padding-top:\\s*calc\\(8px \\+ var\\(--aad-mac-top\\)\\)'));
  assert.match(css, new RegExp(scope + ' \\.aad-ctop \\{[^}]*padding-left:\\s*max\\(20px,'));
  // never outside the Mac app
  for (const l of css.split('\n').filter(l => /--aad-mac-top|--wz-titlebar-left/.test(l) && /^html/.test(l))) assert.match(l, /^html\[[^\]]*\]\[[^\]]*\]\[data-native-chrome="mac"\]|^html\[data-native-chrome="mac"\]/);
});

test('inside the Mac app the chat and app panel header buttons get click-through spots in #bar (wizard-os#548)', () => {
  // try-wizard WizardDragView takes a mouse-down in #bar's box as a window drag unless it is on a control INSIDE #bar;
  // the AI apps headers sit over #bar on their desks, so each of their buttons needs a stand-in there.
  const js = read('web/layouts/ai-apps/desktop.js'), css = read('web/layouts/ai-apps/desktop.css');
  const block = js.slice(js.indexOf('const macHoles = (() => {'), js.indexOf('  })();', js.indexOf('const macHoles = (() => {')));
  assert.ok(block.length > 100, 'macHoles block');
  assert.match(block, /root\.dataset\?\.nativeChrome !== 'mac'\) return null/, 'only inside the Mac app');
  assert.match(block, /bar\.append\(box\)/, 'the spots live inside #bar, where the Mac app looks');
  assert.match(block, /for \(const head of \[cTop, pTop, sTop\]\)/, 'every header the layout owns');
  assert.match(block, /tabindex: '-1'/, 'a stand-in the Mac app counts as a control, never in the tab order');
  assert.match(js, /syncOrb\(\); macHoles\?\.soon\(\);/, 'repainted with the top row');
  assert.match(js, /macHoles\?\.dispose\(\);/, 'removed when the layout goes');
  const scope = 'html\\[data-shell="desktop"\\]\\[data-layout="ai-apps"\\]\\[data-native-chrome="mac"\\]';
  assert.match(css, new RegExp(scope + ' #bar > \\.aad-mac-holes > i \\{[^}]*pointer-events:\\s*none !important'), 'never takes a click itself');
});
