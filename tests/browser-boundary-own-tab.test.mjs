// Browser owner boundary (wizard-os#942): an app that can't run in a sandboxed window at all (Files, upstream File
// Browser: its sign-in lives in the page's own localStorage and cookie and it calls its own API directly) opens as its
// own browser tab instead of a blank sandboxed window. Every other app keeps its sandboxed window, and with the
// boundary off nothing changes. Checked in real Chromium against the real shell image and File Browser v2.63.23 (wizard-os#942).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';

const read = p => withShellParts(withWebParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8')));
const ORIGIN = 'https://box.example.ts.net';
const SANDBOX = 'allow-scripts allow-forms allow-downloads';
const sliceFn = (src, start, end = '\n  }\n') => { const i = src.indexOf(start); assert.ok(i >= 0, start); const j = src.indexOf(end, i); assert.ok(j > i, start); return src.slice(i, j + end.length); };

function boundary(on = true) {
  const g = { setTimeout, clearTimeout, crypto: globalThis.crypto, JSON, console, Promise, Object, String, Map, Set };
  g.window = g; g.top = g; g.URL = URL; g.location = { href: ORIGIN + '/wizard-os-home/', origin: ORIGIN };
  g.WizShellBoundary = on ? { on: true } : undefined;
  g.localStorage = { getItem: () => null };
  g.addEventListener = () => {}; g.removeEventListener = () => {}; g.document = { activeElement: null };
  vm.createContext(g); vm.runInContext(read('web/core/browser-boundary.js'), g);
  return g.WizBrowserBoundary;
}

const FILES = { id: 'files', name: 'Files', url: '/files/' }, NOTES = { id: 'notes', name: 'Notes', url: '/notes/' };
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function render(B, which, app) {
  const window = { WizBrowserBoundary: B, WosOwnViews: null, WizReach: {} };
  const ctx = vm.createContext({ window, esc, ico: () => '', MOD: '⌥', listW: () => 300, appOf: () => app, APP: app });
  if (which === 'phone') vm.runInContext(sliceFn(read('web/app-frame.js'), '  function renderFrameCore(w, a) {') + '\nthis.html = w => renderFrameCore(w, APP);', ctx);
  else vm.runInContext(sliceFn(read('web/desktop/desktop-resize.js'), '  function bodyHtml(w) {') + '\nthis.html = bodyHtml;', ctx);
  return ctx.html({ app: 'frame', appId: app.id, url: app.url });
}

test('ownTab: only Files at its own path, only with the boundary on', () => {
  const B = boundary();
  assert.equal(B.ownTab('files', '/files/'), true);
  assert.equal(B.ownTab('files', '/files/files/Documents/'), true, 'a page inside Files');
  assert.equal(B.ownTab('files'), true, 'no url: its own home');
  assert.equal(B.ownTab('files', '/notes/'), false, 'an app called files somewhere else is not Files');
  assert.equal(B.ownTab('files', 'https://elsewhere.example/files/'), false, 'never another site');
  assert.equal(B.ownTab('notes', '/notes/'), false, 'every other app keeps its sandboxed window');
  for (const id of ['constructor', '__proto__', 'hasOwnProperty', '', null, undefined]) assert.equal(B.ownTab(id, '/files/'), false, String(id));
  assert.equal(boundary(false), undefined, 'boundary off: nothing is defined, so every window is as before');
});

for (const which of ['phone', 'desktop']) {
  test(`${which}: with the boundary on Files gets an Open Files card (its own tab), not a blank sandboxed window`, () => {
    const html = render(boundary(), which, FILES);
    assert.doesNotMatch(html, /<iframe/, 'no sandboxed frame File Browser would stay blank in');
    assert.match(html, /Files opens in its own tab/);
    const a = /<a [^>]*>/.exec(html)[0];
    assert.match(a, /href="\/files\/"/); assert.match(a, /target="_blank"/); assert.match(a, /rel="noopener"/);
  });
  test(`${which}: every other app keeps its sandboxed window; with the boundary off Files is framed as before`, () => {
    const notes = render(boundary(), which, NOTES);
    assert.match(/<iframe [^>]*>/.exec(notes)[0], new RegExp(`sandbox="${SANDBOX}"`));
    assert.doesNotMatch(notes, /data-own-tab/);
    const off = render(undefined, which, FILES), tag = /<iframe [^>]*>/.exec(off)[0];
    assert.match(tag, /src="\/files\/"/); assert.doesNotMatch(tag, /sandbox=/);
    assert.doesNotMatch(off, /data-own-tab/);
  });
}

test('pinned Files (single-app session) opens Files itself under the boundary instead of a sandboxed frame', () => {
  const src = read('web/core/single-app-session.js');
  const i = src.indexOf('ownTab?.('), j = src.indexOf("frame = document.createElement('iframe')");
  assert.ok(i > 0 && i < j, 'checked before any app frame is made');
  assert.match(src.slice(i, j), /location\.replace\(next\.url\)/);
});
