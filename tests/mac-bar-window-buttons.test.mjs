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
  // 96px matches the area WizardDragView leaves to the window buttons (p.x < 96).
  assert.match(css, /html\[data-native-chrome="mac"\] \.bar \{[^}]*padding-left:\s*96px/);
  assert.match(css, /html\[data-native-chrome="mac"\] \.ws-list \{[^}]*overflow-x:\s*auto/);
});
