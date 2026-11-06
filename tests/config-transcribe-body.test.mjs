import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/core/config.js', import.meta.url), 'utf8');

test('a persisted recording is materialized before the Agent Service upload', async () => {
  const calls = [];
  const ctx = {
    console, Date, Intl, performance, FormData, CustomEvent: class {},
    document: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    dispatchEvent() {}, location: new URL('https://wizard.example/wizard-os-home/'),
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      if (url === '/wizard/v1/bootstrap') return new Response(JSON.stringify({
        bootstrap: 1, capabilities: { voice: true }, endpoints: { transcribe: '/wizard/voice/transcribe' }, settings: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ text: 'heard' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx); await ctx.WizConfig.ready;
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const restored = { type: 'audio/mp4', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
  assert.equal((await ctx.WizConfig.transcribe(restored)).text, 'heard');
  const sent = calls.at(-1);
  assert.equal(sent.url, '/wizard/voice/transcribe');
  assert.notEqual(sent.init.body, restored);
  assert.equal(sent.init.body.byteLength, bytes.byteLength);
  assert.equal(sent.init.headers['Content-Type'], 'audio/mp4');
  assert.equal(sent.init.headers['X-Wizard-Filename'], 'voice.m4a');
});