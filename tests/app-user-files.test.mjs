import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const read = name => readFileSync(new URL(`../web/core/${name}`, import.meta.url), 'utf8');

function serviceFixture(uploadImpl) {
  const uploads = [];
  let reconcile = null;
  const location = new URL('https://wizard.example/wizard-os-home/');
  const listeners = new Map();
  const child = { location: new URL('/sasquatch/', location), document: {}, addEventListener(type, fn) { listeners.set(type, fn); }, postMessage() {}, emit(type) { listeners.get(type)?.(); } };
  const frame = { tagName: 'IFRAME', src: child.location.href, isConnected: true, contentWindow: child, hasAttribute: () => false, addEventListener() {}, removeEventListener() {} };
  const window = {
    WizCore: { apps: () => ({ APPS: [{ id: 'sasquatch', kind: 'wizard', source: 'apps.json', url: '/sasquatch/' }] }) },
    WizUploads: { uploadToUserFiles: uploadImpl || (async (file, opts) => {
      uploads.push({ file, opts });
      opts.onProgress?.(file.size, file.size, 'finishing');
      return { path: 'Inbox/2026-10-31/' + opts.filename, name: opts.filename, mime: file.type, bytes: file.size, sha256: 'a'.repeat(64), location: 'files_root' };
    }) },
    dispatchEvent() {}, WizConfig: {}
  };
  vm.runInNewContext(read('app-services.js'), { window, location, URL, AbortController, Blob, File, Uint8Array, addEventListener() {}, setInterval(fn) { reconcile = fn; }, setTimeout, clearTimeout, document: { hidden: false, readyState: 'loading', addEventListener() {} }, CustomEvent: class {}, navigator: {} });
  window.WizAppServices.attach(frame, { appId: 'sasquatch', path: '/sasquatch/', isVisible: () => true });
  return { service: window.WizAppServices.connect(child, {}), frame, child, uploads, reconcile: () => reconcile?.() };
}

const freePort = () => new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });

const png = name => new File([Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0])], name, { type: 'image/png' });

test('verified apps save validated images to the dated user-files Inbox and receive path metadata', async () => {
  const f = serviceFixture();
  const file = png('source.png');
  const result = await f.service.files.saveImage(file, { filename: 'saasquatch-550e8400-e29b-41d4-a716-446655440000.png' });
  assert.equal(f.uploads.length, 1);
  assert.notEqual(f.uploads[0].file, file);
  assert.equal(f.uploads[0].file instanceof Blob, true);
  assert.equal(f.uploads[0].opts.folder, '');
  assert.equal(result.path, 'Inbox/2026-10-31/saasquatch-550e8400-e29b-41d4-a716-446655440000.png');
  assert.equal(result.sha256, 'a'.repeat(64));
  assert.equal(result.location, 'files_root');
  assert.equal('id' in result, false);
});

test('image saves reject bad signatures and detached app documents', async () => {
  const f = serviceFixture();
  const fake = new File([Uint8Array.from([0,1,2,3,4,5,6,7,8,9,10,11])], 'bad.png', { type: 'image/png' });
  await assert.rejects(f.service.files.saveImage(fake, { filename: 'bad.png' }), /contents do not match/);
  f.frame.isConnected = false;
  await assert.rejects(f.service.files.saveImage(png('ok.png'), { filename: 'ok.png' }), /no longer authorized/);
  assert.equal(f.uploads.length, 0);
});

test('image saves reject files over 8 MiB before upload', async () => {
  const f = serviceFixture();
  const huge = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' });
  await assert.rejects(f.service.files.saveImage(huge, { filename: 'huge.png' }), /up to 8 MB/);
  assert.equal(f.uploads.length, 0);
});

test('an image of exactly 8 MiB is accepted', async () => {
  const f = serviceFixture();
  const header = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
  const exact = new File([header, new Uint8Array(8 * 1024 * 1024 - header.length)], 'exact.png', { type: 'image/png' });
  const receipt = await f.service.files.saveImage(exact, { filename: 'exact.png' });
  assert.equal(receipt.bytes, 8 * 1024 * 1024);
  assert.equal(f.uploads.length, 1);
});

test('image saves reject spoofed Files, unsafe receipt extensions and overlong names', async () => {
  const f = serviceFixture();
  const spoof = {
    [Symbol.toStringTag]: 'File', name: 'spoof.png', type: 'image/png', size: 12,
    slice() { return new Blob([Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0])], { type: 'image/png' }); }
  };
  await assert.rejects(f.service.files.saveImage(spoof, { filename: 'spoof.png' }), /Use a PNG/);
  for (const length of [241, 255]) {
    await assert.rejects(f.service.files.saveImage(png('long.png'), { filename: 'a'.repeat(length - 4) + '.png' }), /filename and type/);
  }
  const badReceipt = serviceFixture(async (file, opts) => ({ path: `Inbox/2026-10-31/${opts.filename}.bin`, filename: opts.filename, mime: file.type, bytes: file.size, sha256: 'b'.repeat(64), location: 'files_root' }));
  await assert.rejects(badReceipt.service.files.saveImage(png('receipt.png'), { filename: 'receipt.png' }), /invalid image receipt/);
  assert.equal(f.uploads.length, 0);
});

test('JPEG and WebP signatures are accepted at the 240-character filename boundary', async () => {
  const jpeg = new File([Uint8Array.from([0xff,0xd8,0xff,0,0,0,0,0,0,0,0,0])], 'source.jpg', { type: 'image/jpeg' });
  const webp = new File([Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50])], 'source.webp', { type: 'image/webp' });
  const jpgFixture = serviceFixture();
  const jpgName = 'a'.repeat(236) + '.jpg';
  assert.equal(jpgName.length, 240);
  assert.equal((await jpgFixture.service.files.saveImage(jpeg, { filename: jpgName })).mime, 'image/jpeg');
  const webpFixture = serviceFixture();
  assert.equal((await webpFixture.service.files.saveImage(webp, { filename: 'source.webp' })).mime, 'image/webp');
});

test('document replacement, wrong-origin navigation and pagehide cancel file access', async () => {
  const replaced = serviceFixture();
  replaced.child.document = {};
  await assert.rejects(replaced.service.files.saveImage(png('replace.png'), { filename: 'replace.png' }), /no longer authorized/);
  const foreign = serviceFixture();
  foreign.child.location = new URL('https://evil.example/sasquatch/');
  await assert.rejects(foreign.service.files.saveImage(png('foreign.png'), { filename: 'foreign.png' }), /no longer authorized/);
  let started;
  const start = new Promise(resolve => { started = resolve; });
  const inflight = serviceFixture((file, opts) => new Promise((resolve, reject) => {
    started();
    opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }));
  const saving = inflight.service.files.saveImage(png('inflight.png'), { filename: 'inflight.png' });
  await start;
  inflight.child.emit('pagehide');
  await assert.rejects(saving, /aborted/);
  let replacedStarted;
  const replacedStart = new Promise(resolve => { replacedStarted = resolve; });
  const replacedInflight = serviceFixture((file, opts) => new Promise((resolve, reject) => {
    replacedStarted();
    opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('replaced'), { name: 'AbortError' })), { once: true });
  }));
  const replacedSaving = replacedInflight.service.files.saveImage(png('replacement.png'), { filename: 'replacement.png' });
  await replacedStart;
  replacedInflight.child.document = {};
  replacedInflight.reconcile();
  await assert.rejects(replacedSaving, /replaced/);
});

test('resumable user-files upload sends an empty-folder destination and accepts a path receipt', async () => {
  const calls = [];
  const window = { WizConfig: { raw: { bootstrap: {} }, has: () => true, endpoint: () => '/wizard/v1/uploads' } };
  class XHR {
    constructor() { this.upload = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    getResponseHeader(name) { return name === 'Upload-Offset' ? '12' : null; }
    async send(blob) { calls.push({ method: this.method, url: this.url, bytes: blob.size }); this.upload.onprogress?.({ loaded: blob.size }); this.status = 204; this.responseText = ''; this.onload(); }
    abort() {}
  }
  const fetch = async (url, init) => {
    calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/complete')) return { status: 201, json: async () => ({ file: { filename: 'saasquatch-550e8400-e29b-41d4-a716-446655440000.png', path: 'Inbox/2026-10-31/saasquatch-550e8400-e29b-41d4-a716-446655440000.png', mime: 'image/png', bytes: 12, sha256: 'c'.repeat(64), location: 'files_root' } }) };
    return { status: 201, json: async () => ({ upload_id: 'up_test', offset: 0, status: 'uploading', chunk_bytes: 1024 }) };
  };
  vm.runInNewContext(read('uploads.js'), { window, fetch, XMLHttpRequest: XHR, AbortController, crypto: { randomUUID: () => 'client-id' }, setTimeout, clearTimeout, Blob, File, console });
  const file = png('source.png');
  const receipt = await window.WizUploads.uploadToUserFiles(file, { folder: '', filename: 'saasquatch-550e8400-e29b-41d4-a716-446655440000.png' });
  assert.deepEqual(calls[0].body.destination, { folder: '' });
  assert.equal(calls[0].body.filename, 'saasquatch-550e8400-e29b-41d4-a716-446655440000.png');
  assert.equal(receipt.path, 'Inbox/2026-10-31/saasquatch-550e8400-e29b-41d4-a716-446655440000.png');
  assert.equal(receipt.sha256, 'c'.repeat(64));
  assert.equal('id' in receipt, false);
});

test('the exact resumable fixture persists destination uploads and returns a Files receipt', { timeout: 10000 }, async () => {
  const port = await freePort();
  const data = mkdtempSync(join(tmpdir(), 'wizard-user-files-fixture-'));
  const fixture = spawn(process.execPath, [fileURLToPath(new URL('../tools/share-fixture.mjs', import.meta.url)), String(port), '--host=127.0.0.1', `--data=${data}`], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/wizard/v1/bootstrap`)).ok) break; } catch {}
      if (i === 99) throw new Error('fixture did not start');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const bytes = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
    const filename = 'saasquatch-550e8400-e29b-41d4-a716-446655440000.png';
    const created = await fetch(`${base}/wizard/v1/uploads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_upload_id: 'fixture-user-files-1', filename, mime: 'image/png', bytes: bytes.length, destination: { folder: '' } }) });
    assert.equal(created.status, 201);
    const upload = await created.json();
    const patched = await fetch(`${base}/wizard/v1/uploads/${upload.upload_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' }, body: bytes });
    assert.equal(patched.status, 204);
    const completed = await fetch(`${base}/wizard/v1/uploads/${upload.upload_id}/complete`, { method: 'POST' });
    assert.equal(completed.status, 200);
    const receipt = (await completed.json()).file;
    assert.equal(receipt.location, 'files_root');
    assert.equal(receipt.filename, filename);
    assert.match(receipt.path, new RegExp(`^Inbox/\\d{4}-\\d{2}-\\d{2}/${filename}$`));
    assert.equal(receipt.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal('id' in receipt, false);
    const ordinaryCreate = await fetch(`${base}/wizard/v1/uploads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_upload_id: 'fixture-ordinary-1', filename: 'ordinary.png', mime: 'image/png', bytes: bytes.length }) });
    const ordinaryUpload = await ordinaryCreate.json();
    assert.equal((await fetch(`${base}/wizard/v1/uploads/${ordinaryUpload.upload_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' }, body: bytes })).status, 204);
    const ordinaryReceipt = (await (await fetch(`${base}/wizard/v1/uploads/${ordinaryUpload.upload_id}/complete`, { method: 'POST' })).json()).file;
    assert.match(ordinaryReceipt.id, /^wf_[0-9a-f]{32}$/);
    assert.equal('location' in ordinaryReceipt, false);
    const stored = readdirSync(join(data, 'files'));
    assert.equal(stored.length, 2);
    for (const name of stored) assert.deepEqual(readFileSync(join(data, 'files', name)), Buffer.from(bytes));
  } finally {
    fixture.kill('SIGTERM');
    await new Promise(resolve => fixture.once('exit', resolve));
    rmSync(data, { recursive: true, force: true });
  }
});

test('the upload core accepts user-files path receipts without weakening ordinary id receipts', () => {
  const uploads = read('uploads.js');
  const client = read('app-client.js');
  assert.match(uploads, /destination: \{ folder \}/);
  assert.match(uploads, /userFile \? receipt\.path : receipt\.id/);
  assert.match(uploads, /path: String\(receipt\.path\)/);
  assert.match(uploads, /sha256: String\(receipt\.sha256/);
  assert.match(client, /if \(!service\?\.files\?\.saveImage\)/);
  assert.doesNotMatch(client, /request\('files\.saveImage'/);
});

test('shared composer can keep native multiline Enter while retaining paste and drop', () => {
  const composer = read('composer-input.js');
  assert.match(composer, /opts\.enter === 'native'/);
  assert.match(composer, /\['paste', onPaste\]/);
  assert.match(composer, /\['drop', onDrop\]/);
});
