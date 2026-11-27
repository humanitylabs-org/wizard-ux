// Wizard for Mac in Settings › About & updates (wizard-ux issue 1624, on for everyone). Runs the real
// core/os-updates.js with a stand-in Mac bridge (WizCore.bridge) and checks what the group draws for each phase of the
// app's `updates.status` (try-wizard#126 schema 1), what each button calls, and that nothing happens off the Mac. The browser proof with the real shell is tests/qa-mac-app-updates.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/core/os-updates.js', import.meta.url), 'utf8');
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const OS = { mode: 'ask', chosen: true, installed: '0.3.15', latest: '0.3.15', update_available: false, unpinned: false, checked: true, installing: false };
const st = (phase, extra = {}) => ({ schema: 1, installed: { version: '0.8.1', build: '312' }, phase, latest: null, progress: null, checkedAt: null, waitingFor: null, manual: null, error: null, channel: null, ...extra });

async function load({ mac = true, status = st('current'), answer } = {}) {
  const calls = [], registered = [], listeners = {};
  let refreshes = 0;
  const fetch = async () => ({ ok: true, status: 200, json: async () => OS });
  const root = { dataset: { tweaks: 'wizard/other' } };
  const bridge = {
    native: () => (mac ? 'mac' : ''),
    call: async (method, params) => {
      calls.push(method);
      if (answer) return answer(method, params);
      if (method === 'updates.status') return state.status;
      throw new Error('unknown method');
    },
  };
  const state = { status };
  const window = {
    WizCore: { bridge }, WosSettings: { register: f => registered.push(f), refresh: () => refreshes++ },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    ...(mac ? { webkit: { messageHandlers: { wizardNative: {} } } } : {}),
  };
  const document = { currentScript: { src: 'https://box.ts.net/wizard-os-home/core/os-updates.js' }, documentElement: root, hidden: false, querySelector: () => null, addEventListener() {} };
  const setInterval = () => ({ unref() {} });
  new Function('window', 'document', 'fetch', 'location', 'setInterval', src)(window, document, fetch, { href: 'https://box.ts.net/wizard-os-home/' }, setInterval);
  await tick();
  const f = registered.find(x => x.id === 'mac-app-updates');
  const push = d => { for (const fn of listeners['wizard:app-update'] || []) fn({ detail: d }); };
  const shown = async () => { if (!f) return ''; if (!f.available()) { await tick(); if (!f.available()) return ''; } return f.html(); };
  const btn = k => ({ closest: s => (s === '[data-mau]' ? { dataset: { mau: k } } : null) });
  return { f, calls, registered, push, shown, btn, state, root, refreshes: () => refreshes };
}
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('only inside Wizard for Mac: a browser or the phone never registers the group or calls the bridge', async () => {
  const { registered, calls } = await load({ mac: false });
  assert.deepEqual(registered.map(f => f.id), ['updates']);
  assert.deepEqual(calls, []);
});

test('no switch: inside Wizard for Mac the group shows with no tweak chosen', async () => {
  const m = await load();
  assert.equal(m.f.page, 'about');
  assert.match(text(await m.shown()), /^Wizard for Mac 0\.8\.1 \(312\)/);
  assert.deepEqual(m.calls, ['updates.status']);
});

test('an older Mac app without updates.* (the call rejects): no group, asked once a minute at most', async () => {
  const m = await load({ answer: () => { throw new Error('unknown method: updates.status'); } });
  assert.equal(await m.shown(), '');
  m.f.available(); m.f.available(); await tick();
  assert.deepEqual(m.calls, ['updates.status']);
});

test('up to date: version and build, checked time, hint and Check for updates; Checking… while it checks', async () => {
  let checked = 0;
  const m = await load({ status: st('current', { checkedAt: Date.now() - 5 * 60e3 }), answer: (method) => {
    if (method === 'updates.status') return m.state.status;
    if (method === 'updates.check') { checked++; return { ...m.state.status, phase: 'checking' }; }
  } });
  const h = await m.shown();
  assert.equal(text(h), 'Wizard for Mac 0.8.1 (312) Up to date · checked 5 min ago Wizard for Mac looks for a new version every hour and downloads it by itself. It restarts only when you say so, never while you’re recording. Check for updates');
  assert.match(h, /<div class="st-row static osu-head" data-settings-version="mac">/);
  assert.match(h, /<button type="button" class="st-wide wz-button secondary" data-mau="check">Check for updates<\/button>/);
  assert.equal(m.f.act({}, m.btn('check')), true); await tick();
  assert.equal(checked, 1);
  assert.match(m.f.html(), /Checking…[^]*data-mau="check" disabled aria-busy="true">Checking…<\/button>/);
  m.push(st('current', { checkedAt: Date.now() }));
  assert.match(text(m.f.html()), /Up to date · checked just now/);
  assert.equal(m.f.act({}, m.btn('install')), true, 'a button the card does not show does nothing');
  assert.deepEqual(m.calls.filter(c => c !== 'updates.status'), ['updates.check']);
});

test('downloading and verifying: the new version with the percentage, no button', async () => {
  const m = await load({ status: st('downloading', { latest: { version: '0.8.2', build: '313' }, progress: 0.42 }) });
  const h = await m.shown();
  assert.equal(text(h).split(' Wizard for Mac looks')[0], 'Wizard for Mac 0.8.2 Downloading · 42%. It installs only when you say so. Wizard for Mac 0.8.1 (312) Installed on this Mac');
  assert.match(h, /<div class="osu-card" data-osu-card="mac-downloading" data-osu-stack role="status">/);
  assert.doesNotMatch(h, /<button/);
  m.push({ ...m.state.status, phase: 'verifying', progress: 1 });
  assert.match(text(m.f.html()), /Wizard for Mac 0\.8\.2 Checking the download · 100%\. It installs only when you say so\./);
});

test('ready: Update and restart calls updates.install; a refusal is a toast and the card stays', async () => {
  const latest = { version: '0.8.2', build: '313' };
  let reply = { started: false, reason: 'Recording is on. Update after it ends.' };
  const m = await load({ status: st('ready', { latest }), answer: (method) => method === 'updates.install' ? reply : m.state.status });
  const h = await m.shown();
  assert.match(text(h), /^Wizard for Mac 0\.8\.2 is ready Restart to finish\. Takes about a minute; chats, files and apps stay as they are\. Update and restart Wizard for Mac 0\.8\.1 \(312\) Installed on this Mac/);
  const toasts = [];
  assert.equal(m.f.act({ toast: (...a) => toasts.push(a) }, m.btn('install')), true);
  assert.match(m.f.html(), /data-mau="install" disabled>Restarting…</);
  await tick(8);
  assert.deepEqual(toasts, [['!', 'Recording is on. Update after it ends.', 3200]]);
  assert.match(m.f.html(), /data-mau="install">Update and restart</, 'the card stays');
  for (const [w, line] of [['recording', 'It can restart once the recording ends.'], ['work', 'It can restart once Wizard finishes what it’s working on.']]) {
    m.push(st('ready', { latest, waitingFor: w }));
    const t = m.f.html();
    assert.ok(text(t).includes(`Wizard for Mac 0.8.2 is ready ${line}`), t);
    assert.doesNotMatch(t, /class="osu-go"/, 'a waiting card never keeps a disabled button');
  }
  m.push(st('installing', { latest }));
  assert.match(text(m.f.html()), /^Updating Wizard for Mac Wizard restarts in a moment\./);
});

test('urgent (try-wizard#128): a critical release says Important update and asks for it soon; no field, no change', async () => {
  const latest = { version: '0.8.2', build: '313' };
  const m = await load({ status: st('ready', { latest, urgent: true }) });
  const h = await m.shown();
  assert.match(text(h), /^Important update: Wizard for Mac 0\.8\.2 is ready Restart to finish\. Takes about a minute; chats, files and apps stay as they are\. It fixes something that matters, so install it soon\. Update and restart/);
  assert.match(h, /data-osu-card="mac-ready" data-osu-urgent data-osu-stack/);
  m.push(st('ready', { latest, urgent: true, waitingFor: 'recording' }));
  assert.match(text(m.f.html()), /^Important update: Wizard for Mac 0\.8\.2 is ready It can restart once the recording ends\./);
  m.push(st('downloading', { latest, urgent: true, progress: 0.5 }));
  assert.match(text(m.f.html()), /^Important update: Wizard for Mac 0\.8\.2 Downloading · 50%/);
  m.push(st('failed', { urgent: true, error: 'no network' }));
  assert.doesNotMatch(m.f.html(), /Important update|data-osu-urgent/);
  for (const urgent of [undefined, false, 'yes']) {
    const plain = await load({ status: st('ready', { latest, ...(urgent === undefined ? {} : { urgent }) }) });
    const p = await plain.shown();
    assert.doesNotMatch(p, /Important update|data-osu-urgent/, String(urgent));
    assert.match(text(p), /^Wizard for Mac 0\.8\.2 is ready Restart to finish\. Takes about a minute; chats, files and apps stay as they are\. Update and restart/);
  }
});

test('needs a new download: Download calls updates.download, only for Wizard’s own download pages', async () => {
  const m = await load({ status: st('manual', { latest: { version: '0.9.0', build: '400' }, manual: { url: 'https://downloads.aiwizards.com/mac/Wizard-0.9.0.dmg' } }) });
  const h = await m.shown();
  assert.match(text(h), /^Wizard for Mac 0\.9\.0 needs a new download This version can’t install itself\. Download it and drag it to Applications\. Your Wizard, chats and files stay\. Download/);
  m.f.act({}, m.btn('download')); await tick();
  assert.deepEqual(m.calls.filter(c => c === 'updates.download'), ['updates.download']);
  for (const url of ['http://www.aiwizards.com/downloads', 'https://aiwizards.com.evil.example/', 'https://user@www.aiwizards.com/', 'https://www.aiwizards.com:8443/']) {
    m.push(st('manual', { latest: { version: '0.9.0', build: '400' }, manual: { url } }));
    const toasts = [];
    m.f.act({ toast: (...a) => toasts.push(a) }, m.btn('download')); await tick();
    assert.equal(m.calls.filter(c => c === 'updates.download').length, 1, url);
    assert.equal(toasts.length, 1);
  }
});

test('failed: the app’s own words (else the default), Try again calls updates.check', async () => {
  const m = await load({ status: st('failed', { error: 'The network is offline.' }), answer: (method) => method === 'updates.check' ? { ...m.state.status, phase: 'checking' } : m.state.status });
  assert.match(text(await m.shown()), /^Couldn’t update Wizard for Mac The network is offline\. Try again Wizard for Mac 0\.8\.1 \(312\) Installed on this Mac/);
  m.push(st('failed'));
  assert.match(text(m.f.html()), /^Couldn’t update Wizard for Mac The version you have keeps working\./);
  m.f.act({}, m.btn('check')); await tick();
  assert.ok(m.calls.includes('updates.check'));
});

test('live: a read that lands after a newer event never puts the old status back; an unchanged event redraws nothing', async () => {
  let release;
  const m = await load({ answer: (method) => method === 'updates.status' ? new Promise(r => { release = r; }) : null });
  assert.equal(m.f.available(), false); await tick();
  assert.equal(typeof release, 'function', 'the read is on its way');
  m.push(st('downloading', { latest: { version: '0.8.2', build: '313' }, progress: 0.1 }));
  release(st('current')); await tick();
  assert.equal(m.f.available(), true);
  assert.match(text(m.f.html()), /Downloading · 10%/, 'the event is newer than the read');
  const before = m.refreshes();
  m.push(st('downloading', { latest: { version: '0.8.2', build: '313' }, progress: 0.1 }));
  assert.equal(m.refreshes(), before, 'the same status again redraws nothing');
  m.push('not json'); m.push({ phase: 'nope' }); m.push(null);
  assert.match(text(m.f.html()), /Downloading · 10%/, 'anything that is not the app’s status is ignored');
  m.push(JSON.stringify(st('downloading', { latest: { version: '0.8.2', build: '313' }, progress: 0.5 })));
  assert.match(text(m.f.html()), /Downloading · 50%/, 'a JSON string detail is read too');
});
