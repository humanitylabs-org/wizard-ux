/* Isolated browser contract suite. No production URL or task-backend writes. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const { chromium } = require('../tools/qa-playwright.cjs');
const root = path.resolve(__dirname, '..');
const evidence = process.env.CAPTURE_EVIDENCE || path.join(__dirname, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
const receipts = [], errors = [];
for (const name of ['receipt.json', 'failure.json', 'progress.json']) { try { fs.unlinkSync(path.join(evidence, name)); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-src 'self'");
  if (req.url === '/core/app-capture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(root, 'web/core/app-capture.js'))); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><button id="gesture">Capture</button><iframe id="app" src="/frame"></iframe>' + (req.url === '/frame' ? '' : '<script src="/core/app-capture.js"></script>')); }
});
let browser;
async function test(name, fn) { const begin = Date.now(); await fn(); receipts.push({ name, passed: true, ms: Date.now() - begin }); fs.writeFileSync(path.join(evidence, 'progress.json'), JSON.stringify({ hostname: os.hostname(), sourceSHA: process.env.SOURCE_SHA, receipts }, null, 2)); console.log('PASS', name); }
async function ready(page) { await page.waitForFunction(() => !!window.WizAppCapture); }
async function begin(page, appId = 'mizel', opts = {}) {
  await page.evaluate(({ appId, opts }) => { window.session = null; window.beginError = null; document.querySelector('#gesture').onclick = async () => { try { window.session = await WizAppCapture.start(appId, opts); window.beginError = null; } catch (e) { window.beginError = { code: e.code, message: e.message, appId: e.appId }; } }; }, { appId, opts });
  await page.click('#gesture'); await page.waitForFunction(() => window.session || window.beginError);
  assert.equal(await page.evaluate(() => window.beginError), null);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext(); const p = await context.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(url); await ready(p);
  await test('start-levels-busy-background-frame-reload-stop-durable-ack', async () => {
    await begin(p, 'trackhunt', { kind: 'song', chunkMs: 100, meta: { taskId: 'synthetic-song' } });
    const id = await p.evaluate(() => { window.levelCount = 0; session.onLevel(() => levelCount++); return session.id; });
    await p.waitForFunction(() => levelCount > 1);
    assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), true);
    assert.deepEqual(await p.evaluate(async () => { try { await WizAppCapture.start('mizel'); } catch (e) { return { code: e.code, appId: e.appId }; } }), { code: 'busy', appId: 'trackhunt' });
    await p.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); history.pushState({ nested: true }, '', '#nested'); history.back(); document.querySelector('#app').src = '/frame?reload'; });
    const other = await context.newPage(); await other.goto(url + '/other'); await other.bringToFront();
    assert.deepEqual(await other.evaluate(async () => { try { await WizAppCapture.start('mizel'); } catch (e) { return { code: e.code, appId: e.appId }; } }), { code: 'busy', appId: 'trackhunt' });
    await other.close(); await p.bringToFront(); await p.waitForTimeout(500);
    const out = await p.evaluate(async () => { const [a,b] = await Promise.all([session.stop(), session.stop()]); return { id: a.id, bytes: a.blob.size, mime: a.mime, durationMs: a.durationMs, same: a === b, meta: a.meta }; });
    assert.equal(out.id, id); assert.ok(out.bytes > 0); assert.ok(out.durationMs > 0); assert.ok(out.same); assert.equal(out.meta.taskId, 'synthetic-song');
    assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), false);
    await p.reload(); await ready(p);
    assert.deepEqual(await p.evaluate(async () => (await WizAppCapture.pending('trackhunt')).map(r => r.id)), [id]);
    assert.equal(await p.evaluate(async id => { try { await WizAppCapture.ack('mizel', id); } catch (e) { return e.code; } }, id), 'not_found');
    await p.evaluate(async id => { await WizAppCapture.ack('trackhunt', id); }, id);
    assert.equal(await p.evaluate(async () => (await WizAppCapture.pending('trackhunt')).length), 0);
  });
  await test('cancel-explicit-removes-only-own-capture', async () => {
    await begin(p, 'trackhunt', { chunkMs: 100 }); await p.waitForTimeout(300);
    await p.evaluate(async () => { await session.cancel(); await session.cancel(); });
    assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), false);
    assert.equal(await p.evaluate(async () => (await WizAppCapture.pending('trackhunt')).length), 0);
  });
  await test('denied-releases-permission-owner', async () => {
    await p.evaluate(() => { window.oldGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
    assert.equal(await p.evaluate(async () => { try { await WizAppCapture.start('mizel'); } catch (e) { return e.code; } }), 'permission_denied');
    assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), false);
    await p.evaluate(() => { navigator.mediaDevices.getUserMedia = oldGUM; });
  });
  await test('shell-reload-recovers-partial-durable-chunks-with-no-active-hold', async () => {
    await begin(p, 'trackhunt', { chunkMs: 100 }); const id = await p.evaluate(() => session.id);
    await p.waitForTimeout(700); await p.reload(); await ready(p);
    const recovered = await p.evaluate(async () => (await WizAppCapture.pending('trackhunt')).map(r => ({ id: r.id, bytes: r.blob.size, partial: r.partial })));
    assert.equal(recovered.length, 1); assert.equal(recovered[0].id, id); assert.ok(recovered[0].bytes > 0); assert.ok(recovered[0].partial);
    assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), false);
    await p.evaluate(async id => WizAppCapture.ack('trackhunt', id), id);
  });
  await test('meeting-pcm16-live-tap-wav-durable-stop', async () => {
    await p.evaluate(() => { window.pcmCount = 0; document.querySelector('#gesture').onclick = async () => { window.session = await WizAppCapture.start('mizel', { kind: 'meeting', meta: { meetingId: 'synthetic' }, onPcm: f => { if (f.pcm.byteLength) pcmCount++; } }); }; });
    await p.click('#gesture'); await p.waitForFunction(() => pcmCount >= 2);
    const out = await p.evaluate(async () => { const r = await session.stop(), bytes = new Uint8Array(await r.blob.arrayBuffer()), view = new DataView(bytes.buffer); return { id: r.id, mime: r.mime, bytes: bytes.length, header: new TextDecoder().decode(bytes.slice(0, 4)), rate: view.getUint32(24, true), data: view.getUint32(40, true), durationMs: r.durationMs }; });
    assert.equal(out.mime, 'audio/wav'); assert.equal(out.header, 'RIFF'); assert.equal(out.rate, 16000); assert.equal(out.data, out.bytes - 44); assert.ok(out.durationMs > 400);
    await p.evaluate(async id => WizAppCapture.ack('mizel', id), out.id);
  });
  await test('native-adapter-mock-preserves-pcm-and-ack-boundary', async () => {
    await p.evaluate(() => { window.nativeCalls = []; WizAppCapture.configureNative({ name: 'synthetic-native', start: async (opts, hooks) => {
      nativeCalls.push('start'); hooks.level(.5); hooks.chunk(new Blob([new Uint8Array(8000)]));
      return { nativeId: 'mock-1', mime: 'audio/wav', pcm: true, stop: async () => { nativeCalls.push('stop'); return { meta: { verifiedNativeMock: true } }; }, cancel: async () => nativeCalls.push('cancel') };
    }, ack: async () => nativeCalls.push('ack') }); });
    await begin(p, 'mizel', { kind: 'meeting', meta: { meetingId: 'mock-meeting' } });
    const out = await p.evaluate(async () => { const r = await session.stop(); return { id: r.id, bytes: r.blob.size, meta: r.meta }; });
    assert.equal(out.bytes, 8044); assert.equal(out.meta.native.verifiedNativeMock, true);
    assert.deepEqual(await p.evaluate(() => nativeCalls), ['start', 'stop']);
    await p.evaluate(async id => WizAppCapture.ack('mizel', id), out.id);
    assert.deepEqual(await p.evaluate(() => nativeCalls), ['start', 'stop', 'ack']);
    await p.evaluate(() => WizAppCapture.configureNative(null));
  });
  await test('browser-meeting-pause-resume-and-two-track-system-audio', async () => {
    await p.evaluate(() => { navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ audio: true }); window.chunkEvents = []; window.session = null; document.querySelector('#gesture').onclick = async () => { window.session = await WizAppCapture.start('mizel', { kind: 'meeting', systemAudio: true, chunkMs: 250, seqBase: { me: 4, them: 7 }, offsetMs: 1000, onChunk: c => chunkEvents.push({ source: c.source, seq: c.seq, startMs: c.startMs, bytes: c.blob.size, mime: c.blob.type }) }); }; });
    await p.click('#gesture'); await p.waitForFunction(() => window.session && chunkEvents.length >= 2);
    await p.evaluate(() => session.pause()); assert.equal(await p.evaluate(() => WizAppCapture.getState().phase), 'paused');
    await p.waitForTimeout(200); await p.evaluate(() => session.resume()); await p.waitForTimeout(300);
    const out = await p.evaluate(async () => { const r = await session.stop(); return { id: r.id, bytes: r.blob.size, tracks: r.meta.captureTracks.map(t => ({ source: t.source, bytes: t.blob.size })), events: chunkEvents }; });
    assert.ok(out.bytes > 44); assert.equal(out.tracks[0].source, 'them'); assert.ok(out.tracks[0].bytes > 44);
    const me = out.events.filter(e => e.source === 'me'), them = out.events.filter(e => e.source === 'them');
    assert.equal(me[0].seq, 4); assert.equal(them[0].seq, 7); assert.equal(me[0].startMs, 1000); assert.ok(out.events.every(e => e.mime === 'audio/wav'));
    await p.reload(); await ready(p);
    assert.equal(await p.evaluate(async () => (await WizAppCapture.pending('mizel'))[0].meta.captureTracks[0].blob.size), out.tracks[0].bytes);
    await p.evaluate(id => WizAppCapture.ack('mizel', id), out.id);
  });
  await test('storage-fault-keeps-hold-queue-and-stop-retry', async () => {
    await begin(p, 'trackhunt', { chunkMs: 100 }); await p.waitForTimeout(250);
    await p.evaluate(() => { window.realTransaction = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function(stores, ...args) { if (Array.from(stores).includes('chunks') && args[0] === 'readwrite') throw new DOMException('quota injected', 'QuotaExceededError'); return realTransaction.call(this, stores, ...args); }; });
    await p.waitForTimeout(400);
    assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), true);
    assert.equal(await p.evaluate(async () => { try { await session.stop(); } catch (e) { return e.code; } }), 'storage_failed');
    await p.evaluate(() => { IDBDatabase.prototype.transaction = realTransaction; });
    const out = await p.evaluate(async () => { const s = await WizAppCapture.resume('trackhunt', WizAppCapture.getState().id), r = await s.stop(); return { id: r.id, bytes: r.blob.size, partial: r.partial }; });
    assert.ok(out.bytes > 0); assert.ok(out.partial); assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), false);
    await p.evaluate(id => WizAppCapture.ack('trackhunt', id), out.id);
  });
  await test('pcm-timeout-late-final-and-retry-stop-succeeds', async () => {
    await p.evaluate(() => { window.realPost = MessagePort.prototype.postMessage; window.realTimeout = setTimeout; let delayed = false; MessagePort.prototype.postMessage = function(message, ...args) { if (message === 'flush' && !delayed) { delayed = true; realTimeout(() => realPost.call(this, message, ...args), 120); return; } return realPost.call(this, message, ...args); }; window.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms === 5000 ? 40 : ms, ...args); });
    await begin(p, 'mizel', { kind: 'meeting' }); await p.waitForTimeout(350);
    assert.equal(await p.evaluate(async () => { try { await session.stop(); } catch (e) { return e.code; } }), 'pcm_flush_timeout');
    await p.waitForTimeout(200);
    await p.evaluate(() => { MessagePort.prototype.postMessage = realPost; window.setTimeout = realTimeout; });
    const out = await p.evaluate(async () => { const r = await session.stop(); return { id: r.id, bytes: r.blob.size }; });
    assert.ok(out.bytes > 44); assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), false);
    await p.evaluate(id => WizAppCapture.ack('mizel', id), out.id);
  });
  await test('ack-previous-upload-while-new-take-owns-mic', async () => {
    await begin(p, 'trackhunt', { chunkMs: 100 }); await p.waitForTimeout(200);
    const id = await p.evaluate(async () => (await session.stop()).id);
    await begin(p, 'mizel', { chunkMs: 100 });
    await p.evaluate(id => WizAppCapture.ack('trackhunt', id), id);
    assert.equal(await p.evaluate(() => WizAppCapture.getState().appId), 'mizel');
    assert.equal(await p.evaluate(async () => (await WizAppCapture.pending('trackhunt')).length), 0);
    await p.evaluate(() => session.cancel());
  });
  await test('mic-ended-during-delayed-chunk-commit-keeps-partial', async () => {
    await p.evaluate(() => {
      window.realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = async options => (window.recordStream = await realGUM(options));
      window.realTransaction2 = IDBDatabase.prototype.transaction; let injected = false;
      IDBDatabase.prototype.transaction = function(stores, ...args) {
        const tx = realTransaction2.call(this, stores, ...args);
        if (!injected && Array.from(stores).includes('chunks') && args[0] === 'readwrite') {
          injected = true; const setter = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete').set;
          Object.defineProperty(tx, 'oncomplete', { set(fn) { setter.call(tx, e => { setTimeout(() => fn.call(tx, e), 70); recordStream.getAudioTracks()[0].dispatchEvent(new Event('ended')); }); } });
        }
        return tx;
      };
    });
    await begin(p, 'trackhunt', { chunkMs: 100 }); await p.waitForFunction(() => !WizAppCapture.getState().hold);
    const r = await p.evaluate(async () => (await WizAppCapture.pending('trackhunt'))[0]);
    assert.ok(r.partial);
    await p.evaluate(id => WizAppCapture.ack('trackhunt', id), r.id);
    await p.evaluate(() => { IDBDatabase.prototype.transaction = realTransaction2; navigator.mediaDevices.getUserMedia = realGUM; });
  });
  await test('native-orphan-with-missing-bridge-does-not-block-unrelated-capture', async () => {
    await p.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('wizard-app-capture-v1', 1); r.onsuccess = () => resolve(r.result); });
      await new Promise(resolve => { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put({ id: 'orphan-native', appId: 'mizel', kind: 'meeting', native: 'wizard-meetings', nativeId: 'orphan-meeting', status: 'recording', startedAt: Date.now(), durationMs: 0, bytes: 0, seq: 0, pcm: true, mime: 'audio/wav', meta: { meetingId: 'orphan-meeting' } }); tx.oncomplete = resolve; }); db.close();
    });
    assert.equal(await p.evaluate(async () => (await WizAppCapture.pending('mizel')).length), 1);
    assert.equal(await p.evaluate(() => WizAppCapture.getState().error), 'native_unavailable');
    await begin(p, 'trackhunt', { chunkMs: 100 }); await p.evaluate(() => session.cancel());
    // Restore the adapter solely to reconcile then explicitly ack the synthetic row.
    await p.evaluate(() => { window.wizardNative = { meetings: { status: async () => ({ recording: false }), start() {}, stop() {} } }; });
    await p.evaluate(async () => { await WizAppCapture.pending('mizel'); await WizAppCapture.ack('mizel', 'orphan-native'); delete window.wizardNative; });
  });
  await test('serialized-stop-flush-bounded-chunks-and-no-loss', async () => {
    await p.evaluate(() => { window.bigBytes = 2 * 1024 * 1024 + 123; WizAppCapture.configureNative({ name: 'synthetic-native', start: async (opts, hooks) => {
      hooks.chunk(new Blob([new Uint8Array(bigBytes)]));
      return { nativeId: 'big-mock', mime: 'audio/aac', stop: async () => { for (let i = 0; i < 10; i++) hooks.chunk(new Blob([new Uint8Array(8000)])); }, cancel: async () => {} };
    }, ack: async () => {} }); });
    await begin(p, 'trackhunt');
    const out = await p.evaluate(async () => { const r = await session.stop(); const db = await new Promise(resolve => { const req = indexedDB.open('wizard-app-capture-v1', 1); req.onsuccess = () => resolve(req.result); }); const sizes = await new Promise(resolve => { const req = db.transaction('chunks').objectStore('chunks').index('id').getAll(r.id); req.onsuccess = () => resolve(req.result.map(c => c.blob.size)); }); db.close(); return { id: r.id, bytes: r.blob.size, sizes, expected: bigBytes + 80000 }; });
    assert.equal(out.bytes, out.expected); assert.ok(out.sizes.every(n => n <= 1024 * 1024)); assert.equal(out.sizes.length, 13);
    await p.evaluate(id => WizAppCapture.ack('trackhunt', id), out.id); await p.evaluate(() => WizAppCapture.configureNative(null));
  });
  const { installDeviceMock, installMeetingMock } = require('./native-mocks.cjs');
  await test('existing-native-device-mock-reload-resume-full-blob-and-delayed-done', async () => {
    await p.addInitScript(installDeviceMock); await p.reload(); await ready(p);
    await begin(p, 'trackhunt', { kind: 'song' }); const id = await p.evaluate(() => session.id);
    await p.reload(); await ready(p);
    const recovered = await p.evaluate(async () => (await WizAppCapture.pending('trackhunt')).map(r => ({ id: r.id, partial: r.partial })));
    assert.deepEqual(recovered, [{ id, partial: true }]);
    assert.deepEqual(await p.evaluate(async () => { try { await WizAppCapture.start('trackhunt', { kind: 'song' }); } catch (e) { return { code: e.code, id: e.id }; } }), { code: 'resume_required', id });
    assert.equal(await p.evaluate(async id => { try { await WizAppCapture.ack('trackhunt', id); } catch (e) { return e.code; } }, id), 'capture_active');
    const out = await p.evaluate(async id => { const s = await WizAppCapture.resume('trackhunt', id, { kind: 'song' }); const r = await s.stop(); return { id: r.id, bytes: r.blob.size, mime: r.mime, durationMs: r.durationMs, partial: !!r.partial, calls: deviceCalls }; }, id);
    assert.equal(out.partial, false); assert.equal(out.bytes, 8); assert.equal(out.mime, 'audio/aac'); assert.equal(out.durationMs, 1250); assert.ok(!out.calls.includes('done')); assert.ok(!out.calls.some(c => c.startsWith('start:')));
    await p.evaluate(id => WizAppCapture.ack('trackhunt', id), out.id);
    assert.ok(await p.evaluate(() => deviceCalls.includes('done')));
    await p.evaluate(() => { delete window.WizardOSDevice; });
  });
  await test('native-null-claim-stays-recoverable-and-cannot-be-acked', async () => {
    await p.reload(); await ready(p); await begin(p, 'trackhunt', { kind: 'song' }); const id = await p.evaluate(() => session.id);
    await p.evaluate(() => { WizardOSDevice.recStop(JSON.parse(WizardOSDevice.recActive()).id); localStorage.setItem('qa-null-claim', '1'); });
    await p.reload(); await ready(p);
    const st = await p.evaluate(async () => { const r = (await WizAppCapture.pending('trackhunt'))[0]; return { id: r.id, recovery: r.meta.captureRecovery }; });
    assert.equal(st.id, id); assert.equal(st.recovery.error, 'native_claim_pending');
    assert.equal(await p.evaluate(async id => { try { await WizAppCapture.ack('trackhunt', id); } catch (e) { return e.code; } }, id), 'capture_active');
    await p.evaluate(() => localStorage.removeItem('qa-null-claim'));
    assert.equal(await p.evaluate(async () => (await WizAppCapture.pending('trackhunt'))[0].blob.size), 8);
    await p.evaluate(id => WizAppCapture.ack('trackhunt', id), id); await p.evaluate(() => { delete window.WizardOSDevice; });
  });
  await test('existing-native-meeting-mock-keeps-task-upload-authority-and-live-pcm', async () => {
    await p.evaluate(installMeetingMock);
    await p.evaluate(() => { const original = wizardNative.meetings.stop; wizardNative.meetings.stop = async () => { await original(); throw Object.assign(new Error('injected ambiguous stop timeout'), { code: 'native_timeout' }); }; });
    await p.evaluate(() => { window.uploadCalls = 0; window.liveCalls = 0; window.session = null; document.querySelector('#gesture').onclick = async () => { window.session = await WizAppCapture.start('mizel', { kind: 'meeting', meta: { meetingId: 'native-meeting' }, onPcm: () => liveCalls++, onChunk: () => uploadCalls++ }); }; });
    await p.click('#gesture'); await p.waitForFunction(() => window.session && liveCalls > 0);
    const out = await p.evaluate(async () => { const r = await session.stop(); return { id: r.id, bytes: r.blob.size, partial: r.partial, meta: r.meta, uploads: uploadCalls, calls: meetingCalls }; });
    assert.equal(out.bytes, 8044); assert.ok(out.partial); assert.equal(out.meta.native.backendOwned, true); assert.equal(out.uploads, 0);
    assert.deepEqual(out.calls, ['start', 'pcm:true', 'stop', 'pcm:false']);
    await p.evaluate(id => WizAppCapture.ack('mizel', id), out.id);
    await p.evaluate(() => { delete window.wizardNative; });
  });
  await test('native-notification-pause-resume-updates-the-owned-session-phase',async()=>{
    await p.evaluate(installMeetingMock);await begin(p,'mizel',{kind:'meeting',meta:{meetingId:'native-pause-fixture'}});
    await p.evaluate(()=>emitMeetingState({paused:true,recording:true}));assert.equal(await p.evaluate(()=>session.getInfo().paused),true);
    await p.evaluate(()=>session.resume());assert.equal(await p.evaluate(()=>session.getInfo().paused),false);
    await p.evaluate(async()=>{const r=await session.stop();await WizAppCapture.ack('mizel',r.id);delete window.wizardNative;});
  });
  await test('resume-starting-rejects-and-cancelled-storage-retry-cannot-stop', async () => {
    await p.evaluate(() => { WizAppCapture.configureNative({ name: 'synthetic-native', start: () => new Promise(resolve => { window.unblockStart = () => resolve({ nativeId: 'starting-mock', mime: 'audio/aac', stop: async () => {}, cancel: async () => {} }); }), ack: async () => {} }); window.startPromise = WizAppCapture.start('trackhunt'); });
    await p.waitForFunction(() => !!window.unblockStart);
    assert.equal(await p.evaluate(async () => { try { await WizAppCapture.resume('trackhunt', WizAppCapture.getState().id); } catch (e) { return e.code; } }), 'capture_starting');
    await p.evaluate(async () => { unblockStart(); window.session = await startPromise; });
    await p.evaluate(() => { window.cancelTxn = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function(stores, ...args) { if (Array.from(stores).includes('chunks') && args[0] === 'readwrite') throw new DOMException('cancel delete failure', 'QuotaExceededError'); return cancelTxn.call(this, stores, ...args); }; });
    assert.equal(await p.evaluate(async () => { try { await session.cancel(); } catch (e) { return e.name; } }), 'QuotaExceededError');
    assert.equal(await p.evaluate(async () => { try { await session.stop(); } catch (e) { return e.code; } }), 'cancelled');
    await p.evaluate(async () => { IDBDatabase.prototype.transaction = cancelTxn; await session.cancel(); WizAppCapture.configureNative(null); });
  });
  if(process.env.MIZEL_WEB) await require('./integration.cjs')({browser,root,evidence,test});
  await test('unknown-active-native-kind-never-becomes-legacy-voice-or-ready-by-absence',async()=>{
    await p.evaluate(()=>{window.WizardOSDevice={recActive:()=>JSON.stringify({id:'unknown-active',ms:100,source:'app'})};});
    assert.equal(await p.evaluate(()=>WizAppCapture.getState().nativeOwnershipReady),false);assert.equal(await p.evaluate(()=>WizAppCapture.getState().hold),true);
    await p.evaluate(()=>{WizardOSDevice.recActive=()=>JSON.stringify({id:'unknown-active',kind:'audio',ms:100,source:'app'});});
    assert.equal(await p.evaluate(()=>WizAppCapture.getState().nativeOwnershipReady),false);
    await p.evaluate(()=>{WizardOSDevice.recActive=()=>JSON.stringify({id:'known-legacy',kind:'auto',ms:100,source:'app'});});
    assert.equal(await p.evaluate(()=>WizAppCapture.getState().nativeOwnershipReady),true);await p.evaluate(()=>{delete window.WizardOSDevice;});
  });
  // James's phone (31 Oct 2026): a native start that never settled left the shared recorder `active`, so every app
  // read the mic as busy until Wizard reloaded. The start is bounded, names the hung stage and frees the mic.
  const hungDevice = () => {
    window.deviceCalls = []; window.nativeActive = null;
    window.WizardOSDevice = { recActive: () => JSON.stringify(nativeActive),
      // No permission yet: the bridge returns no id, so the shared adapter probes getUserMedia first.
      recStart: kind => { deviceCalls.push('start:' + kind); if (!window.permitted || nativeActive) return null; const id = 'native-' + deviceCalls.length; nativeActive = { id, ms: 900, source: 'app' }; return id; },
      recLevel: () => 40, recPause: () => {}, recStop: id => { deviceCalls.push('stop:' + id); nativeActive = null; return JSON.stringify({ id, ms: 900 }); },
      recClaim: id => JSON.stringify({ id, ms: 900 }), recRead: () => JSON.stringify({ b64: btoa('AAC-data'), next: -1 }),
      recCancel: id => { deviceCalls.push('cancel:' + id); if (nativeActive?.id === id) nativeActive = null; }, recDone: id => { deviceCalls.push('done:' + id); } };
    window.realGUM ||= navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.releaseProbe = () => { window.permitted = true; resolve({ getTracks: () => [] }); }; });
  };
  const restoreDevice = () => p.evaluate(() => { delete window.WizardOSDevice; navigator.mediaDevices.getUserMedia = window.realGUM; delete navigator.permissions.query; });
  const startOutcome = (appId, opts) => p.evaluate(async ({ appId, opts }) => { const t = Date.now(); try { window.session = await WizAppCapture.start(appId, opts); return { ok: true, ms: Date.now() - t }; } catch (e) { return { code: e.code, stage: e.stage, message: e.message, ms: Date.now() - t }; } }, { appId, opts });
  await test('hung-native-start-is-bounded-frees-the-mic-and-cancels-the-late-take', async () => {
    await p.reload(); await ready(p);
    await p.evaluate(hungDevice); await p.evaluate(() => { navigator.permissions.query = async () => ({ state: 'granted' }); });
    const hung = await startOutcome('messenger', { kind: 'audio', meta: { purpose: 'synthetic' } });
    assert.equal(hung.code, 'start_timeout', JSON.stringify(hung)); assert.equal(hung.stage, 'microphone permission'); assert.match(hung.message, /microphone permission/);
    assert.ok(hung.ms >= 9500 && hung.ms < 12000, 'bounded near 10 s: ' + hung.ms);
    await p.waitForFunction(() => WizAppCapture.getState().active === false && WizAppCapture.getState().hold === false, null, { timeout: 3000 });
    // Any app can start right away: not busy, not "resume the existing capture first".
    await p.evaluate(() => { window.permitted = true; });
    const next = await startOutcome('messenger', { kind: 'audio', meta: { purpose: 'synthetic' } });
    assert.equal(next.ok, true, JSON.stringify(next));
    const nextNative = await p.evaluate(() => nativeActive.id);
    // The abandoned probe answers now: the newer take keeps recording and the late start claims nothing.
    await p.evaluate(() => releaseProbe()); await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => nativeActive?.id), nextNative, 'late start never touches the newer take');
    assert.equal(await p.evaluate(() => WizAppCapture.getState().active), true);
    await p.evaluate(async () => { await session.cancel(); });
    assert.equal(await p.evaluate(() => WizAppCapture.getState().active), false);
    // A late native take nobody waits for any more is cancelled, and its reservation removed.
    await p.evaluate(() => { window.permitted = false; navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.releaseProbe = () => { window.permitted = true; resolve({ getTracks: () => [] }); }; }); });
    const again = await startOutcome('messenger', { kind: 'audio', meta: { purpose: 'synthetic' } });
    assert.equal(again.code, 'start_timeout', JSON.stringify(again));
    await p.evaluate(() => releaseProbe());
    await p.waitForFunction(() => deviceCalls.some(c => c.startsWith('cancel:')) && !nativeActive, null, { timeout: 3000 });
    await p.waitForFunction(async () => (await WizAppCapture.pending('messenger')).length === 0, null, { timeout: 3000 });
    assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), false);
    await restoreDevice();
  });
  await test('microphone-prompt-still-open-is-not-cut-off-at-the-start-bound', async () => {
    await p.reload(); await ready(p);
    await p.evaluate(hungDevice); await p.evaluate(() => { navigator.permissions.query = async () => ({ state: 'prompt' }); });
    await p.evaluate(() => { window.promptOutcome = null; WizAppCapture.start('messenger', { kind: 'audio', meta: { purpose: 'synthetic' } }).then(s => { window.session = s; promptOutcome = 'started'; }, e => { promptOutcome = e.code; }); });
    await p.waitForTimeout(11000);
    assert.equal(await p.evaluate(() => promptOutcome), null, 'owner answering the prompt keeps the start alive');
    await p.evaluate(() => releaseProbe()); await p.waitForFunction(() => promptOutcome);
    assert.equal(await p.evaluate(() => promptOutcome), 'started');
    await p.evaluate(async () => { await session.cancel(); }); await restoreDevice();
  });
  await p.screenshot({ path: path.join(evidence, 'capture-contract.png') });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(evidence, 'receipt.json'), JSON.stringify({ hostname: os.hostname(), sourceSHA: process.env.SOURCE_SHA, treeHash: process.env.SOURCE_TREE, moduleSHA256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'web/core/app-capture.js'))).digest('hex'), command: 'node qa-app-capture/run.cjs', browser: browser.version(), receipts, errors, limitation: 'Native contract mocks only, not Android hardware/native foreground service QA. Synthetic browser microphone; no production task upload.' }, null, 2));
})().catch(e => { fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ hostname: os.hostname(), sourceSHA: process.env.SOURCE_SHA, receipts, errors, error: e.stack || String(e) }, null, 2)); console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); server.close(); });
