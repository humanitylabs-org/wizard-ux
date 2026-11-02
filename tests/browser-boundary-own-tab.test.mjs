import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
// wizard-os #385, Files decision (2 Nov 2026): File Browser is the approved separate-origin exception. Under the
// browser boundary the shell opens it ONLY as its own tab (no opener, no referrer), never in a Wizard window, and only
// at a different https origin. Real Chromium proof: tools/qa-browser-files-own-tab.cjs.
const read = name => fs.readFileSync(new URL('../web/' + name, import.meta.url), 'utf8');
function boundary() {
  const opened = [];
  const location = new URL('https://box.example.test/wizard-os-home/');
  const document = { hidden: false, readyState: 'loading', activeElement: null, addEventListener() {}, querySelector: () => ({ content: 'a1'.repeat(32), remove() {} }) };
  const ctx = { location, document, URL, Request, Headers, crypto: webcrypto, TextEncoder, setTimeout, clearTimeout, setInterval() {},
    addEventListener() {}, fetch: async () => new Response('{}'), open: (...a) => { opened.push(a); return null; } };
  ctx.window = ctx; ctx.parent = ctx;
  vm.runInNewContext(read('core/browser-boundary.js'), ctx);
  return { B: ctx.WizBrowserBoundary, opened };
}

test('the own-tab app opens in a new tab with no opener and no referrer, at its own https origin only', () => {
  const { B, opened } = boundary();
  const files = { id: 'files', name: 'Files', ownTab: true, url: 'https://box.example.test:8794/files/' };
  assert.equal(B.openOwnTab(files), true);
  assert.deepEqual(opened, [['https://box.example.test:8794/files/', '_blank', 'noopener,noreferrer']]);
  for (const bad of [
    { ...files, ownTab: undefined },                                   // not flagged by the Service
    { ...files, url: '/files/' },                                      // same origin: would be a framed owner page
    { ...files, url: 'https://box.example.test/files/' },              // the Wizard origin itself
    { ...files, url: 'http://box.example.test:8794/files/' },          // not https
    { ...files, url: 'https://user:pw@box.example.test:8794/files/' }, // credentials in the address
    { ...files, url: 'javascript:alert(1)' },
  ]) assert.equal(B.openOwnTab(bad), false, JSON.stringify(bad.url));
  assert.equal(opened.length, 1);
});

test('both shells open the own-tab app as a tab before any frame path, and never render a frame for it', () => {
  const phone = read('app.js'), desk = read('desktop/desktop.js'), apps = read('core/apps.js');
  const early = /if \(a\.ownTab && window\.WizBrowserBoundary\?\.enabled\)[^\n]*openOwnTab\(a\)/;
  for (const [name, src, fn] of [['phone', phone, 'function openApp(a, extra = {}, opts = {}) {'], ['desktop', desk, 'function openApp(a, opts = {}) {']]) {
    const body = src.slice(src.indexOf(fn), src.indexOf(fn) + 600);
    assert.match(body, early, name + ': own-tab returns before the setup gate and window placement');
  }
  const frameCore = phone.slice(phone.indexOf('function renderFrameCore(w, a) {'), phone.indexOf('const frameUrl', phone.indexOf('function renderFrameCore(w, a) {')));
  assert.match(frameCore, /a\.ownTab && window\.WizBrowserBoundary\?\.enabled/);
  assert.doesNotMatch(frameCore, /<iframe/);
  const bodyHtml = desk.slice(desk.indexOf("const a = appOf(w), url = window.WosOwnViews"), desk.indexOf('<iframe data-own-app'));
  assert.match(bodyHtml, /a\.ownTab && window\.WizBrowserBoundary\?\.enabled\) \{[^\n]*return `<div class="frame-fallback on own-tab">/);
  // The flag only comes from the Service's own_tab on an https address.
  assert.match(apps, /a\.own_tab === true && \/\^https:\\\/\\\/\/\.test\(a\.url \|\| ''\) \? \{ ownTab: true \}/);
});
