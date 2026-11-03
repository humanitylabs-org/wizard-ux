import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// The exact same assertions/fixtures run against the pinned proposal and the working tree.
const revision = process.env.AUTOMATIC_DELIVERY_SOURCE_REV;
const source = path => revision
  ? execFileSync('git', ['show', `${revision}:${path}`], { cwd: new URL('../', import.meta.url), encoding: 'utf8' })
  : readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const core = source('web/core/core.js');
const live = source('web/live.js');
const search = source('web/core/chat-search.js');
const prompt = label => `[${label}] Please share the complete Daily Brief report exactly as saved.`;

function context() {
  const ctx = { console, setTimeout, clearTimeout, AbortController, DOMException, URL, Intl, Date,
    localStorage: { getItem: () => null }, document: {}, navigator: {} };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx); vm.runInContext(core, ctx);
  return ctx;
}
function normalizer() {
  const ctx = context();
  const start = live.indexOf('  const READY_OR_ATTENTION');
  const end = live.indexOf('  /* ---- thread-seen');
  assert.ok(start > 0 && end > start);
  vm.runInContext(`${live.slice(start, end)}\nthis.normalize = normalize;`, ctx);
  return ctx.normalize;
}
const frozenRow = overrides => Object.freeze({
  listVersion: 1, id: 'synthetic-daily', title: 'Daily Brief', status: 'failed',
  previewRole: 'user', previewAt: '2026-11-03T15:00:00Z',
  retryRunId: 'synthetic-retry', wizard_retry_input: 'Exact retry contents\n  preserved.',
  ...overrides,
});

for (const label of ['AUTO', 'Nebula:']) {
  test(`compact ${label} user delivery preview is hidden without mutating input or retry fields`, () => {
    const normalize = normalizer();
    const input = frozenRow({ preview: prompt(label) });
    const before = JSON.stringify(input);
    const row = normalize(input);
    assert.equal(row.preview, '');
    assert.equal(row.previewRole, undefined);
    assert.equal(row.previewAt, input.previewAt);
    assert.equal(row.retryRunId, input.retryRunId);
    assert.equal(row.wizard_retry_input, input.wizard_retry_input);
    assert.equal(row.request, '', 'compact rows still require detail hydration for retry');
    assert.equal(row.detailNeeded, true);
    assert.equal(row.runtime, 'direct');
    assert.equal(JSON.stringify(input), before);
  });
  test(`compact ${label} assistant delivery text stays visible`, () => {
    const input = frozenRow({ previewRole: 'assistant', preview: prompt(label) });
    const row = normalizer()(input);
    assert.equal(row.preview, input.preview);
    assert.equal(row.previewRole, 'assistant');
  });
}
test('compact ordinary AUTO messages and unknown-role previews remain unchanged', () => {
  const normalize = normalizer();
  for (const input of [
    frozenRow({ preview: '[AUTO] Keep this visible.' }),
    frozenRow({ preview: '[Nebula:] Keep this visible.' }),
    frozenRow({ preview: 'Please share the complete Daily Brief report exactly as saved.' }),
    frozenRow({ preview: prompt('AUTO'), previewRole: undefined }),
  ]) {
    const row = normalize(input);
    assert.equal(row.preview, input.preview);
    assert.equal(row.previewRole, input.previewRole);
  }
});
test('full rows retain exact explicit retry input and assistant delivery text', () => {
  const raw = prompt('AUTO');
  const input = Object.freeze({ id: 'full-row', status: 'failed',
    latest_message: Object.freeze({ role: 'assistant', content: raw }),
    last_user_message: Object.freeze({ role: 'user', content: raw }),
    wizard_retry_input: '  Exact retry\ncontents.  ' });
  const row = normalizer()(input);
  assert.equal(row.preview, raw);
  assert.equal(row.previewRole, 'assistant');
  assert.equal(row.request, input.wizard_retry_input);
});
test('authoritative server body hits survive when not every query word fits in the excerpt', async () => {
  const ctx = context();
  const rows = [{ id: 'server-body-hit', title: 'Security', preview: '', searchSnippet: 'Daily updates continue beyond this excerpt.' }];
  ctx.WizLive = { ok: true, sessions: [], searchRows: () => [], rememberSearch() {},
    async searchSessions(_q, _agent, _signal, onBatch) {
      onBatch(rows); const result = [...rows]; result.fallbackScopes = []; return result;
    } };
  vm.runInContext(search, ctx);
  const result = ctx.WizCore.chatSearch.query('server-excerpt', 'daily report', () => {});
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(result.hits.has('server-body-hit'), true);
  assert.equal(result.hits.get('server-body-hit').snippet, rows[0].searchSnippet);
  ctx.WizCore.chatSearch.reset();
});
for (const excerpt of [prompt('AUTO'), '[AUTO] Please share the complete Daily security considerations report exactly as save…']) {
  test(`server publication and cache seeding do not recover a concealed preview: ${excerpt.slice(-12)}`, async () => {
    const ctx = context();
    const rows = [
      { id: 'preview-only', title: 'Security', preview: excerpt, searchSnippet: '' },
      { id: 'clipped-only', title: 'Security', preview: excerpt, searchSnippet: excerpt },
      { id: 'title-match', title: 'Daily Report', preview: excerpt, searchSnippet: excerpt },
    ];
    ctx.WizLive = { ok: true, sessions: rows, searchRows: () => rows, rememberSearch() {},
      async searchSessions(_q, _agent, _signal, onBatch) {
        onBatch(rows); const result = [...rows]; result.fallbackScopes = []; return result;
      } };
    vm.runInContext(search, ctx);
    const result = ctx.WizCore.chatSearch.query('hidden-preview', 'daily report', () => {});
    assert.equal(result.hits.has('preview-only'), false, 'synchronous seed must not expose preview');
    assert.equal(result.hits.has('clipped-only'), false);
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(result.hits.has('clipped-only'), false, 'hidden-only excerpts do not establish a visible match');
    for (const hit of result.hits.values()) {
      assert.doesNotMatch(hit.snippet, /\[AUTO\]|Please share the complete/);
      assert.doesNotMatch(hit.html, /\[AUTO\]|Please share the complete/);
    }
    assert.equal(result.hits.has('title-match'), true, 'independent visible title survives');
    ctx.WizCore.chatSearch.reset();
  });
}
