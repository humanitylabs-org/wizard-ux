import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/core/config.js', import.meta.url), 'utf8');
const bootstrap = voice => ({ bootstrap: 1, settings: {}, capabilities: { voice }, endpoints: { transcribe: voice ? '/wizard/voice/transcribe' : '' } });
async function fixture(refresh) {
  const calls = [], events = [], stored = new Map();
  let boots = 0;
  const ctx = {
    Date, Intl, performance, FormData, URL,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    document: { addEventListener() {} }, location: new URL('https://wizard.example/wizard-os-home/'),
    localStorage: { getItem: () => null, setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) },
    dispatchEvent: event => events.push(event),
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      if (url === '/wizard/v1/bootstrap') {
        if (++boots === 1) return Response.json(bootstrap(false));
        return refresh(init);
      }
      return Response.json({ text: 'heard' });
    },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx); await ctx.WizConfig.ready;
  return { C: ctx.WizConfig, calls, events, stored };
}
const audio = () => new Blob(['synthetic audio'], { type: 'audio/webm' });

test('missing transcribe endpoint refreshes bootstrap once, updates config/cache, and sends the original recording once', async () => {
  const f = await fixture(() => Response.json(bootstrap(true)));
  const controller = new AbortController();
  assert.equal((await f.C.transcribe(audio(), { signal: controller.signal })).text, 'heard');
  const boots = f.calls.filter(c => c.url === '/wizard/v1/bootstrap');
  assert.equal(boots.length, 2);
  assert.equal(boots[1].init.cache, 'no-store');
  assert.equal(boots[1].init.credentials, 'same-origin');
  assert.equal(boots[1].init.signal, controller.signal);
  assert.equal(f.calls.find(c => c.init.method === 'POST').init.signal, controller.signal);
  assert.equal(f.C.has('voice'), true);
  assert.equal(JSON.parse(f.stored.get('wux.bootstrap.v1')).capabilities.voice, true);
  assert.equal(f.events.at(-1).detail.capabilities.voice, true);
  assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1);
  await f.C.transcribe(audio());
  assert.equal(f.calls.filter(c => c.url === '/wizard/v1/bootstrap').length, 2, 'known endpoint does not refresh again');
});

test('a cancelled bootstrap recheck preserves abort instead of calling the take no_voice', async () => {
  const controller = new AbortController();
  const f = await fixture(init => {
    assert.equal(init.signal, controller.signal);
    controller.abort();
    throw controller.signal.reason;
  });
  await assert.rejects(f.C.transcribe(audio(), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 0);
});

for (const outcome of ['still off', 'HTTP failure', 'network failure']) {
  test(`refresh ${outcome}: no_voice only after one recheck; no audio POST`, async () => {
    const f = await fixture(() => {
      if (outcome === 'network failure') throw new TypeError('offline');
      return outcome === 'HTTP failure' ? new Response('', { status: 503 }) : Response.json(bootstrap(false));
    });
    await assert.rejects(f.C.transcribe(audio()), { code: 'no_voice' });
    assert.equal(f.calls.filter(c => c.url === '/wizard/v1/bootstrap').length, 2);
    assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 0);
  });
}
