/* Real Chromium PCM/IDB/Locks + hosted WizardApp facade; native bridges are fixtures.
 * Localhost only. No Outline backend, Android services or physical microphone claimed. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), crypto = require('node:crypto'), os = require('node:os');
const { chromium } = require('../tools/qa-playwright.cjs');
const { installDeviceMock, installMeetingMock } = require('./native-mocks.cjs');
const root = path.resolve(__dirname, '..'), evidence = process.env.CAPTURE_EVIDENCE;
assert.ok(evidence, 'Set CAPTURE_EVIDENCE to an isolated evidence directory');
fs.mkdirSync(evidence, { recursive: true });
const files = ['web/core/app-capture.js', 'web/core/app-services.js', 'web/core/app-client.js', 'web/core/voice.js', 'qa-app-capture/outline-pcm.cjs', 'qa-app-capture/native-mocks.cjs'];
const receipts = [], blocked = [], errors = [];
const scripts = new Map(files.filter(f => f.startsWith('web/')).map(f => ['/' + f.slice(4), fs.readFileSync(path.join(root, f))]));
scripts.set('/boot.js', `window.WizCore={apps:()=>({APPS:[{id:'voice-outline',url:'/outline/'}]})};`);
scripts.set('/mount.js', `const f=document.querySelector('iframe');window.openApps=['voice-outline'];WizAppServices.trackOpenApps?.(()=>window.openApps);window.detachOutline=WizAppServices.attach(f,{appId:'voice-outline',path:'/outline/'});f.src='/outline/';`);
const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-src 'self'");
  if (scripts.has(req.url)) { res.setHeader('Content-Type', 'text/javascript'); return res.end(scripts.get(req.url)); }
  const pathname = new URL(req.url, 'http://fixture').pathname.replace(/^\/wizard-os-home\//, '/');
  if (pathname.startsWith('/core/') && /^\/core\/[a-z0-9-]+\.js$/.test(pathname)) {
    const file = path.join(root, 'web', pathname);
    if (fs.existsSync(file)) { res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(file)); }
  }
  res.setHeader('Content-Type', 'text/html');
  if (req.url === '/outline/') return res.end('<!doctype html><html data-app="voice-outline"><button id="go">Capture</button><script src="/core/app-client.js"></script></html>');
  res.end('<!doctype html><iframe></iframe><script src="/boot.js"></script><script src="/core/app-capture.js"></script><script src="/core/app-services.js"></script><script src="/core/voice.js"></script><script src="/mount.js"></script>');
});
let browser, origin;
async function fixture() {
  const ctx = await browser.newContext();
  await ctx.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { blocked.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await ctx.addInitScript(() => {
    window.rawAdmissions = 0;
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => {
      rawAdmissions++;
      if (window !== parent) throw new Error('Hosted apps cannot own a recorder');
      return gum(...args);
    };
    if (window !== parent) for (const key of ['AudioContext', 'MediaRecorder']) window[key] = function () { throw new Error('App-owned recorder'); };
  });
  await ctx.addInitScript(installDeviceMock);
  await ctx.addInitScript(installMeetingMock);
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.goto(origin);
  await p.waitForFunction(() => WizAppCapture.getState().nativeRegistryReady && document.querySelector('iframe').contentWindow.WizardApp?.hosted);
  const frame = () => p.frames().find(f => f.url().endsWith('/outline/'));
  return { ctx, p, frame };
}
async function test(name, fn) {
  if (process.env.TEST_FILTER && !name.includes(process.env.TEST_FILTER)) return;
  const f = await fixture(), start = Date.now();
  try { await fn(f); receipts.push({ name, passed: true, ms: Date.now() - start }); console.log('PASS', name); }
  catch (e) { receipts.push({ name, passed: false, error: e.stack }); console.error('FAIL', name, e.message); }
  finally { await f.ctx.close(); }
}
const options = { kind: 'outline', pcm: true, chunkMs: 250, meta: { taskId: 'outline-fixture' } };
async function begin({ p, frame }, opts = options) {
  await frame().evaluate(opts => {
    window.session = null; window.startError = null; window.pcms = []; window.chunks = [];
    document.querySelector('#go').onclick = async () => {
      let prepared;
      try {
        prepared = WizardApp.capture.prepare(opts);
        window.session = await WizardApp.capture.start({ ...opts, preparedId: prepared.id });
        session.onPcm(f => pcms.push({ bytes: f.pcm.byteLength, source: f.source }));
        session.onChunk(c => chunks.push({ seq: c.seq, bytes: c.blob.size }));
      } catch (e) { window.startError = e.code || e.name; } finally { prepared?.release(); }
    };
  }, opts);
  await frame().click('#go');
  await frame().waitForFunction(() => window.session || window.startError);
  assert.equal(await frame().evaluate(() => startError), null);
}
async function rejectStart(p) {
  return p.evaluate(async opts => { try { const s = await WizAppCapture.start('voice-outline', opts); await s.cancel(); return 'started'; } catch (e) { return e.code; } }, options);
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = 'http://127.0.0.1:' + server.address().port;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    await test('James-Messenger-own-take-reattach-is-owner-scoped-after-frame-reload', async ({p, frame}) => {
      await begin({p, frame}, {kind:'audio',meta:{purpose:'messenger-voice',person:'synthetic'}});
      const id=await frame().evaluate(()=>session.id);
      assert.equal(await p.evaluate(()=>WizAppCapture.attach('other-app')),null,'another app cannot attach this take');
      await p.evaluate(()=>{const f=document.querySelector('iframe');window.oldCaptureDoc=f.contentDocument;f.contentWindow.location.reload();});
      await p.waitForFunction(()=>{const f=document.querySelector('iframe');return f.contentDocument!==oldCaptureDoc && f.contentWindow.WizardApp?.hosted;});
      const actual=await frame().evaluate(async()=>{window.session=await WizardApp.capture.attach();return session.id;});
      assert.equal(actual,id);await frame().evaluate(()=>session.cancel());
      assert.equal(await p.evaluate(()=>WizAppCapture.getState().active),false);
    });
    await test('James-Messenger-reload-during-start-reattached-take-keeps-recording', async ({p,frame}) => {
      await p.evaluate(()=>{window.bridgeStopped=0;WizAppCapture.configureNative({name:'synthetic-delayed',start:()=>new Promise(resolve=>{window.resolveNative=()=>resolve({nativeId:'fixture-delayed',mime:'audio/aac',stop:async()=>{bridgeStopped++;return{blob:new Blob(['kept'])};},cancel:async()=>{bridgeStopped++;}});})});});
      await frame().evaluate(()=>{window.startOutcome=WizardApp.capture.start({kind:'audio'}).then(()=> 'unexpected',e=>e.message);});
      await p.waitForFunction(()=>!!window.resolveNative);
      await p.evaluate(()=>{const f=document.querySelector('iframe');window.oldCaptureDoc=f.contentDocument;f.contentWindow.location.reload();});
      await p.waitForFunction(()=>{const f=document.querySelector('iframe');return f.contentDocument!==oldCaptureDoc && f.contentWindow.WizardApp?.hosted;});
      await frame().evaluate(()=>{window.attached=WizardApp.capture.attach().then(s=>(window.session=s)&&s.id);});
      await new Promise(r=>setTimeout(r,100));
      await p.evaluate(()=>resolveNative());
      const id=await frame().evaluate(()=>attached);
      assert.ok(id,'replacement document attached the take');
      await new Promise(r=>setTimeout(r,300));
      assert.equal(await p.evaluate(()=>bridgeStopped),0,'stale document did not stop the reattached take');
      assert.equal(await p.evaluate(()=>WizAppCapture.getState().active),true,'take still recording');
      await frame().evaluate(()=>session.stop());
      assert.equal(await p.evaluate(()=>bridgeStopped),1);
    });
    await test('James-Messenger-detached-bridge-after-native-start-stops-and-keeps-take', async ({p,frame}) => {
      await p.evaluate(()=>{window.bridgeStopped=0;WizAppCapture.configureNative({name:'synthetic-delayed',start:()=>new Promise(resolve=>{window.resolveNative=()=>resolve({nativeId:'fixture-delayed',mime:'audio/aac',stop:async()=>{bridgeStopped++;return{blob:new Blob(['kept'])};},cancel:async()=>{throw new Error('must retain');}});})});});
      await frame().evaluate(()=>{window.startOutcome=WizardApp.capture.start({kind:'audio'}).then(()=> 'unexpected',e=>e.message);});
      await p.waitForFunction(()=>!!window.resolveNative);
      await p.evaluate(()=>detachOutline());
      await p.evaluate(()=>resolveNative());
      await p.waitForFunction(()=>bridgeStopped===1);
      assert.equal(await p.evaluate(()=>WizAppCapture.getState().active),false);
      assert.equal(await p.evaluate(async()=>(await WizAppCapture.pending('voice-outline')).length),1);
    });
    await test('capabilities-select-browser-PCM-without-starting-native', async ({ p, frame }) => {
      const caps = await frame().evaluate(opts => WizardApp.capture.capabilities(opts), options);
      assert.equal(caps.pcm, true); assert.equal(caps.native, null);
      assert.deepEqual(await p.evaluate(() => [deviceCalls, meetingCalls, rawAdmissions]), [[], [], 0]);
      assert.equal(await p.evaluate(() => WizAppCapture.capabilities({ kind: 'audio' }).native), 'wizard-device');
      assert.equal(await p.evaluate(() => WizAppCapture.capabilities({ kind: 'audio' }).pcm), false);
      assert.equal(await p.evaluate(() => WizAppCapture.capabilities({ kind: 'meeting', pcm: true }).native), 'wizard-meetings');
    });
    await test('hosted-PCM-WAV-stream-single-owner-reload-and-ack', async f => {
      const { p, frame, ctx } = f;
      assert.equal(await frame().evaluate(opts => WizardApp.capture.capabilities(opts).pcm, options), true);
      await begin(f); await frame().waitForFunction(() => pcms.length >= 2 && chunks.length >= 1);
      assert.equal(await frame().evaluate(() => session.getInfo().native), null);
      assert.equal(await frame().evaluate(() => session.getInfo().capabilities.pcm), true);
      assert.equal(await p.evaluate(() => WizAppServices.update.busy()), true);
      assert.deepEqual(await p.evaluate(() => [deviceCalls, meetingCalls, rawAdmissions]), [[], [], 1]);
      assert.equal(await frame().evaluate(() => rawAdmissions), 0);
      assert.equal(await rejectStart(p), 'busy');
      assert.equal(await p.evaluate(async () => { try { await WizCore.voice().start(); } catch (e) { return e.code; } }), 'busy');
      assert.equal(await p.evaluate(async () => { try { await WizAppCapture.start('mizel', { kind: 'meeting', meta: { meetingId: 'not-created' } }); } catch (e) { return e.code; } }), 'busy');
      const other = await ctx.newPage(); await other.goto(origin);
      assert.equal(await rejectStart(other), 'busy'); await other.close();
      const id = await frame().evaluate(() => session.id);
      await frame().goto(origin + '/outline/');
      await frame().waitForFunction(() => WizardApp?.hosted);
      await frame().evaluate(async id => { window.session = await WizardApp.capture.start({ resumeId: id }); }, id);
      assert.equal(await p.evaluate(() => rawAdmissions), 1);
      const out = await frame().evaluate(async () => {
        const r = await session.stop(), b = await r.blob.arrayBuffer(), v = new DataView(b);
        return { id: r.id, mime: r.mime, bytes: b.byteLength, magic: new TextDecoder().decode(b.slice(0, 4)), rate: v.getUint32(24, true), channels: v.getUint16(22, true), bits: v.getUint16(34, true), data: v.getUint32(40, true), streams: r.streamChunks.length, meta: r.meta, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), x => x.toString(16).padStart(2, '0')).join('') };
      });
      assert.equal(out.magic, 'RIFF'); assert.equal(out.mime, 'audio/wav'); assert.equal(out.rate, 16000);
      assert.equal(out.channels, 1); assert.equal(out.bits, 16); assert.equal(out.data, out.bytes - 44); assert.ok(out.data > 0); assert.ok(out.streams > 0);
      assert.deepEqual(out.meta, options.meta); assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), false);
      await p.reload(); await p.waitForFunction(() => document.querySelector('iframe').contentWindow.WizardApp?.hosted);
      const pending = await frame().evaluate(async () => { const [r] = await WizardApp.capture.pending(); return { id: r.id, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await r.blob.arrayBuffer())), x => x.toString(16).padStart(2, '0')).join('') }; });
      assert.deepEqual(pending, { id, hash: out.hash });
      assert.equal(await p.evaluate(async id => { try { await WizAppCapture.ack('other-app', id); } catch (e) { return e.code; } }, id), 'not_found');
      await frame().evaluate(id => WizardApp.capture.ack(id), id);
      assert.deepEqual(await frame().evaluate(() => WizardApp.capture.pending()), []);
      assert.deepEqual(await p.evaluate(() => [deviceCalls, meetingCalls]), [[], []]);
    });
    await test('PCM-shell-interruption-recovers-partial-without-native-claims', async f => {
      const { p, frame } = f;
      assert.equal(await frame().evaluate(opts => WizardApp.capture.capabilities(opts).pcm, options), true);
      await begin(f); await frame().waitForFunction(() => chunks.length >= 2);
      const id = await frame().evaluate(() => session.id);
      await p.reload(); await p.waitForFunction(() => document.querySelector('iframe').contentWindow.WizardApp?.hosted);
      const out = await frame().evaluate(async () => (await WizardApp.capture.pending()).map(r => ({ id: r.id, bytes: r.blob.size, partial: r.partial, mime: r.mime })));
      assert.equal(out.length, 1); assert.equal(out[0].id, id); assert.equal(out[0].partial, true); assert.equal(out[0].mime, 'audio/wav'); assert.ok(out[0].bytes > 44);
      assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), false);
      await frame().evaluate(id => WizardApp.capture.ack(id), id);
      assert.deepEqual(await p.evaluate(() => [deviceCalls, meetingCalls]), [[], []]);
    });
    await test('AAC-default-recovery-resume-and-native-ack-stay-native', async f => {
      const { p, frame } = f;
      await begin(f, { kind: 'audio' });
      const id = await frame().evaluate(() => session.id);
      assert.equal(await frame().evaluate(() => session.getInfo().native), 'wizard-device');
      await p.reload(); await p.waitForFunction(() => WizAppCapture.getState().nativeOwnershipReady && document.querySelector('iframe').contentWindow.WizardApp?.hosted);
      await frame().evaluate(async ({ id, options }) => { window.session = await WizardApp.capture.start({ ...options, resumeId: id }); }, { id, options });
      assert.equal(await frame().evaluate(() => session.getInfo().native), 'wizard-device');
      const out = await frame().evaluate(async () => { const r = await session.stop(); return { id: r.id, mime: r.mime, bytes: r.blob.size }; });
      assert.equal(out.mime, 'audio/aac'); assert.equal(out.bytes, 8);
      assert.equal(await p.evaluate(() => deviceCalls.includes('done')), false);
      await frame().evaluate(id => WizardApp.capture.ack(id), id);
      assert.equal(await p.evaluate(() => deviceCalls.includes('done')), true);
      assert.equal(await p.evaluate(() => rawAdmissions), 0);
    });
    await test('native-meeting-keeps-backend-owned-stop-and-PCM-tee', async ({ p }) => {
      await p.evaluate(async () => { window.s = await WizAppCapture.start('mizel', { kind: 'meeting', pcm: true, meta: { meetingId: 'existing-fixture' } }); });
      assert.equal(await p.evaluate(() => s.getInfo().native), 'wizard-meetings');
      const out = await p.evaluate(async () => { const r = await s.stop(); await WizAppCapture.ack('mizel', r.id); return r.meta.native; });
      assert.equal(out.backendOwned, true); assert.equal(out.backendStopOwned, true);
      assert.deepEqual(await p.evaluate(() => meetingCalls), ['start', 'pcm:true', 'stop', 'pcm:false']);
      assert.deepEqual(await p.evaluate(() => [deviceCalls, rawAdmissions]), [[], 0]);
    });
    await test('native-meeting-without-bridge-never-falls-back-to-AAC-or-browser', async ({ p }) => {
      await p.evaluate(() => { delete window.wizardNative; });
      assert.equal(await p.evaluate(async () => { try { await WizAppCapture.start('mizel', { kind: 'meeting', pcm: true }); } catch (e) { return e.code; } }), 'native_meeting_adapter_required');
      assert.equal(await p.evaluate(() => rawAdmissions), 0);
    });
    for (const owner of ['auto', 'command', 'dictation', 'unknown', 'paused', 'malformed']) {
      await test('busy-native-' + owner + '-prepare-and-direct-start', async ({ p }) => {
        await p.evaluate(owner => { WizardOSDevice.recActive = () => owner === 'malformed' ? '{broken' : JSON.stringify({ id: 'already-recording', kind: owner, paused: owner === 'paused' }); }, owner);
        assert.equal(await p.evaluate(opts => { try { WizAppCapture.prepare('voice-outline', opts); } catch (e) { return e.code; } }, options), 'busy');
        assert.equal(await rejectStart(p), 'busy');
        assert.deepEqual(await p.evaluate(() => [deviceCalls, meetingCalls, rawAdmissions]), [[], [], 0]);
      });
    }
    await test('busy-native-meeting-discovered-after-preparation', async ({ p }) => {
      await p.evaluate(opts => { window.prepared = WizAppCapture.prepare('voice-outline', opts); emitMeetingState({ recording: true, paused: true, meetingId: 'external-meeting' }); }, options);
      assert.equal(await p.evaluate(async opts => { try { const s = await WizAppCapture.start('voice-outline', { ...opts, preparedId: prepared.id }); await s.cancel(); return 'started'; } catch (e) { return e.code; } finally { prepared.release(); } }, options), 'busy');
      assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), true);
      assert.deepEqual(await p.evaluate(() => [deviceCalls, meetingCalls, rawAdmissions]), [[], [], 0]);
    });
    await test('busy-native-voice-discovered-after-preparation', async ({ p }) => {
      await p.evaluate(opts => { window.prepared = WizAppCapture.prepare('voice-outline', opts); WizardOSDevice.recActive = () => JSON.stringify({ id: 'external-voice', kind: 'auto' }); }, options);
      assert.equal(await p.evaluate(async opts => { try { const s = await WizAppCapture.start('voice-outline', { ...opts, preparedId: prepared.id }); await s.cancel(); return 'started'; } catch (e) { return e.code; } finally { prepared.release(); } }, options), 'busy');
      assert.deepEqual(await p.evaluate(() => [deviceCalls, meetingCalls, rawAdmissions]), [[], [], 0]);
    });
    await test('busy-raw-native-meeting-port-is-status-only', async ({ p }) => {
      await p.evaluate(() => {
        delete window.wizardNative; window.portCommands = [];
        window.wizardMizelPort = { onmessage: null, postMessage(raw) {
          const { id, cmd } = JSON.parse(raw); portCommands.push(cmd);
          queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, ok: true, status: { recording: true, paused: true, meetingId: 'raw-existing-meeting' } }) }));
        } };
      });
      assert.equal(await rejectStart(p), 'busy');
      assert.ok(await p.evaluate(() => portCommands.length > 0 && portCommands.every(c => c === 'status')));
      assert.deepEqual(await p.evaluate(() => [deviceCalls, rawAdmissions]), [[], 0]);
    });
    for (const prepared of [false, true]) {
      await test('busy-native-meeting-without-id-' + (prepared ? 'prepared' : 'direct'), async ({ p }) => {
        await p.evaluate(({ prepared, options }) => {
          if (prepared) window.prepared = WizAppCapture.prepare('voice-outline', options);
          emitMeetingState({ recording: true });
        }, { prepared, options });
        assert.equal(await p.evaluate(async ({ prepared, options }) => {
          try { const s = await WizAppCapture.start('voice-outline', { ...options, ...(prepared ? { preparedId: window.prepared.id } : {}) }); await s.cancel(); return 'started'; }
          catch (e) { return e.code; } finally { window.prepared?.release(); }
        }, { prepared, options }), 'busy');
        assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), true);
        assert.equal(await p.evaluate(opts => { try { WizAppCapture.prepare('voice-outline', opts); } catch (e) { return e.code; } }, options), 'busy');
        assert.deepEqual(await p.evaluate(() => [deviceCalls, meetingCalls, rawAdmissions]), [[], [], 0]);
        assert.deepEqual(await p.evaluate(() => WizAppCapture.pending('mizel')), [], 'No invented meeting owner');
        await p.evaluate(async () => { emitMeetingState({ recording: false }); await WizAppCapture.pending('voice-outline'); });
        assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), false);
      });
    }
    await test('permission-denied-releases-browser-reservation-without-native-fallback', async ({ p }) => {
      await p.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
      assert.equal(await rejectStart(p), 'permission_denied');
      assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), false);
      assert.deepEqual(await p.evaluate(() => [deviceCalls, meetingCalls]), [[], []]);
      assert.deepEqual(await p.evaluate(() => WizAppCapture.pending('voice-outline')), []);
    });
    await test('PCM-capabilities-do-not-invent-worklet-support', async ({ p }) => {
      await p.evaluate(() => { window.AudioWorkletNode = undefined; });
      assert.equal(await p.evaluate(opts => WizAppCapture.capabilities(opts).pcm, options), false);
      assert.equal(await rejectStart(p), 'pcm_unavailable');
      assert.equal(await p.evaluate(() => WizAppCapture.getState().hold), false);
      assert.deepEqual(await p.evaluate(() => [deviceCalls, meetingCalls]), [[], []]);
    });
    // Closed means closed (James, 19 Oct 2026): a frame leaving while its window stays open keeps recording.
    await test('open-app-frame-detach-keeps-recording', async f => {
      const { p, frame } = f;
      await begin(f); await frame().waitForFunction(() => chunks.length >= 1);
      await p.evaluate(() => detachOutline());
      await p.waitForTimeout(300);
      assert.equal(await p.evaluate(() => WizAppCapture.getState().active), true);
      await p.evaluate(() => WizAppServices.appsClosed?.(['voice-outline']));
      await p.waitForTimeout(300);
      assert.equal(await p.evaluate(() => WizAppCapture.getState().active), true);
      await p.evaluate(async id => (await WizAppCapture.resume('voice-outline', id)).stop(), await p.evaluate(() => WizAppCapture.getState().id));
    });
    // ...and closing the app's last window stops its microphone at once, keeping the take for recovery.
    await test('closing-app-window-stops-its-mic-and-keeps-the-take', async f => {
      const { p, frame } = f;
      await begin(f); await frame().waitForFunction(() => chunks.length >= 1);
      const id = await frame().evaluate(() => session.id);
      assert.equal(await p.evaluate(async () => { try { await WizCore.voice().start(); return 'started'; } catch (e) { return e.code; } }), 'busy');
      await p.evaluate(() => { window.openApps = []; detachOutline(); document.querySelector('iframe').remove(); });
      await p.waitForFunction(() => !WizAppCapture.getState().active && !WizAppCapture.getState().hold, null, { timeout: 8000 });
      const pending = await p.evaluate(async () => (await WizAppCapture.pending('voice-outline')).map(r => ({ id: r.id, bytes: r.blob.size, mime: r.mime })));
      assert.equal(pending.length, 1); assert.equal(pending[0].id, id); assert.equal(pending[0].mime, 'audio/wav'); assert.ok(pending[0].bytes > 44, 'take kept');
      assert.equal(await p.evaluate(async () => { const v = WizCore.voice(); try { const ok = await v.start(); v.cancel?.(); return ok === false ? 'refused' : 'started'; } catch (e) { return e.code || e.message; } }), 'started');
    });
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  } finally {
    await browser?.close(); await new Promise(r => server.close(r));
    const receipt = { hostname: os.hostname(), sourceSHA: process.env.SOURCE_SHA || 'uncommitted-red-test', hashes: Object.fromEntries(files.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')])), receipts, errors, blocked, limitations: ['Native bridges and microphone input are synthetic fixtures; Chromium AudioWorklet, WAV, IDB, Web Locks and hosted facade are real.', 'No Android build, physical-device or background OS survival acceptance; no backend transcription or production writes.'] };
    fs.writeFileSync(path.join(evidence, 'outline-pcm-receipt.json'), JSON.stringify(receipt, null, 2));
    if (!receipts.length || receipts.some(r => !r.passed)) process.exitCode = 1;
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
