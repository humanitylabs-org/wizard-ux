// Save in the media viewer on Wizard for Mac (try-wizard#139): the app writes the file itself and the toast is honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const kit = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const start = kit.indexOf('  const macShell = () =>'), end = kit.indexOf('  /* ================= media viewer', start);
assert.ok(start > 0 && end > start, 'saveFile block found');
// the viewer's Save tap (save → saveNow → saveFile) and the notice it gives
const tapStart = kit.indexOf('  const busy = new Set();'), tapEnd = kit.indexOf('  const share = it =>', tapStart);

function load({ mac = true, caps = ['app.', 'meeting.', 'files.'], answer = { status: 'saved', name: 'Photo.jpg' }, top = true } = {}) {
  const calls = [], clicks = [], notes = [];
  const bridge = { call: async (method, params) => { calls.push([method, params]); if (method === 'app.info') return { capabilities: caps }; if (method === 'files.save') return answer; throw new Error('unknown'); } };
  const window = { WizCore: { bridge }, webkit: mac ? { messageHandlers: { wizardNative: { postMessage() {} } } } : undefined };
  window.top = top ? window : {};
  const ctx = {
    window, native: () => null, appDownloads: () => false, download: href => clicks.push(href), shareFileOpen: async () => 'opened',
    asFile: async item => ({ name: item.name, type: 'image/jpeg' }), b64: async () => 'AAEC',
    URL: class extends URL { static createObjectURL() { return 'blob:x'; } static revokeObjectURL() {} }, setTimeout: () => 0,
    document: { createElement: () => ({ click() { clicks.push(this.href); }, remove() {} }), body: { appendChild() {} } },
    K: { notify: (icon, text) => notes.push([icon, text]) }, V: { el: null }, location: { href: 'https://wizard.test/', origin: 'https://wizard.test' }, fileName: it => it.name,
  };
  vm.runInNewContext(kit.slice(start, end) + kit.slice(tapStart, tapEnd) + '\nthis.saveFile = saveFile; this.save = save;', ctx);
  return { saveFile: ctx.saveFile, save: ctx.save, calls, clicks, notes };
}

test('Mac app with files.save: the app saves the photo and the toast says where', async () => {
  const { saveFile, calls, clicks } = load();
  assert.equal(await saveFile({ url: '/messenger/api/unified/media/1', name: 'Photo.jpg' }), 'saved-downloads');
  assert.deepEqual(calls.map(c => c[0]), ['app.info', 'files.save']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])), { data: 'AAEC', name: 'Photo.jpg', mime: 'image/jpeg' });
  assert.equal(clicks.length, 0, 'no blob download that the app would drop');
  const tap = load(); await tap.save({ url: '/messenger/api/unified/media/1', name: 'Photo.jpg' });
  assert.deepEqual(tap.notes, [['⤓', 'Saved to Downloads']], 'the notice says where');
});

test('a failed native save says it could not save, never Saved', async () => {
  const { saveFile } = load({ answer: { status: 'failed', error: 'disk full' } });
  await assert.rejects(saveFile({ url: '/m/1', name: 'Photo.jpg' }), /disk full/);
  const tap = load({ answer: { status: 'failed', error: 'disk full' } }); await tap.save({ url: 'https://wizard.test/m/1', name: 'Photo.jpg' });
  assert.deepEqual(tap.notes, [['!', 'Couldn’t save this file']]);
  assert.deepEqual(tap.clicks, [], 'no silent address download on the Mac after a failed save');
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
