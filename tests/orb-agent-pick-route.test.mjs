import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

// (fixture copied from outbox-voice-reload-handoff) Reload waited 5-10 s behind a six-minute voice note's upload + transcription. A tap take whose
// destination is fixed is handed to the outbox; a reload mid-send must finish that SAME send on the new page, once.
const source = readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8');
const sessionId = 'wizard_philosopher';

function client(origin, rows = new Map(), transcribe = async () => ({ text: 'six minutes of philosophy' })) {
  const timers = new Set();
  const indexedDB = { open() {
    const r = {};
    queueMicrotask(() => {
      r.result = { close() {}, objectStoreNames: { contains: () => true }, transaction() {
        const tx = { objectStore() { return {
          getAll() { return { result: [...rows.values()].map(x => structuredClone(x)) }; },
          put(value) { rows.set(value.id, structuredClone(value)); return {}; },
          delete(id) { rows.delete(id); return {}; },
        }; } };
        setImmediate(() => tx.oncomplete?.()); return tx;
      } }; r.onsuccess();
    }); return r;
  } };
  const ctx = { console, Blob, AbortController, AbortSignal, indexedDB, crypto: { randomUUID },
    document: { documentElement: { dataset: {} }, body: null, addEventListener() {} },
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    addEventListener() {}, clearTimeout,
    setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); timers.add(t); return t; },
    fetch: (path, init) => fetch(origin + path, init),
    WosModels: { snapshot: (_, route) => route, resolveRoute: async route => route },
    WosAgents: { isOther: id => !!id && id !== 'hermes' },
    WizConfig: { transcribe, voicePrompt: () => '' },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  return { api: ctx.WosOutbox, rows, close: () => { for (const t of timers) clearTimeout(t); } };
}

// James, 22 Oct 2026: he held the Two orbs agent orb, picked "Archimedes (new)", and the voice note went to the main
// agent as a new thread. A general take stages with no view, so the staged item lost route.agent; enqueue then reused
// that held item and never re-applied the agent.
test('an orb-picked agent survives staging and enqueue of a general take', async t => {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    calls.push({ path: req.url, body: Buffer.concat(chunks).toString() });
    res.writeHead(req.url.startsWith('/wizard/hermes/v1/runs') ? 202 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/wizard/files/upload' ? { file: { id: 'drop_voice', filename: 'v.aac', mime: 'audio/aac', bytes: 4 } } : { run_id: 'wizardq_x', status: 'running' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const c = client(`http://127.0.0.1:${server.address().port}`); t.after(c.close);
  // the pre-fix staging path: route spread first, then agent overwritten with ''
  const staged = await c.api.stage({ kind: 'new', sessionId: '', model: 'm', provider: 'p', audio: new Blob(['aaaa'], { type: 'audio/aac' }), intent: 'auto', source: 'orb', agent: '' });
  const it = await c.api.enqueue({ kind: 'new', custodyId: staged.id, agent: 'archimedes-new', model: 'm', provider: 'p', intent: 'auto', text: '' });
  assert.equal(it.agent, 'archimedes-new');
  const run = await (async () => { for (let i = 0; i < 400; i++) { const r = calls.find(x => x.path.startsWith('/wizard/hermes/v1/runs')); if (r) return r; await new Promise(r => setTimeout(r, 5)); } return null; })();
  assert.ok(run, 'a run was posted');
  assert.equal(run.path, '/wizard/hermes/v1/runs?agent=archimedes-new');
  assert.ok(calls.some(x => x.path === '/wizard/hermes/api/sessions?agent=archimedes-new'), 'session created in the agent store');
});

test('the voice finish path keeps a general take\'s route agent when there is no view', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(app, /agent: sv\?\.agent \|\| snap\.route\?\.agent \|\| ''/);
});
