import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const core = read('../web/core/core.js');
const kit = read('../web/core/chat-kit.js');
const live = read('../web/live.js');
const search = read('../web/core/chat-search.js');

function context() {
  const ctx = {
    window: null,
    globalThis: null,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) },
    addEventListener() {},
    setTimeout,
    clearTimeout,
    AbortController,
    DOMException,
    console,
    URL,
    Intl,
    Date,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(core, ctx);
  return ctx;
}

const prompt = label => `[${label}] Please share the complete Daily Brief report exactly as saved.`;

test('the shared marker recognizes only automatic report-delivery prompts', () => {
  const { WizCore } = context();
  for (const label of ['AUTO', 'Nebula:']) assert.equal(WizCore.isAutomaticPrompt(prompt(label)), true, label);
  for (const words of [
    '[AUTO] Keep this visible.',
    '[Nebula:] Keep this visible.',
    '[AUTO] Please share the complete report exactly as saved.',
    'Please share the complete Daily Brief report exactly as saved.',
  ]) assert.equal(WizCore.isAutomaticPrompt(words), false, words);
});

test('automatic delivery prompts stay out of the transcript while the finished Nebula message remains', () => {
  const ctx = context();
  vm.runInContext(kit, ctx);
  for (const label of ['AUTO', 'Nebula:']) {
    const turns = ctx.WosChat.parseRows([
      { role: 'user', content: prompt(label), timestamp: 1 },
      { role: 'assistant', content: 'Morning brief\n\nToday is clear.', timestamp: 2 },
    ]);
    assert.equal(turns.length, 1, label);
    assert.equal(turns[0].u, null, `${label}: no user-style automation bubble`);
    assert.equal(turns[0].a.text, 'Morning brief\n\nToday is clear.');
  }
  const manual = ctx.WosChat.parseRows([
    { role: 'user', content: '[Nebula:] Keep this visible.', timestamp: 1 },
    { role: 'assistant', content: 'Visible.', timestamp: 2 },
  ]);
  assert.equal(manual[0].u.text, '[Nebula:] Keep this visible.');
});

function normalizer() {
  const ctx = context();
  const start = live.indexOf('  const READY_OR_ATTENTION');
  const end = live.indexOf('  /* ---- thread-seen');
  assert.ok(start > 0 && end > start, 'live.js normalizer block found');
  vm.runInContext(`${live.slice(start, end)}\nthis.normalize = normalize;`, ctx);
  return ctx.normalize;
}

test('automatic delivery prompts stay out of chat-list previews but remain available for retry', () => {
  const normalize = normalizer();
  const raw = prompt('Nebula:');
  const row = normalize({
    id: 'wizard_daily',
    status: 'running',
    wizard_started_at: '2026-11-03T15:00:00Z',
    wizard_last_user_at: '2026-11-03T15:00:00Z',
    wizard_request_preview: raw,
    last_user_message: { role: 'user', content: raw, timestamp: '2026-11-03T15:00:00Z' },
    latest_message: { role: 'user', content: raw, timestamp: '2026-11-03T15:00:00Z' },
    preview: raw,
  });
  assert.equal(row.preview, '');
  assert.equal(row.previewRole, undefined);
  assert.equal(row.request, raw);
});

test('message search never exposes an automatic delivery prompt as its result snippet', async () => {
  const ctx = context();
  const raw = '[AUTO] Please share the complete Daily security considerations · Tue, Nov 3 report exactly as save…';
  const rows = [
    { id: 'prompt-only', title: 'Security', preview: raw, searchSnippet: raw, updatedAt: '2026-11-03T15:00:00Z' },
    { id: 'visible-match', title: 'Daily Brief', preview: 'Daily Report link', searchSnippet: raw, updatedAt: '2026-11-03T15:00:00Z' },
  ];
  ctx.WizLive = {
    ok: true,
    sessions: rows,
    searchRows: () => rows,
    cardAt: s => s.updatedAt,
    rememberSearch() {},
    async searchSessions(_q, _agent, _signal, onBatch) {
      onBatch(rows);
      const out = [...rows]; out.fallbackScopes = []; return out;
    },
  };
  vm.runInContext(search, ctx);
  const result = ctx.WizCore.chatSearch.query('window', 'daily report', () => {});
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(result.hits.has('prompt-only'), false, 'prompt-only server hit is not a visible result');
  assert.equal(result.hits.has('visible-match'), true, 'a visible title or preview can still match');
  assert.doesNotMatch(result.hits.get('visible-match').snippet, /\[AUTO\]|Please share the complete/);
});
