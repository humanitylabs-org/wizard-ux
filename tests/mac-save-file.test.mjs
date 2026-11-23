// Save in the media viewer on Wizard for Mac (try-wizard#139): the app writes the file itself and the toast is honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const kit = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const start = kit.indexOf('  const macShell = () =>'), end = kit.indexOf('  /* ================= media viewer', start);
assert.ok(start > 0 && end > start, 'saveFile block found');

function load({ mac = true, caps = ['app.', 'meeting.', 'files.'], answer = { status: 'saved', name: 'Photo.jpg' }, top = true } = {}) {
  const calls = [], clicks = [];
  const bridge = { call: async (method, params) => { calls.push([method, params]); if (method === 'app.info') return { capabilities: caps }; if (method === 'files.save') return answer; throw new Error('unknown'); } };
  const loaded = [];
  const window = { WizCore: { bridge }, webkit: mac ? { messageHandlers: { wizardNative: { postMessage() {} } } } : undefined,
    addEventListener: (type, fn) => type === 'DOMContentLoaded' && loaded.push(fn) };
  window.top = top ? window : {};
  const ctx = {
    window, native: () => null, appDownloads: () => false, download: href => clicks.push(href), shareFileOpen: async () => 'opened',
    ownAddress: href => (/^\/[^/]/.test(href) ? 'https://box.example' + href : ''),
    asFile: async item => ({ name: item.name, type: 'image/jpeg' }), b64: async () => 'AAEC',
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, setTimeout: () => 0,
    document: { createElement: () => ({ click() { clicks.push(this.href); }, remove() {} }), body: { appendChild() {} } },
  };
  vm.runInNewContext(kit.slice(start, end) + '\nthis.saveFile = saveFile; this.macSaver = macSaver;', ctx);
  return { saveFile: ctx.saveFile, macSaver: ctx.macSaver, calls, clicks, loaded };
}

test('Mac app with files.save: the app saves the photo and the toast says where', async () => {
  const { saveFile, calls, clicks } = load();
  assert.equal(await saveFile({ url: '/messenger/api/unified/media/1', name: 'Photo.jpg' }), 'saved-downloads');
  assert.deepEqual(calls.map(c => c[0]), ['app.info', 'files.save']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])), { data: 'AAEC', name: 'Photo.jpg', mime: 'image/jpeg' });
  assert.equal(clicks.length, 0, 'no blob download that the app would drop');
  assert.match(kit, /'saved-downloads': 'Saved to Downloads'/);
});

test('a failed native save says it could not save, never Saved', async () => {
  const { saveFile } = load({ answer: { status: 'failed', error: 'disk full' } });
  await assert.rejects(saveFile({ url: '/m/1', name: 'Photo.jpg' }), /disk full/);
  assert.match(kit, /catch \(_\) \{ K\.notify\('!', 'Couldn’t save this file'\)/);
  assert.match(kit, /if \(macShell\(\)\) throw e;/, 'no silent address download on the Mac after a failed save');
});

test('an older Mac app without files. keeps the download path but makes no false Saved claim', async () => {
  const { saveFile, calls, clicks } = load({ caps: ['app.', 'meeting.'] });
  assert.equal(await saveFile({ url: '/m/1', name: 'Photo.jpg' }), 'downloading');
  assert.deepEqual(calls.map(c => c[0]), ['app.info']);
  assert.equal(clicks.length, 1);
});

test('browsers and app frames keep the plain download and its Saved toast', async () => {
  for (const opts of [{ mac: false }, { top: false }]) {
    const { saveFile, calls, clicks } = load(opts);
    assert.equal(await saveFile({ url: '/m/1', name: 'Photo.jpg' }), 'saved');
    assert.equal(calls.length, 0);
    assert.equal(clicks.length, 1);
  }
});

// wizard-agent-service issue 586: on Wizard for Mac 0.8.2 a .md file card's Download did nothing. That app has no
// files.save and drops a download that starts after an await, so once the viewer knows that, Save downloads the
// Wizard's own file from the tap itself (synchronously), with no fetch first.
test('an older Mac app, once known: Save downloads the own file from the tap, before any wait', async () => {
  const { saveFile, macSaver, calls, clicks } = load({ caps: ['app.', 'meeting.'] });
  await macSaver(); // the viewer asks when it opens
  const pending = saveFile({ url: '/wizard/attachments/0123456789abcdef0123456789abcdef', name: 'wizardos-lite-installer.md' });
  assert.deepEqual(clicks, ['https://box.example/wizard/attachments/0123456789abcdef0123456789abcdef'], 'download started synchronously in the tap');
  assert.equal(await pending, 'downloading');
  assert.deepEqual(calls.map(c => c[0]), ['app.info'], 'no files.save and no second app.info');
});

test('an older Mac app: blob or foreign addresses keep the fetch-then-save path', async () => {
  const { saveFile, macSaver, clicks } = load({ caps: ['app.'] });
  await macSaver();
  assert.equal(await saveFile({ url: 'blob:x', name: 'a.md' }), 'downloading');
  assert.deepEqual(clicks, ['blob:x']);
});

test('a Mac app with files.save is not changed by the early answer', async () => {
  const { saveFile, macSaver, calls, clicks } = load();
  await macSaver();
  assert.equal(await saveFile({ url: '/wizard/attachments/1', name: 'notes.md' }), 'saved-downloads');
  assert.deepEqual(calls.map(c => c[0]), ['app.info', 'files.save']);
  assert.equal(clicks.length, 0);
});

test('the viewer asks the Mac app before a Save tap', () => {
  assert.match(kit, /macSaver\(\); \/\/ ask the Mac app now[^\n]*\n\s*dropPdf\(\);/);
});

test('an older Mac app: a file card ⤓ tapped before any viewer opened also downloads from the tap', async () => {
  const { saveFile, calls, clicks, loaded } = load({ caps: ['app.'] });
  assert.equal(loaded.length, 1, 'the Mac shell asks the app once the page has loaded');
  loaded[0]();
  await new Promise(r => setImmediate(r));
  const pending = saveFile({ url: '/wizard/attachments/abc', name: 'notes.md' });
  assert.deepEqual(clicks, ['https://box.example/wizard/attachments/abc']);
  assert.equal(await pending, 'downloading');
  assert.deepEqual(calls.map(c => c[0]), ['app.info']);
});

test('browsers never ask app.info on load', () => {
  for (const opts of [{ mac: false }, { top: false }]) assert.equal(load(opts).loaded.length, 0);
});
