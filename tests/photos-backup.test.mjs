import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const settingsSrc = read('web/core/settings.js'), photosSrc = read('web/core/photos-settings.js');

function sandbox(port) {
  const timers = [];
  const ctx = { console, Map, Set, Date, String, JSON, Promise, Error, Object, queueMicrotask, navigator: { userAgent: 'Android fixture WizardOS-Android/1' }, location: { host: 'fixture.invalid' },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {}, CSS: { escape: String }, document: { activeElement: null }, requestAnimationFrame: () => {} };
  ctx.window = ctx; ctx.WizCore = {}; ctx.WizBrand = { html: 'W' };
  if (port) ctx.wizardPhotosPort = port;
  vm.runInNewContext(settingsSrc, ctx);
  vm.runInNewContext(photosSrc, ctx);
  return { ctx, timers };
}
/** A fake native side speaking protocol v1, mutating its status the way PhotosBridge does. */
function fakeNative(status = {}) {
  const sent = [], st = { v: 1, connected: false, enabled: false, wifi: true, charge: true, server: '', done: 0, total: 0, lastSync: 0, message: '', limited: false, signingIn: false, access: { photos: true, location: true }, needsAccess: false, ...status };
  const port = { listeners: [], addEventListener(type, fn) { this.listeners.push(fn); }, postMessage(data) {
    sent.push(data);
    let m; try { m = JSON.parse(data); } catch (_) { return; }
    const p = m.params || {};
    let result = st;
    if (m.method === 'setEnabled') { if (p.on && !st.connected) st.signingIn = true; else st.enabled = p.on; }
    if (m.method === 'setOption') st[p.key] = p.on;
    if (m.method === 'albums') result = { albums: [{ id: '1', name: 'Camera', selected: true }, { id: '2', name: 'WhatsApp', selected: false }], limited: false };
    if (m.method === 'disconnect') Object.assign(st, { connected: false, enabled: false });
    queueMicrotask(() => this.listeners.forEach(fn => fn({ data: JSON.stringify({ v: 1, id: m.id, ok: true, result: { ...result } }) })));
  } };
  return { port, sent, st };
}
const flush = () => new Promise(r => setImmediate(r));
const last = sent => JSON.parse(sent.at(-1));

test('Photos backup registers once from its own module, on the Phone page, loaded in both shells', () => {
  assert.doesNotMatch(settingsSrc, /id: 'photos-backup'/);
  assert.equal((photosSrc.match(/id: 'photos-backup'/g) || []).length, 1);
  for (const f of ['web/index.html', 'web/desktop.html']) {
    const h = read(f); assert.ok(h.indexOf('core/photos-settings.js') > h.indexOf('core/settings.js'), f);
  }
  const f = sandbox(null).ctx.WosSettings.features.find(f => f.id === 'photos-backup');
  assert.equal(f.page, 'phone');
  assert.match(photosSrc, /available: \(\) => !!port\(\)/);
});

test('client speaks versioned JSON, resolves answers by id and ignores other versions', async () => {
  const { ctx } = sandbox(null), { port, sent } = fakeNative({ connected: true });
  const pushes = [], api = ctx.WosPhotos.client(port, { onStatus: s => pushes.push(s), set: () => 0, clear: () => {} });
  assert.equal((await api.status()).connected, true);
  const m = JSON.parse(sent[0]); assert.deepEqual([m.v, m.method, typeof m.id], [1, 'status', 'string']);
  await api.setOption('wifi', false); assert.deepEqual(JSON.parse(sent[1]).params, { key: 'wifi', on: false });
  await api.setEnabled(true, 'https://photos.example.org'); assert.deepEqual(JSON.parse(sent[2]).params, { on: true, server: 'https://photos.example.org' });
  const before = pushes.length;
  port.listeners[0]({ data: JSON.stringify({ v: 2, type: 'status', status: { enabled: true } }) });
  port.listeners[0]({ data: 'open' });
  assert.equal(pushes.length, before);
  port.listeners[0]({ data: JSON.stringify({ v: 1, type: 'status', status: { v: 1, enabled: true } }) });
  assert.equal(pushes.length, before + 1);
});

test('errors and timeouts reject; the page holds no credential vocabulary', async () => {
  const { ctx } = sandbox(null);
  let timeout; const port = { onmessage: null, postMessage(d) { const m = JSON.parse(d); if (m.method === 'runNow') this.onmessage({ data: JSON.stringify({ v: 1, id: m.id, ok: false, error: 'Turn on backup first' }) }); } };
  const api = ctx.WosPhotos.client(port, { set: fn => { timeout = fn; return 1; }, clear: () => {} });
  await assert.rejects(api.runNow(), /Turn on backup first/);
  const p = api.status(); timeout(); await assert.rejects(p, e => e.timeout === true);
  assert.doesNotMatch(photosSrc, /apiKey|x-api-key|secret|verifier|accessToken/i);
});

test('summary line is brief and true to state', () => {
  const S = sandbox(null).ctx.WosPhotos.summary, now = 10 * 60000;
  assert.equal(S(null), 'Checking…');
  assert.equal(S({ enabled: false, connected: false }), 'Off · turning it on signs you in with your fingerprint');
  assert.equal(S({ enabled: false, connected: true }), 'Off');
  assert.equal(S({ signingIn: true }), 'Confirm with your fingerprint in Wizard Sign-in');
  assert.equal(S({ enabled: true, needsAccess: true }), 'On · waiting for photo access');
  assert.equal(S({ enabled: true, total: 0, lastSync: 0 }, now), 'On · first backup waiting');
  assert.equal(S({ enabled: true, done: 3, total: 9, lastSync: now - 5 * 60000 }, now), 'On · 3 of 9 backed up · last backup 5 min ago');
  assert.equal(S({ enabled: true, done: 9, total: 9, lastSync: now - 3 * 3600000 }, now + 0), 'On · 9 of 9 backed up · last backup 3 h ago');
});

test('page: one flat form, plain-case heading, server field only when nothing is known', () => {
  const H = sandbox(null).ctx.WosPhotos.html;
  const off = H({ mode: 'v1', status: { connected: false, enabled: false, wifi: true, charge: true, server: '' } });
  assert.match(off, /data-ph="enabled" role="switch" aria-checked="false"><span class="ph-tx"><b>Back up photos/);
  assert.match(off, /data-ph-server/);
  assert.doesNotMatch(off, /Disconnect|Back up now|Sign in again/);
  assert.doesNotMatch(H({ mode: 'v1', status: { connected: false, enabled: false, server: 'https://photos.example.org' } }), /data-ph-server/);
  const on = H({ mode: 'v1', status: { connected: true, enabled: true, wifi: false, charge: true, server: 'https://photos.example.org', needsAccess: true, done: 1, total: 2 } });
  assert.match(on, /Allow photo access/);
  assert.match(on, /data-ph="wifi" role="switch" aria-checked="false"/);
  assert.match(on, /Back up now/); assert.match(on, /data-ph="disconnect"/);
  assert.doesNotMatch(on, /class="[^"]*card/);
  assert.match(H({ mode: 'v1', status: { connected: true, enabled: true }, confirmDisconnect: true }), /Disconnect this phone/);
  assert.match(H({ mode: 'v1', status: { connected: true, enabled: true }, albumsOpen: true, albums: { albums: [{ id: '1', name: '<b>x', selected: true }] } }), /role="checkbox" aria-checked="true" data-ph-album="1"><span class="ph-check" aria-hidden="true"><\/span>&lt;b&gt;x/);
  assert.match(H({ mode: 'legacy' }), /data-ph="native"/);
  assert.match(H({ mode: 'v1', status: null }), /Checking…/);
  const css = read('web/core/settings.css'), ph = css.slice(css.indexOf('Settings › Photos backup'));
  assert.match(ph, /h4\.ph-h \{ text-transform: none/);
  assert.doesNotMatch(ph, /uppercase/);
  assert.match(photosSrc, /<h4 class="ph-h">Photos backup<\/h4>/);
});

test('act: the switch signs in when needed, a known server is never replaced, two-tap disconnect', async () => {
  const { ctx } = sandbox(null), { port, sent, st } = fakeNative(), A = ctx.WosPhotos.act;
  const api = ctx.WosPhotos.client(port, { set: () => 0, clear: () => {} });
  const fresh = { status: { ...st } };
  assert.equal(A(fresh, api, 'enabled', { server: '' }), null);
  assert.match(fresh.error, /photo server address/);
  await A(fresh, api, 'enabled', { server: ' https://photos.example.org ' });
  assert.deepEqual(last(sent).params, { on: true, server: 'https://photos.example.org' });
  await A({ status: { ...st, server: 'https://built.example.org' } }, api, 'enabled', { server: 'https://ignored.example.org' });
  assert.deepEqual(last(sent).params, { on: true });
  const conn = { status: { ...st, connected: true, enabled: true, wifi: true, charge: true, server: 'https://built.example.org' } };
  await A(conn, api, 'wifi'); assert.deepEqual(last(sent).params, { key: 'wifi', on: false });
  await A(conn, api, 'charge'); assert.deepEqual(last(sent).params, { key: 'charge', on: false });
  await A(conn, api, 'run'); assert.equal(last(sent).method, 'runNow');
  await A(conn, api, 'signin'); assert.deepEqual([last(sent).method, last(sent).params], ['connect', {}]);
  await A(conn, api, 'permissions'); assert.equal(last(sent).method, 'permissions');
  assert.equal(A(conn, api, 'disconnect'), null); assert.equal(conn.confirmDisconnect, true);
  const n = sent.length; assert.equal(A(conn, api, 'disconnect-no'), null); assert.equal(sent.length, n);
  await A(conn, api, 'disconnect-yes'); assert.equal(last(sent).method, 'disconnect');
  await A(conn, api, 'albums'); assert.equal(conn.albums.albums.length, 2);
  await A(conn, api, 'album', { id: '2' });
  assert.deepEqual([last(sent).method, last(sent).params], ['setAlbums', { ids: ['1', '2'] }]);
  assert.equal(A(conn, api, 'album', { id: 'missing' }), null);
});

test('live: a v1 app gets the web page; an app that never answers falls back to its native screen', async () => {
  const { port } = fakeNative({ connected: true, enabled: true, server: 'https://photos.example.org' });
  const { ctx } = sandbox(port);
  await ctx.WosPhotos.detect(); await flush();
  assert.equal(ctx.WosPhotos.state.mode, 'v1');
  assert.equal(ctx.WosPhotos.state.status.enabled, true);
  const silent = { posted: [], addEventListener() {}, postMessage(d) { this.posted.push(d); } };
  const old = sandbox(silent);
  const pending = old.ctx.WosPhotos.detect();
  old.timers.find(t => t.ms === 1500).fn();
  assert.equal(await pending, 'legacy');
  const root = { innerHTML: '', scrollTop: 0, classList: { add() {} }, dataset: {}, contains: () => false, querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  const view = old.ctx.WosSettings.mount(root, { shell: 'phone' }); view.focus('photos-backup');
  assert.match(root.innerHTML, /data-ph="native"/);
  const el = { dataset: { ph: 'native' }, closest: sel => sel === '[data-settings-feature]' ? { dataset: { settingsFeature: 'photos-backup' } } : sel.includes('[data-ph]') ? el : null };
  assert.equal(view.dispatch(el), true);
  assert.equal(silent.posted.at(-1), 'open', 'older apps understand exactly this word');
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
