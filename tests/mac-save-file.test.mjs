// Save in the media viewer on Wizard for Mac (try-wizard#139): the app writes the file itself and the toast is honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';

const kit = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const start = kit.indexOf('  const macShell = () =>'), end = kit.indexOf('  /* ================= media viewer', start);
assert.ok(start > 0 && end > start, 'saveFile block found');
// the viewer's Save tap (save → saveNow → saveFile) and the notice it gives
const tapStart = kit.indexOf('  const busy = new Set();'), tapEnd = kit.indexOf('  const share = it =>', tapStart);

function load({ mac = true, caps = ['app.', 'meeting.', 'files.'], answer = { status: 'saved', name: 'Photo.jpg' }, top = true } = {}) {
  const calls = [], clicks = [], notes = [];
  const bridge = { call: async (method, params) => { calls.push([method, params]); if (method === 'app.info') return { capabilities: caps }; if (method === 'files.save') return answer; throw new Error('unknown'); } };
  const loaded = [];
  const window = { WizCore: { bridge }, webkit: mac ? { messageHandlers: { wizardNative: { postMessage() {} } } } : undefined,
    addEventListener: (type, fn) => type === 'DOMContentLoaded' && loaded.push(fn) };
  window.top = top ? window : {};
  const ctx = {
    window, native: () => null, appDownloads: () => false, download: href => clicks.push(href), shareFileOpen: async () => 'opened',
    ownAddress: href => (/^\/[^/]/.test(href) ? 'https://box.example' + href : ''),
    asFile: async item => ({ name: item.name, type: 'image/jpeg' }), b64: async () => 'AAEC',
    URL: class extends URL { static createObjectURL() { return 'blob:x'; } static revokeObjectURL() {} }, setTimeout: () => 0,
    document: { createElement: () => ({ click() { clicks.push(this.href); }, remove() {} }), body: { appendChild() {} } },
    K: { notify: (icon, text) => notes.push([icon, text]) }, V: { el: null }, location: { href: 'https://box.example/', origin: 'https://box.example' }, fileName: it => it.name,
  };
  vm.runInNewContext(kit.slice(start, end) + kit.slice(tapStart, tapEnd) + '\nthis.saveFile = saveFile; this.save = save; this.macSaver = macSaver;', ctx);
  return { saveFile: ctx.saveFile, save: ctx.save, macSaver: ctx.macSaver, calls, clicks, notes, loaded };
}

test('Mac app with files.save: the app saves the photo and the toast says where', async () => {
  const { saveFile, macSaver, calls, clicks } = load();
  await macSaver(); // asked on page load
  assert.equal(await saveFile({ url: '/messenger/api/unified/media/1', name: 'Photo.jpg' }), 'saved-downloads');
  assert.deepEqual(calls.map(c => c[0]), ['app.info', 'files.save']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])), { data: 'AAEC', name: 'Photo.jpg', mime: 'image/jpeg' });
  assert.equal(clicks.length, 0, 'no blob download that the app would drop');
  const tap = load(); await tap.macSaver(); await tap.save({ url: '/messenger/api/unified/media/1', name: 'Photo.jpg' });
  assert.deepEqual(tap.notes, [['⤓', 'Saved to Downloads']], 'the notice says where');
});

test('a failed native save says it could not save, never Saved', async () => {
  const { saveFile, macSaver } = load({ answer: { status: 'failed', error: 'disk full' } });
  await macSaver();
  await assert.rejects(saveFile({ url: '/m/1', name: 'Photo.jpg' }), /disk full/);
  const tap = load({ answer: { status: 'failed', error: 'disk full' } }); await tap.macSaver(); await tap.save({ url: 'https://box.example/m/1', name: 'Photo.jpg' });
  assert.deepEqual(tap.notes, [['!', 'Couldn’t save this file']]);
  assert.deepEqual(tap.clicks, [], 'no silent address download on the Mac after a failed save');
});

test('an older Mac app without files. keeps the download path but makes no false Saved claim', async () => {
  const { saveFile, calls, clicks } = load({ caps: ['app.', 'meeting.'] });
  assert.equal(await saveFile({ url: 'blob:m1', name: 'Photo.jpg' }), 'downloading');
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

test('the viewer asks the Mac app before a Save tap', async () => {
  // the whole chat-kit.js on the Mac: opening the viewer asks app.info, so a later Save tap already knows the answer
  const doc = createDocument({ url: 'https://box.example/wizard-os-home/' }), calls = [];
  const realCreate = doc.createElement.bind(doc);
  doc.createElement = tag => { const el = realCreate(tag); if (tag === 'a') el.click = () => {}; return el; };
  const window = { WizCore: { bridge: { call: async m => { calls.push(m); return { capabilities: ['app.'] }; } } }, webkit: { messageHandlers: { wizardNative: { postMessage() {} } } }, addEventListener() {} };
  window.top = window;
  vm.runInNewContext(kit, { window, document: doc, navigator: {}, location: { href: 'https://box.example/wizard-os-home/', origin: 'https://box.example' }, URL, Blob, File,
    fetch: async () => { throw new TypeError('offline'); }, setTimeout, clearTimeout, requestAnimationFrame: () => 0, performance, addEventListener() {}, removeEventListener() {} });
  assert.deepEqual(calls, [], 'nothing asked before the viewer opens');
  assert.equal(window.WosChat.viewer.open([{ kind: 'file', url: '/wizard/attachments/abc', name: 'notes.md', mime: 'text/markdown' }]), true);
  assert.deepEqual(calls, ['app.info'], 'asked as the viewer opens, before any Save tap');
  window.WosChat.viewer.close();
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

test('a Mac app that has not answered app.info yet: an own file still downloads from the tap', async () => {
  const { saveFile, clicks } = load({ caps: ['app.', 'files.'] });
  const pending = saveFile({ url: '/wizard/attachments/slow', name: 'notes.md' });
  assert.deepEqual(clicks, ['https://box.example/wizard/attachments/slow'], 'no fetch-then-blob that an older app would drop');
  assert.equal(await pending, 'downloading');
});
