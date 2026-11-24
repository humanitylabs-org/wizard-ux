import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { runRecording } from './fixtures/source-slice.mjs';

// wizard-os issue 747: Save and Share in the media viewer did nothing. They now read the picture the viewer already
// shows from the browser's cache, give up after a bounded wait, and keep the file's real name. Browser proof (real
// Chromium, a box that never answers / refuses the read, Share without file sharing): tests/qa-viewer-save-share.cjs.
const source = fs.readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const part = source.slice(source.indexOf('  const b64 = blob =>'), source.indexOf('  // Apps keep the receipt contract'));

function load({ fetch, timers }) {
  class File { constructor(parts, name, o) { this.parts = parts; this.name = name; this.type = o.type; } }
  const ctx = vm.createContext({ fetch, File, AbortController, setTimeout: timers.set, clearTimeout: timers.clear, FileReader: class {} });
  vm.runInContext(part + '\nglobalThis.api = { dispositionName, fileName, fetchMedia, asFile, SAVE_WAIT };', ctx);
  return ctx.api;
}
const realTimers = { set: setTimeout, clear: clearTimeout };
const answer = (headers = {}, ok = true, type = 'image/jpeg') => ({ ok, status: ok ? 200 : 403, headers: { get: k => headers[k.toLowerCase()] ?? null }, blob: async () => ({ type, size: 3 }) });

test('the server\'s file name is read from Content-Disposition, plain and UTF-8 forms', () => {
  const { dispositionName } = load({ fetch: () => {}, timers: realTimers });
  assert.equal(dispositionName('inline; filename="IMG-20261120-WA0003.jpg"'), 'IMG-20261120-WA0003.jpg');
  assert.equal(dispositionName("attachment; filename=\"Caf_.jpg\"; filename*=UTF-8''Caf%C3%A9.jpg"), 'Café.jpg');
  assert.equal(dispositionName('inline; filename=photo.png'), 'photo.png');
  assert.equal(dispositionName('inline; filename="../../etc/x.png"'), '.._.._etc_x.png');
  assert.equal(dispositionName('inline; filename="file"'), ''); // Messenger's stand-in when it knows no name
  assert.equal(dispositionName(null), '');
});

test('a sensible file name: the item\'s file name, else the server\'s, else name plus extension', () => {
  const { fileName } = load({ fetch: () => {}, timers: realTimers });
  assert.equal(fileName({ name: 'chart.png' }, 'image/png', 'IMG-1.jpg'), 'chart.png');
  assert.equal(fileName({ name: 'Miguel' }, 'image/jpeg', 'IMG-20261120-WA0003.jpg'), 'IMG-20261120-WA0003.jpg');
  assert.equal(fileName({ name: 'Miguel' }, 'image/jpeg', ''), 'Miguel.jpg');
  assert.equal(fileName({ name: 'Image' }, 'image/webp', ''), 'wizard-image.webp');
  assert.equal(fileName({}, '', ''), 'wizard-image.png');
});

test('Save/Share read the shown picture through the browser cache, with the session cookie', async () => {
  const calls = [];
  const api = load({ fetch: async (url, init) => { calls.push({ url, init }); return answer({ 'content-disposition': 'inline; filename="IMG-7.jpg"' }); }, timers: realTimers });
  const file = await api.asFile({ url: '/messenger/api/unified/media/abc?t=x', name: 'Miguel', mime: 'image/jpeg' });
  assert.equal(file.name, 'IMG-7.jpg');
  assert.equal(file.type, 'image/jpeg');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.cache, 'default', 'never no-store: that fetched the whole file from the box again');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.ok(calls[0].init.signal, 'the read can be cut off');
});

test('a read that never answers ends after SAVE_WAIT instead of leaving the button dead', async () => {
  const pending = [];
  const timers = { set: (fn, ms) => { pending.push({ fn, ms }); return pending.length; }, clear: () => {} };
  const api = load({ timers, fetch: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  const read = api.asFile({ url: '/messenger/api/unified/media/slow', name: 'Miguel' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].ms, api.SAVE_WAIT);
  assert.ok(api.SAVE_WAIT <= 60000);
  pending[0].fn();
  await assert.rejects(read, /aborted/);
});

test('a refused read is an error the viewer can fall back from', async () => {
  const api = load({ fetch: async () => answer({}, false), timers: realTimers });
  await assert.rejects(api.asFile({ url: '/x/api/media/1', name: 'a.jpg' }), /HTTP 403/);
});

test('the viewer falls back to a browser download and saves on Share where files cannot be shared', async () => {
  const viewer = source.slice(source.indexOf('  const busy = new Set();'), source.indexOf('  // Zooming out keeps your place'));
  // the real viewer Save/Share on a desktop browser that cannot share files
  const world = ({ read = 'fails' } = {}) => {
    const ctx = { calls: [], location: { href: 'https://box.test/wizard-os-home/', origin: 'https://box.test' }, URL, Promise, Set, setTimeout: () => 0,
      V: { el: null }, directShareDepth: 0, macShell: () => false, native: () => null, privateMedia: () => false, window: {},
      fileName: it => it.name, saveFile: async () => { ctx.reads++; throw new Error('read failed'); }, reads: 0,
      asFile: async it => { ctx.reads++; if (read === 'fails') throw new Error('read failed'); return { name: it.name, type: 'image/jpeg' }; },
      shareFileOpen: async () => 'unsupported', saveBlob: f => { ctx.calls.push(['saveBlob', f.name]); return 'saved'; } };
    runRecording(viewer + '\nglobalThis.api = { save, share };', ctx);
    const said = () => ctx.calls.filter(c => c[0] === 'K.notify').map(c => c[2]);
    const downloads = () => ctx.calls.filter(c => c[0] === 'download').map(c => c.slice(1));
    return { ctx, api: ctx.api, said, downloads };
  };
  const it = { url: '/wizard-os-home/api/media/7', name: 'beach.jpg', kind: 'image' };
  // Save: the read fails, the browser's own download takes the address
  const s1 = world(); await s1.api.save(it);
  assert.deepEqual(s1.downloads(), [['https://box.test/wizard-os-home/api/media/7', 'beach.jpg']]);
  assert.deepEqual(s1.said(), ['Saving to Downloads']);
  // Share where files cannot be shared, read failed: straight to the browser download, no second read
  const s2 = world(); await s2.api.share(it);
  assert.equal(s2.ctx.reads, 1, 'the bytes are read once');
  assert.deepEqual(s2.downloads(), [['https://box.test/wizard-os-home/api/media/7', 'beach.jpg']]);
  assert.deepEqual(s2.said(), ['Sharing isn’t available here · saved to Downloads instead']);
  // Share where files cannot be shared, read worked: those bytes are saved
  const s3 = world({ read: 'works' }); await s3.api.share(it);
  assert.deepEqual(s3.ctx.calls.filter(c => c[0] === 'saveBlob'), [['saveBlob', 'beach.jpg']]);
  assert.deepEqual(s3.downloads(), []);
  assert.deepEqual(s3.said(), ['Sharing isn’t available here · saved to Downloads instead']);
});
