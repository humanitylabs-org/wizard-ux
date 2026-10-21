// Fully synthetic desktop/outbox browser acceptance. No real service requests or credentials.
// QA_PLAYWRIGHT=/path/to/playwright-core QA_CHROME=/path/to/chrome node qa-recording-retention.cjs [webDir] [outDir]
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('./tools/qa-playwright.cjs');
const ROOT = path.resolve(process.argv[2] || 'web'), OUT = path.resolve(process.argv[3] || 'recording-evidence');
fs.mkdirSync(OUT, { recursive: true });
const results = [], writes = [], errors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
const known = (name, ok, detail = '') => { results.push({ name, ok: true, known_defect: !ok, detail }); console.log(ok ? 'PASS' : 'KNOWN-DEFECT', name, detail); };
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
let b;
async function boot(storage = '', minimal = false) {
  const c = await b.newContext({ viewport: { width: 1440, height: 960 }, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  const s = { ready: false, fail: true, audio: [], writes: [], bootstrap: 0 };
  await c.addInitScript(mode => {
    localStorage.setItem('wos.coached', 'true');
    // These cases exhaust BOTH stores. Complete localStorage backup is tested separately.
    const set = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (mode && !window.__allowStorage && k.startsWith('wos.outbox.fallback')) throw new DOMException('Full backup', 'QuotaExceededError'); return set.call(this, k, v); };
    if (mode === 'blocked' || mode === 'timeout') Object.defineProperty(window, 'indexedDB', { value: { open() { const r = {}; if (mode === 'blocked') setTimeout(() => r.onblocked?.(), 0); return r; } } });
    if (mode === 'denied') Object.defineProperty(window, 'indexedDB', { value: { open() { throw new DOMException('Denied', 'SecurityError'); } } });
    if (mode === 'quota' || mode === 'abort') {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value) {
        if (window.__allowStorage) return original.call(this, value);
        if (mode === 'quota') throw new DOMException('Full', 'QuotaExceededError');
        const r = original.call(this, value); this.transaction.abort(); return r;
      };
    }
  }, storage);
  await c.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (u.origin !== 'http://127.0.0.1:9497') return route.abort();
    if (p === '/wizard/v1/bootstrap') { s.bootstrap++; return json({ bootstrap: 1, settings: { agent: { name: 'QA Wizard' } }, capabilities: { voice: s.ready }, endpoints: { transcribe: s.ready ? '/wizard/voice/transcribe' : '' } }); }
    if (p === '/wizard/voice/transcribe') {
      const data = req.postDataBuffer(); s.audio.push(hash(data));
      return json(s.fail ? { error: 'Synthetic transcription failure' } : { text: 'retained dictation words', model: 'fixture-only' }, s.fail ? 503 : 200);
    }
    if (p === '/wizard/thread-seen') return json({}); // shell bookkeeping, fenced too
    if (!['GET', 'HEAD'].includes(req.method())) {
      s.writes.push(p); writes.push(p);
      if (p === '/wizard/files/upload') return json({ file: { id: 'qa-audio', filename: 'qa.webm', mime: req.headers()['x-wizard-mime'], bytes: req.postDataBuffer().length } }, 201);
      if (s.accept && p === '/wizard/hermes/api/sessions') return json({ id: 'qa-session' }, 201);
      if (s.accept && p === '/wizard/hermes/v1/runs') return json({ run_id: 'qa-run', status: 'queued' }, 202);
      return json({ error: 'Synthetic write fence' }, 409);
    }
    if (p === '/minimal') return route.fulfill({ contentType: 'text/html', body: '<script src="/wizard-os-home/core/config.js"></script><script>window.WosModels={snapshot:()=>({model:"qa-model",provider:"qa-provider"}),resolveRoute:async x=>x}</script><script src="/wizard-os-home/outbox.js"></script>' });
    if (p.startsWith('/wizard-os-home/')) {
      const f = path.resolve(ROOT, p.slice('/wizard-os-home/'.length) || 'index.html');
      if (f.startsWith(ROOT + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ path: f, contentType: /\.js$/.test(f) ? 'text/javascript' : /\.css$/.test(f) ? 'text/css' : /\.html$/.test(f) ? 'text/html' : undefined });
      return route.fulfill({ status: 404, body: '' });
    }
    if (p.includes('/apps')) return json({ apps: [] });
    if (p.includes('/sessions')) return json({ data: [] });
    return json({});
  });
  const p = await c.newPage(); p.on('pageerror', e => errors.push(String(e)));
  const url = 'http://127.0.0.1:9497/' + (minimal ? 'minimal' : 'wizard-os-home/desktop.html?shell=desktop');
  await p.goto(url); await p.waitForFunction(() => window.WosOutbox && window.WizConfig);
  if (!minimal) await p.waitForFunction(() => window.__wux);
  await p.evaluate(() => WizConfig.ready);
  return { c, p, s, url };
}
async function ready(p, s) {
  s.ready = true;
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForFunction(() => WizConfig.has('voice'));
}
// Daily 2f50f0d paused the PWA's Right Option key (the system voice tool owns it). The remaining PWA trigger
// for the desktop recorder is the command palette's "Dictate" command (Cmd+K, "Dictate", Enter), which
// toggles exactly like the key did: once to start, once to finish.
async function paletteDictate(p) {
  await p.keyboard.press('Meta+KeyK');
  await p.waitForFunction(() => !document.querySelector('#palette').hidden);
  await p.keyboard.type('Dictate');
  await p.waitForFunction(() => /Dictate/.test(document.querySelector('#palList .sel')?.textContent || ''));
  await p.keyboard.press('Enter');
}
async function take(p) {
  await paletteDictate(p); await p.waitForFunction(() => !document.querySelector('#voicePill').hidden && document.querySelector('#voicePill').classList.contains('dict'));
  await p.waitForTimeout(1500); await paletteDictate(p); await p.waitForTimeout(1500);
}
(async () => {
  b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  {
    const { c, p, s } = await boot();
    check('initially unavailable hides mic', await p.locator('#micBtn').isHidden());
    check('initial bootstrap marks mic hidden', await p.locator('#micBtn').evaluate(el => el.hidden));
    await ready(p, s);
    check('unavailable → ready reveals mic without reload', await p.locator('#micBtn').isVisible() && !await p.locator('#micBtn').evaluate(el => el.hidden));
    await take(p);
    const held = await p.evaluate(() => [...WosOutbox._items.values()].find(x => x.kind === 'dictation'));
    check('failed dictation retains audio in existing outbox', !!held?.audio && s.audio.length === 1);
    if (held) {
      check('failed dictation has visible Retry and Download', await p.locator('#recordingRecovery').isVisible() && /Retry/.test(await p.locator('#recordingRecovery').innerText()) && /Download/.test(await p.locator('#recordingRecovery').innerText()));
      await p.screenshot({ path: path.join(OUT, 'failed-dictation.png') });
      const id = held.id;
      await p.reload(); await p.evaluate(() => WosOutbox.load());
      check('reload restores the same take and audio bytes', await p.evaluate(async id => { const it = WosOutbox.get(id); return !!it?.audio?.size; }, id));
      check('restored take does not auto-transcribe or send', s.audio.length === 1 && s.writes.length === 0);
      s.fail = false;
      await p.locator(`[data-record-retry="${id}"]`).click();
      await p.waitForTimeout(800);
      check('retry uses byte-identical original audio', s.audio.length === 2 && s.audio[0] === s.audio[1], s.audio.join(' '));
      check('successful retry exposes recovered transcript without sending', await p.locator('#recordingRecovery textarea').inputValue() === 'retained dictation words' && s.writes.length === 0);
      await p.reload(); await p.evaluate(() => WosOutbox.load());
      check('successful recovered transcript AND audio survive reload', await p.evaluate(id => { const it = WosOutbox.get(id); return it?.text === 'retained dictation words' && it.audio.size > 0; }, id));
      await p.screenshot({ path: path.join(OUT, 'recovered-dictation.png') });
    }
    check('dictation never creates runs, sessions, uploads', s.writes.length === 0, s.writes.join(','));
    await c.close();
  }
  for (const mode of ['blocked', 'denied', 'quota', 'abort', 'timeout']) {
    const { c, p, s } = await boot(mode);
    await ready(p, s); await take(p); await p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.kind==='dictation'&&x.state==='held'&&x.storageError&&x.error));
    const status = await p.evaluate(() => [...WosOutbox._items.values()].map(it => ({ id: it.id, kind: it.kind, bytes: it.audio?.size, durable: it.durable, storageError: it.storageError })));
    check(`${mode}: failed storage retains live audio`, status.some(x => x.kind === 'dictation' && x.bytes > 0 && x.durable === false && x.storageError), JSON.stringify(status));
    if (status.length) {
      check(`${mode}: warning explicitly says reload unsafe and offers Download`, /not saved|not save/i.test(await p.locator('#recordingRecovery').innerText()) && /reload/i.test(await p.locator('#recordingRecovery').innerText()));
      const it = status[0];
      check(`${mode}: unsafe reload is guarded and no audio-less fallback claims recovery`, await p.evaluate(id => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented && !JSON.parse(localStorage.getItem('wos.outbox.fallback') || '[]').some(x => x.id === id); }, it.id));
      const download = p.waitForEvent('download'); await p.locator(`[data-record-download="${it.id}"]`).click();
      const d = await download, dest = path.join(OUT, `${mode}-recovery.webm`); await d.saveAs(dest);
      const digest = hash(fs.readFileSync(dest));
      check(`${mode}: Download preserves the exact transcription bytes`, digest === s.audio[0], digest);
      await p.screenshot({ path: path.join(OUT, `${mode}-storage.png`) });
      s.fail = false;
      await p.locator(`[data-record-retry="${it.id}"]`).click();
      await p.waitForFunction(id => WosOutbox.get(id)?.text === 'retained dictation words' && WosOutbox.get(id)?.state === 'held', it.id);
      check(`${mode}: successful STT cannot discard non-durable audio`, await p.evaluate(id => { const it = WosOutbox.get(id); return it?.audio.size > 0 && !it.durable && !!it.storageError; }, it.id));
      if (mode === 'quota' || mode === 'abort') {
        await p.evaluate(() => { window.__allowStorage = true; });
        s.fail = false; await p.locator(`[data-record-retry="${it.id}"]`).click(); await p.waitForTimeout(700);
        await p.reload(); await p.evaluate(() => WosOutbox.load());
        check(`${mode}: storage recovery persists same take across reload`, await p.evaluate(id => { const it = WosOutbox.get(id); return it?.durable && it.audio.size > 0 && it.text === 'retained dictation words'; }, it.id));
      }
    }
    await c.close();
  }
  {
    const { c, p, s } = await boot('quota', true); await ready(p, s);
    await p.evaluate(() => WosOutbox.enqueue({ audio: new Blob(['synthetic same audio bytes'], { type: 'audio/webm' }), model: 'qa-model', provider: 'qa-provider' }));
    await p.waitForTimeout(200);
    check('chat audio persistence failure protects bytes by upload before admission', s.writes.includes('/wizard/files/upload') && !s.writes.includes('/wizard/hermes/v1/runs'));
    check('chat audio persistence failure is visible and retains sole audio', await p.evaluate(() => WosOutbox.unsent().some(it => it.audio?.size && it.storageError && ['waiting','failed'].includes(it.state))));
    await c.close();
  }
  // The native adapter owns Parakeet preparation. Exercise only its JS capability/transcriber seam.
  {
    const { c, p, s } = await boot();
    await p.evaluate(() => {
      const has = WizConfig.has.bind(WizConfig);
      window.__nativeReady = false; window.__nativeFail = true; window.__nativeBytes = [];
      WizConfig.has = cap => cap === 'voice' ? window.__nativeReady : has(cap);
      WizConfig.transcribe = async blob => {
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        __nativeBytes.push([...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join(''));
        if (__nativeFail) throw new Error('Synthetic native transcriber failure');
        return { text: 'native seam recovered words' };
      };
      dispatchEvent(new CustomEvent('wizard:config'));
    });
    check('native seam initially unavailable hides mic', await p.locator('#micBtn').isHidden());
    await p.evaluate(() => { __nativeReady = true; dispatchEvent(new CustomEvent('wizard:config')); });
    check('native readiness event reveals mic without bootstrap or reload', await p.locator('#micBtn').isVisible() && !await p.locator('#micBtn').evaluate(el => el.hidden));
    await take(p);
    const id = await p.evaluate(() => [...WosOutbox._items.values()].find(it => it.kind === 'dictation')?.id);
    check('native transcriber failure retains recording', !!id);
    if (id) {
      await p.evaluate(id => { __nativeFail = false; return WosOutbox.transcribeDictation(id); }, id);
      check('native retry uses same bytes with zero HTTP fallback', await p.evaluate(() => __nativeBytes.length === 2 && __nativeBytes[0] === __nativeBytes[1]) && s.audio.length === 0 && s.writes.length === 0);
    }
    await c.close();
  }
  // Successful immediate dictation: the transcript is consumed once and the take leaves the recovery store.
  {
    const { c, p, s } = await boot(); await ready(p, s); s.fail = false;
    await p.evaluate(() => { const t = document.createElement('textarea'); t.id = 'qa-input'; t.value = 'before'; document.body.appendChild(t); t.focus(); t.setSelectionRange(6, 6); });
    await take(p);
    check('Right Option stays paused (no PWA dictation from the key)', await (async () => { await p.keyboard.press('AltRight'); await p.waitForTimeout(300); return p.locator('#voicePill').isHidden(); })());
    check('successful dictation transcribes once with no agent sends', s.audio.length === 1 && s.writes.length === 0 && await p.evaluate(() => window.__wuxLastDictation === 'retained dictation words'));
    check('consumed dictation is removed from recovery store', await p.evaluate(() => [...WosOutbox._items.values()].every(it => it.kind !== 'dictation')));
    // Known daily defect, reproduced on daily dfb1150 without the retention fix: the palette is still the focused
    // element when Dictate starts, so the transcript lands in the hidden palette input instead of the field the
    // user was in. Recorded, not gating this harness (it is not a retention regression).
    known('palette dictation inserts at the field focused before the palette', await p.locator('#qa-input').inputValue() === 'before retained dictation words',
      `field=${JSON.stringify(await p.locator('#qa-input').inputValue())} palette=${JSON.stringify(await p.locator('#palInput').inputValue())}`);
    await c.close();
  }
  // Shared phone/desktop outbox: raw HTTP transcription failure/reload/retry and admission.
  {
    const { c, p, s } = await boot('', true); await ready(p, s);
    const id = await p.evaluate(async () => (await WosOutbox.enqueue({ audio: new Blob(['synthetic shared recording'], { type: 'audio/webm' }), model: 'qa-model', provider: 'qa-provider' })).id);
    await p.waitForFunction(id => WosOutbox.get(id)?.state === 'waiting', id);
    check('shared chat STT failure retains durable original audio', await p.evaluate(id => WosOutbox.get(id)?.durable && WosOutbox.get(id)?.audio.size > 0, id));
    await p.reload(); await p.evaluate(() => WosOutbox.load());
    check('shared chat failed recording survives reload', await p.evaluate(id => WosOutbox.get(id)?.audio.size > 0, id));
    s.fail = false; s.accept = true;
    await p.evaluate(id => WosOutbox.retry(id), id);
    await p.waitForFunction(id => WosOutbox.get(id)?.state === 'sent', id);
    check('shared chat retry transcribes identical bytes via unchanged HTTP route', s.audio.length >= 2 && s.audio.every(x => x === s.audio[0]), s.audio.join(' '));
    check('shared chat success performs one synthetic admission and releases uploaded audio', s.writes.filter(x => x === '/wizard/hermes/v1/runs').length === 1 && await p.evaluate(id => !WosOutbox.get(id).audio, id));
    await c.close();
  }
  check('no uncaught browser errors', errors.length === 0, errors.join('\n'));
  await b.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, writes, errors }, null, 2));
  process.exitCode = results.some(x => !x.ok) ? 1 : 0;
})().catch(async e => { console.error(e); if (b) await b.close(); fs.writeFileSync(path.join(OUT, 'fatal.txt'), String(e.stack)); process.exitCode = 2; });
