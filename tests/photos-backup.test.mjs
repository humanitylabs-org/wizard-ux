import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
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
    document: { querySelectorAll: sel => sel === 'iframe.appframe' ? iframes : [] },
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
  for (const f of ['web/index.html', 'web/desktop.html']) {
    const h = read(f);
    assert.doesNotMatch(h, /photos-settings\.js/, f);
    assert.match(h, /<script src="core\/photos-relay\.js"><\/script>/, f);
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

test('relay method list matches the native allowlist (plus legacy open)', () => {
  const policy = read('android/app/src/main/java/ai/wizards/os/photos/PhotosBridgePolicy.java');
  const nativeMethods = policy.match(/METHODS = [^;]*asList\(\s*([^)]*)\)/s)[1].match(/"(\w+)"/g).map(x => x.slice(1, -1));
  const relay = relaySrc.match(/new Set\(\[([^\]]*)\]\)/)[1].match(/'(\w+)'/g).map(x => x.slice(1, -1));
  assert.deepEqual(relay.filter(m => m !== 'open').sort(), nativeMethods.sort());
});

test('old Settings deep links (backup notification, native screen) open the Photos app instead', () => {
  const app = read('web/app.js');
  assert.match(app, /h\.action === 'settings' && \(h\.focus === 'photos-backup' \|\| h\.focus === 'photos'\)\) \{ if \(!window\.WizOpenApp\?\.\('photos'\)\)/);
  assert.ok(app.indexOf("h.focus === 'photos-backup'") < app.indexOf("if (h.action === 'unsent' || h.action === 'settings')"));
});

test('native: bridge keeps credentials and sign-in on the device; legacy open and the deep link stay', () => {
  const b = read('android/app/src/main/java/ai/wizards/os/photos/PhotosBridge.java');
  assert.match(b, /PhotosBridgePolicy\.LEGACY_OPEN\.equals\(data\)\) \{ activity\.startActivity\(new Intent\(activity, PhotosActivity\.class\)\)/);
  assert.match(b, /!isMainFrame \|\| !AppState\.primaryOrigin\(activity\)\.equals\(originOf\(sourceOrigin\)\) \|\| !shellOnTop\(\)/);
  assert.match(b, /new PhotoAuth\(activity\)\.start\(server\)/);
  assert.doesNotMatch(b, /apiKey\(|secret\("credentials"\)|getString\("key"\)/);
  const main = read('android/app/src/main/java/ai/wizards/os/MainActivity.java');
  assert.match(main, /PhotosBridge\.install\(this, web\)/);
  assert.doesNotMatch(main, /installPhotosPort/);
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /\.photos\.PhotosActivity" android:exported="true" android:launchMode="singleTop"/);
  assert.match(manifest, /android:host="photos" android:path="\/oauth-callback"/);
  const activity = read('android/app/src/main/java/ai/wizards/os/photos/PhotosActivity.java');
  assert.match(activity, /if\(web\) \{ backToWeb\(\); return; \}/);
  assert.match(activity, /putExtra\(MainActivity\.EXTRA_SETTINGS_FOCUS,"photos-backup"\)/);
  assert.match(read('web/app.js'), /openSettings\(h\.action === 'unsent' \|\| \(typeof h\.focus === 'string' && window\.WosSettings\?\.features\.some\(f => f\.id === h\.focus\)/);
});

test('Photos child Back explicitly restores the Wizard parent, album Back stays nested', () => {
  const s = read('android/app/src/main/java/ai/wizards/os/photos/PhotosActivity.java');
  assert.match(s, /if\(albums\) \{ show\(\); return; \}/);
  assert.match(s, /new Intent\(this,MainActivity.class\).setAction\(MainActivity.ACTION_SETTINGS\)/);
  assert.match(s, /registerOnBackInvokedCallback/);
  assert.doesNotMatch(s, /moveTaskToBack|super.onBackPressed/);
});
