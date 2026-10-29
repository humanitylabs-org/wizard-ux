import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../web/core/app-services.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../web/core/app-client.js', import.meta.url), 'utf8');
function fixture(config) {
  const calls = [], replies = [], location = new URL('https://wizard.example/wizard-os-home/'); let listener;
  const child = {location: new URL('/messenger/', location), document: {}, addEventListener(){}, postMessage(m){replies.push(m);}};
  const frame = {tagName: 'IFRAME', src: child.location.href, isConnected: true, contentWindow: child, hasAttribute: () => false, addEventListener(){}, removeEventListener(){}};
  const window = {WizCore: {apps: () => ({APPS: [{id: 'messenger', kind: 'wizard', url: '/messenger/'}]})}, dispatchEvent(){}, WizConfig: config === false ? {} : {ready: Promise.resolve(), endpoint: () => '/api/transcribe', voicePrompt: () => 'Names: Wizard.', transcribe: async (file, opts) => {calls.push({file, opts}); return {text: ' A real transcript '};}, ...config}};
  vm.runInNewContext(source, {window, location, URL, addEventListener(n, fn){if (n === 'message') listener = fn;}, setInterval(){}, setTimeout, clearTimeout, document: {hidden: false, readyState: 'loading', addEventListener(){}}, CustomEvent: class{}, navigator: {}});
  const detach = window.WizAppServices.attach(frame, {appId: 'messenger', path: '/messenger/', isVisible: () => true});
  const service = window.WizAppServices.connect(child, {});
  return {window, child, frame, service, detach, calls, replies, message: e => listener(e)};
}
const audio = () => new Blob(['ogg bytes'], {type: 'audio/ogg'});
test('installed frame uses the one configured transcriber, optional language, and returns only text', async () => {
  const f = fixture(); const file = audio();
  assert.equal((await f.service.voice.transcribe(file, {language: 'es'})).text, 'A real transcript');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].file, file);
  assert.equal(f.calls[0].opts.language, 'es'); assert.equal(f.calls[0].opts.prompt, 'Names: Wizard.');
});
test('missing endpoint is explicitly unavailable without an upstream request', async () => {
  const f = fixture({endpoint: () => ''}); assert.equal((await f.service.voice.transcribe(audio())).unavailable, true); assert.equal(f.calls.length, 0);
  assert.equal((await fixture(false).service.voice.transcribe(audio())).unavailable, true);
});
test('rejects non-Blob, empty, oversized and invalid language before calling the provider', async () => {
  const f = fixture();
  for (const b of [{size: 1, type: 'audio/ogg'}, new Blob(), new Blob([new Uint8Array(25 * 1024 * 1024 + 1)])]) await assert.rejects(f.service.voice.transcribe(b));
  await assert.rejects(f.service.voice.transcribe(audio(), {language: {toString: () => 'en'}})); assert.equal(f.calls.length, 0);
});
test('stale, detached and foreign documents cannot transcribe', async () => {
  const a = fixture(); a.child.document = {}; await assert.rejects(a.service.voice.transcribe(audio())); assert.equal(a.calls.length, 0);
  const b = fixture(); b.detach(); await assert.rejects(b.service.voice.transcribe(audio()));
  const c = fixture(); c.child.location = new URL('https://foreign.example/'); await assert.rejects(c.service.voice.transcribe(audio()));
});
test('a frame navigated during transcription cannot receive a result', async () => {
  let finish; const f = fixture({transcribe: () => new Promise(resolve => {finish = resolve;})});
  const p = f.service.voice.transcribe(audio()); await new Promise(resolve => setImmediate(resolve)); f.child.document = {}; finish({text: 'secret'}); await assert.rejects(p);
});
test('provider errors remain retryable and no_voice maps to unavailable', async () => {
  const f = fixture({transcribe: async () => {throw new Error('offline');}}); await assert.rejects(f.service.voice.transcribe(audio()), /offline/);
  const g = fixture({transcribe: async () => {throw Object.assign(new Error('none'), {code: 'no_voice'});}}); assert.equal((await g.service.voice.transcribe(audio())).unavailable, true);
});
test('postMessage transport admits voice.transcribe and the client has a long-running request', async () => {
  const f = fixture(); await f.message({origin: 'https://wizard.example', source: f.child, data: {type: 'wizard:app:request', version: 1, id: 'test-1', op: 'voice.transcribe', args: {file: audio(), language: 'en'}}});
  assert.equal(f.calls.length, 1); assert.equal(f.replies.at(-1).value.text, 'A real transcript');
  assert.match(client, /voice: Object\.freeze/); assert.match(client, /request\('voice.transcribe'.*180000/);
});
