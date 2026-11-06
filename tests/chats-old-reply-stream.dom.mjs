import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// James, 1 Nov 2026: a settled earlier run replayed below the newest answer.
// Load whole production modules, including the real SSE accumulation and thread renderer.
// No network, service workers, sends or production data: every transport is a fixture.
const A = 'It is a 48 KB file of login keys and settings from Buzz. Keep it private.';
const B = 'Noted: the Buzz keys file stays where it is.';
const SID = 'fixture_old_reply';
const source = path => readFileSync(new URL('../web/' + path, import.meta.url), 'utf8');
const row = (role, content, n) => ({ role, content, timestamp: 1793500000 + n });
const rows = [row('user', 'What is that file?', 0), row('assistant', A, 1), row('user', 'Keep', 2), row('assistant', B, 3)];

function harness({ status = 'running', pending = false, transcript = rows } = {}) {
  const dom = new JSDOM('<div id="root"><div data-chats="chat"></div></div>', {
    url: 'https://wizard.invalid/wizard-os-home/desktop.html', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const win = dom.window, frames = new Map(), timers = new Map(), sources = [], requests = [];
  // Defer ordinary boot polls/outbox subscription on the controlled timer queue.
  Object.defineProperty(win.document, 'readyState', { value: 'complete' });
  let serial = 0;
  win.requestAnimationFrame = fn => { frames.set(++serial, fn); return serial; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.setTimeout = (fn, ms) => { timers.set(++serial, { fn, ms }); return serial; };
  win.clearTimeout = id => timers.delete(id);
  win.setInterval = () => ++serial;
  win.clearInterval = () => {};
  win.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET'; requests.push({ url: String(url), method });
    assert.equal(method, 'GET', 'all non-read requests are blocked');
    if (String(url).includes('/messages?')) return { ok: true, json: async () => ({ messages: transcript, has_more: false }) };
    return { ok: false, status: 503, json: async () => ({}) };
  };
  win.EventSource = class {
    constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; sources.push(this); }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    close() { this.closed = true; }
    emit(data) { if (!this.closed) this.onmessage({ type: 'message', data: JSON.stringify(data) }); }
  };
  win.WizConfig = { agent: () => 'Fixture Wizard', timeZone: () => 'Asia/Tokyo', dayStart: now => Math.floor(now / 86400000) * 86400000 };
  win.WizBrand = { html: '' };
  for (const file of ['core/core.js', 'core/chat-kit.js', 'core/chats-list-model.js', 'live.js', 'core/chats.js']) win.eval(source(file));
  const live = win.WizLive;
  live.sessions = [{ id: SID, runtime: 'direct', title: 'Old replay fixture', status, runId: pending ? 'run-B' : 'run-A', updatedAt: new Date().toISOString() }];
  const items = pending ? [{ id: 'old-send', kind: 'reply', state: 'sent', runId: 'run-A', sessionId: SID, text: 'What is that file?', files: [], sentAt: Date.now() - 30000, createdAt: Date.now() - 35000 }] : [];
  // Install after live.js: exercise pendingRun's real bounded outbox fallback before boot subscription.
  win.WosOutbox = { forThread: () => items, onChange() {}, _items: new Map(), unsent: () => [], quarantined: () => false,
    landed: id => { const i = items.findIndex(it => it.id === id); if (i >= 0) items.splice(i, 1); } };
  const w = { id: 'chat', app: 'chats', thread: SID };
  const chats = win.WizCore.chats({ win: id => id === w.id ? w : null, root: () => win.document.querySelector('#root'), visible: () => [w.id], save() {}, layout() {}, toast() {}, title: () => 'Old replay fixture', viewContext() {} });
  const el = win.document.querySelector('[data-chats]'), c = chats.ch(w.id);
  Object.assign(c, { turns: chats.toTurns(transcript), loadedFor: SID, loadedNav: c.readNav });
  const paint = () => chats.renderThread(w, el);
  const flush = () => { for (let n = 0; frames.size && n < 20; n++) { const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(); } assert.equal(frames.size, 0); };
  const emit = (text, { terminal = true, seq = 0 } = {}) => {
    const stream = sources.at(-1); assert.ok(stream, 'real live.js opened the run stream');
    stream.emit({ event: 'message.delta', session_id: SID, run_id: 'run-A', seq, delta: text });
    if (terminal) stream.emit({ event: 'run.completed', session_id: SID, run_id: 'run-A', seq: seq + 1 });
    flush();
  };
  return { win, chats, live, w, c, el, sources, requests, timers, paint, flush, emit,
    answers: () => [...el.querySelectorAll('.msg.a > .bub')].map(n => n.textContent),
    close: () => { chats.forget(w.id); dom.window.close(); },
  };
}

for (const pending of [false, true]) test(`old run A cannot paint below newer answer B (${pending ? 'recent outbox run outranks current run' : 'stale working session run'})`, async () => {
  const h = harness({ pending, status: pending ? 'completed' : 'running' });
  try {
    h.paint(); h.flush();
    assert.deepEqual(h.answers(), [A, B], 'initial transcript contains each answer once');
    assert.equal(h.c.stream.rid, 'run-A');
    const baseline = h.c.stream.baseline;
    h.emit(A);
    const evidence = { pending, baseline, answers: h.answers(), streaming: h.el.querySelector('[data-streaming]')?.outerHTML || null, landed: h.c.stream.landed, sourceClosed: h.sources[0].closed };
    if (process.env.QA_EVIDENCE_DIR) {
      mkdirSync(process.env.QA_EVIDENCE_DIR, { recursive: true });
      writeFileSync(`${process.env.QA_EVIDENCE_DIR}/${pending ? 'pending' : 'stale'}.json`, JSON.stringify(evidence, null, 2));
      writeFileSync(`${process.env.QA_EVIDENCE_DIR}/${pending ? 'pending' : 'stale'}.html`, h.el.outerHTML);
    }
    assert.equal(h.answers().filter(x => x === A).length, 1, 'old answer A must occur once, not twice below B');
    assert.deepEqual(h.answers(), [A, B]);
    assert.equal(h.el.querySelector('[data-streaming]'), null);
    assert.equal(h.c.stream.baseline, baseline, 'latest answer was already in baseline when stream opened');
    assert.equal(h.c.stream.landed, true);
    assert.equal(h.sources[0].closed, true, 'replayed stream is disposed in the same paint');
    h.paint(); h.flush(); assert.equal(h.sources.length, 1, 'stale list does not reopen retired stream');
    assert.ok(h.requests.every(r => r.method === 'GET'));
    await Promise.resolve();
  } finally { h.close(); }
});

test('a genuinely new stream remains visible until a new transcript answer lands', () => {
  const h = harness();
  try {
    h.paint(); h.emit('A genuinely new answer, not present in this transcript.', { terminal: false });
    assert.equal(h.c.stream.landed, false);
    assert.equal(h.el.querySelector('[data-streaming] .bub').textContent, 'A genuinely new answer, not present in this transcript.');
    h.c.turns = h.chats.toTurns([...rows, row('user', 'Next', 4), row('assistant', 'A genuinely new answer, not present in this transcript.', 5)]);
    h.paint(); assert.equal(h.c.stream.landed, true); assert.equal(h.el.querySelector('[data-streaming]'), null);
  } finally { h.close(); }
});

test('a longer new answer ending like an old short answer is not retired', async () => {
  const h = harness({ transcript: [row('user', 'First?', 0), row('assistant', 'Yes.', 1), ...rows] });
  try {
    h.paint(); h.emit('Here is the new explanation with additional words. Yes.');
    assert.equal(h.c.stream.landed, false);
    assert.match(h.el.querySelector('[data-streaming] .bub').textContent, /additional words\. Yes\.$/);
    // The terminal snapshot starts a transcript read. Dispose before it lands,
    // while the host deliberately still returns the old window record.
    h.chats.forget(h.w.id);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.c.stream, null);
    assert.equal(h.c.turns.at(-1).a.text, B);
  } finally { h.close(); }
});
