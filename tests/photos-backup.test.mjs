import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { manifest } from './fixtures/r8C-manifest.mjs';
const read = p => withShellParts(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const relaySrc = read('web/core/photos-relay.js');

/* Photos is its own optional app (hosted at /photos/). The shell draws no Photos UI: it only relays the app frame's
 * calls to the Android backup worker over window.wizardPhotosPort, and Settings has no Photos row. */

/** A shell window with app iframes and a fake native port. */
function shell({ port = null, frames = [] } = {}) {
  const listeners = {}, posted = [];
  const mkWin = path => ({ location: { pathname: path }, got: [], postMessage(m, o) { this.got.push({ m: JSON.parse(JSON.stringify(m)), o }); } });
  const iframes = frames.map(p => ({ contentWindow: mkWin(p) }));
  const ctx = { console, Map, Set, JSON, String, Array, Object, Error,
    location: { origin: 'https://box.example' },
    setTimeout: () => 1, clearTimeout: () => {},
    document: { querySelectorAll: sel => sel === 'iframe.appframe, iframe[data-own-app]' ? iframes : [] },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); } };
  ctx.window = ctx;
  if (port) ctx.wizardPhotosPort = port;
  vm.runInNewContext(relaySrc, ctx);
  const fire = (t, ev) => (listeners[t] || []).forEach(fn => fn(ev));
  return { ctx, iframes, fire, posted };
}
function nativePort() {
  const p = { sent: [], handler: null, postMessage(d) { this.sent.push(d); }, addEventListener(t, fn) { this.handler = fn; } };
  p.answer = m => p.handler({ data: JSON.stringify(m) });
  return p;
}
const call = (s, win, method, params, origin = 'https://box.example') =>
  s.fire('message', { source: win, origin, data: { type: 'wizard-os:photos', id: 'a1', method, params } });

test('Settings holds no Photos row: no feature, no page mapping, no styles, no module', () => {
  const settings = read('web/core/settings.js');
  assert.doesNotMatch(settings, /photos/i);
  assert.doesNotMatch(read('web/core/settings.css'), /\.ph-|photos/i);
  assert.equal(fs.existsSync(new URL('../web/core/photos-settings.js', import.meta.url)), false);
  // both shells load the relay (and no Photos settings module), as the browser reads the page
  for (const f of ['web/index.html', 'web/desktop.html']) {
    const h = read(f), d = createDocument(); d.documentElement.innerHTML = h.slice(h.indexOf('<head'), h.lastIndexOf('</html>'));
    const src = d.querySelectorAll('script[src]').map(x => x.getAttribute('src'));
    assert.ok(src.includes('core/photos-relay.js'), f); assert.ok(!src.some(x => /photos-settings/.test(x)), f);
  }
});

test('relay forwards an allowed call from the Photos app frame and returns the answer to that frame', () => {
  const port = nativePort();
  const s = shell({ port, frames: ['/photos/', '/android-apps/'] });
  const photos = s.iframes[0].contentWindow;
  call(s, photos, 'setEnabled', { on: true });
  assert.equal(port.sent.length, 1);
  const out = JSON.parse(port.sent[0]);
  assert.deepEqual({ v: out.v, method: out.method, params: out.params }, { v: 1, method: 'setEnabled', params: { on: true } });
  port.answer({ v: 1, id: out.id, ok: true, result: { v: 1, enabled: true } });
  assert.deepEqual(photos.got.at(-1).m, { type: 'wizard-os:photos', id: 'a1', ok: true, result: { v: 1, enabled: true } });
  assert.equal(photos.got.at(-1).o, 'https://box.example');
  // Native status pushes reach Photos frames only.
  port.answer({ v: 1, type: 'status', status: { v: 1, enabled: true, done: 3, total: 9 } });
  assert.deepEqual(photos.got.at(-1).m, { type: 'wizard-os:photos-push', push: { type: 'status', status: { v: 1, enabled: true, done: 3, total: 9 } } });
  assert.equal(s.iframes[1].contentWindow.got.length, 0);
});

test('relay refuses other frames, other origins and unknown methods; no port answers no-bridge', () => {
  const port = nativePort();
  const s = shell({ port, frames: ['/photos/', '/android-apps/'] });
  const [photos, other] = s.iframes.map(f => f.contentWindow);
  call(s, other, 'status'); call(s, photos, 'status', {}, 'https://evil.example');
  call(s, { location: { pathname: '/photos/' }, postMessage() {} }, 'status'); // not one of the shell's frames
  assert.equal(port.sent.length, 0);
  assert.equal(other.got.length, 0);
  call(s, photos, 'deleteEverything');
  assert.equal(port.sent.length, 0);
  assert.deepEqual(photos.got.at(-1).m, { type: 'wizard-os:photos', id: 'a1', ok: false, error: 'unknown method' });
  const bare = shell({ frames: ['/photos/'] }); const w = bare.iframes[0].contentWindow;
  call(bare, w, 'status');
  assert.deepEqual(w.got.at(-1).m, { type: 'wizard-os:photos', id: 'a1', ok: false, error: 'no-bridge' });
});

test('relay: older apps get the one legacy word; native resume reaches the app', () => {
  const port = nativePort();
  const s = shell({ port, frames: ['/photos/'] }); const w = s.iframes[0].contentWindow;
  call(s, w, 'open');
  assert.equal(port.sent.at(-1), 'open', 'older apps understand exactly this word');
  assert.equal(w.got.at(-1).m.ok, true);
  s.fire('wos-native-resume', {});
  assert.deepEqual(w.got.at(-1).m, { type: 'wizard-os:photos-push', push: { type: 'resume' } });
});

test('relay accepts desktop window frames as well as phone app frames', () => {
  // the desktop window's real frame markup (desktop-resize.js bodyHtml) on a page: the relay finds it with its own selector
  const D = runRecording(`${block(read('web/desktop/desktop-resize.js'), '  function bodyHtml(w) {')}\nthis.bodyHtml = bodyHtml;`, { appOf: () => ({ id: 'photos', name: 'Photos', url: '/photos/' }), esc: String, window: {} });
  const page = createDocument(); page.body.innerHTML = `<div class="win">${D.bodyHtml({ id: 'w1', app: 'frame', appId: 'photos' })}</div><div id="ph"><iframe class="appframe" src="/photos/"></iframe></div>`;
  const found = [], q = page.querySelectorAll.bind(page);
  const desk = shell({ frames: [] });
  desk.ctx.document.querySelectorAll = sel => { const list = q(sel); found.push(...list.map(f => f.getAttribute('src'))); return list.map(f => ({ contentWindow: { location: { pathname: f.getAttribute('src') } } })); };
  desk.fire('message', { source: { location: { pathname: '/x/' } }, origin: 'https://box.example', data: { type: 'wizard-os:photos', id: 'a1', method: 'status' } });
  assert.deepEqual(found, ['/photos/', '/photos/'], 'both the desktop window frame and the phone app frame are shell frames');
  const s = shell({ frames: ['/photos/'] }); const w = s.iframes[0].contentWindow;
  call(s, w, 'status');
  assert.deepEqual(w.got.at(-1).m, { type: 'wizard-os:photos', id: 'a1', ok: false, error: 'no-bridge' }, 'desktop gets the honest no-bridge answer');
});

test('relay method list matches the native allowlist (plus legacy open)', () => {
  // the Java allowlist (data), against what the real relay forwards when the Photos frame asks
  const policy = read('android/app/src/main/java/ai/wizards/os/photos/PhotosBridgePolicy.java');
  const nativeMethods = policy.match(/METHODS = [^;]*asList\(\s*([^)]*)\)/s)[1].match(/"(\w+)"/g).map(x => x.slice(1, -1));
  const forwards = method => { const port = nativePort(), sh = shell({ port, frames: ['/photos/'] }); call(sh, sh.iframes[0].contentWindow, method, {}); return port.sent.length === 1; };
  for (const m of nativeMethods) assert.ok(forwards(m), `${m} reaches the native bridge`);
  assert.ok(forwards('open'), 'and the legacy open');
  for (const m of ['deleteEverything', 'exportKeys', 'constructor', '__proto__']) assert.ok(!forwards(m), `${m} is refused`);
});

test('old Settings deep links (backup notification, native screen) open the Photos app instead', () => {
  // the phone's real hand-off (window.__wosHandoff), with and without the Photos app installed
  const app = read('web/app.js'), at = app.indexOf('  window.__wosHandoff = h => {');
  const handoff = (h, installed) => {
    const ctx = runRecording(`${block(app, '  window.__wosHandoff = h => {', at).replace(/^\s*window\.__wosHandoff = /, 'this.handoff = ')};`,
      { window: { WizOpenApp: id => (ctx0.opened.push(id), installed), WosSettings: { features: [{ id: 'photos-backup' }, { id: 'look' }] } }, APP: {}, opened: [] });
    const ctx0 = ctx; ctx.opened = [];
    ctx.handoff(h); return { opened: ctx.opened, calls: ctx.calls.map(c => c[0]) };
  };
  for (const focus of ['photos-backup', 'photos']) {
    const r = handoff({ action: 'settings', focus }, true);
    assert.deepEqual(r.opened, ['photos'], focus); assert.ok(!r.calls.includes('openSettings'), `${focus}: never Settings`);
  }
  const missing = handoff({ action: 'settings', focus: 'photos-backup' }, false);
  assert.ok(missing.calls.includes('toast') && !missing.calls.includes('openSettings'), 'not installed: says where it lives');
  assert.ok(handoff({ action: 'settings', focus: 'look' }, true).calls.includes('openSettings'), 'other Settings links still open Settings');
});

// static-rule: AndroidManifest.xml is declarative config: the exported singleTop activity and its sign-in callback link
test('native: Photos is its own singleTop activity and owns the photos sign-in callback link', () => {
  const m = manifest();
  const a = m.find(e => e.tag === 'activity' && e.attrs['android:name'] === '.photos.PhotosActivity');
  assert.equal(a?.attrs['android:exported'], 'true');
  assert.equal(a?.attrs['android:launchMode'], 'singleTop');
  assert.ok(m.some(e => e.tag === 'data' && e.attrs['android:host'] === 'photos' && e.attrs['android:path'] === '/oauth-callback'));
});
// The bridge's Java wiring and the web openSettings(focus) handoff: the handoff runs above (Settings link tests); the Java
// side is not run here (wizard-ux issue 1674: no JDK in this suite).
// Not run here (wizard-ux issue 1674): this pinned Java/Swift source text and no JDK runs it in this suite. Photos Back handling in PhotosActivity.
