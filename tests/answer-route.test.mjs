import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createAnswerRoutePreview, sampleRows } from '../tools/answer-route-preview.mjs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const chats = read('web/core/chats.js'), live = read('web/live.js');
function kit() {
  const ctx = { location: { origin: 'https://wizard.invalid', hostname: 'wizard.invalid' }, localStorage: { getItem: () => null }, navigator: {}, document: { addEventListener() {}, querySelector: () => null }, addEventListener() {}, setTimeout, clearTimeout, URL, console };
  ctx.window = ctx; vm.runInNewContext(read('web/core/chat-kit.js'), ctx); return ctx.WosChat;
}
function label(reply, routed) {
  const src = read('web/core/chat-power.js');
  return new Function(src.slice(src.indexOf('  function answerLabel('), src.indexOf('  /* The model label inside')) + ';return answerLabel;')()(reply, routed);
}
function routeHarness(req) {
  const row = { id: 's' }, ctx = { req, J: { 'Content-Type': 'application/json' }, encodeURIComponent };
  vm.runInNewContext('this.api = {' + live.slice(live.indexOf('    async threadRoute('), live.indexOf('    /* ---- thread actions ---- */')) + '}', ctx);
  ctx.api.session = () => row; return { api: ctx.api, row };
}
test('parseRows preserves authoritative reply provenance, never guesses from model or id', () => {
  const k = kit(), rows = sampleRows(), turns = k.parseRows(rows);
  assert.equal(turns[0].a.route, undefined); assert.equal(turns[1].a.route.kind, 'opus-direct');
  assert.equal(k.parseRows([{ ...rows[3], route: { kind: 'untrusted' } }])[0].a.route, undefined);
  assert.equal(k.parseRows([{ ...rows[3], route: { kind: 'hermes' } }])[0].a.route.kind, 'hermes');
});
test('untouched replies have exactly no chip; mixed histories label default Hermes and direct replies', () => {
  assert.equal(label({ text: 'old' }, false), '');
  assert.equal(label({ route: { kind: 'hermes' } }, false), '');
  assert.match(label({ text: 'old' }, true), />Hermes<\/span>/);
  assert.match(label({ route: { kind: 'opus-direct' } }, false), />Opus direct<\/span>/);
  assert.equal(label(null, true), '');
});
test('route save uses exact thread endpoint and explicit body, then authoritative read-back', async () => {
  const calls = [], h = routeHarness(async (url, init) => { calls.push({ url, init }); return { json: async () => ({ session_id: 's', route: 'opus-direct', available: true }) }; });
  await h.api.threadRoute('s', 'opus-direct');
  assert.equal(calls.length, 2); assert.equal(calls[0].url, '/wizard/v1/threads/s/route');
  assert.equal(calls[0].init.method, 'PUT'); assert.deepEqual(JSON.parse(calls[0].init.body), { route: 'opus-direct' });
  assert.equal(calls[1].init, undefined); assert.equal(h.row.answer_route, 'opus-direct');
});
test('switch back removes optional answer_route; failed writes never paint a successful route', async () => {
  const h = routeHarness(async () => ({ json: async () => ({ session_id: 's', route: 'hermes', available: true }) }));
  h.row.answer_route = 'opus-direct'; await h.api.threadRoute('s', 'hermes'); assert.equal('answer_route' in h.row, false);
  const bad = routeHarness(async () => { throw Object.assign(Error('signed out'), { fix_url: '/wizard-claude/' }); });
  await assert.rejects(bad.api.threadRoute('s', 'opus-direct'), /signed out/); assert.equal(bad.row.answer_route, undefined);
});
test('wrong-target or unknown route responses cannot update the row', async () => {
  for (const value of [{ session_id: 'wrong', route: 'opus-direct' }, { session_id: 's', route: 'unknown' }]) {
    const h = routeHarness(async () => ({ json: async () => value }));
    await assert.rejects(h.api.threadRoute('s'), /Invalid answer route response/); assert.equal(h.row.answer_route, undefined);
  }
});
function ui({ privacy = 'standard', other = false } = {}) {
  const w = { id: 'w', thread: 's' }, c = { readNav: 1 }, row = { id: 's' };
  const ctx = { W: { w }, ch: () => c, LIVE: { session: () => row, agentOf: () => '', threadRoute: async () => ({ route: 'opus-direct' }) }, AGS: () => ({ isOther: () => other, isPrivate: a => a.privacy === 'private' }), agentRec: () => ({ privacy }), window: {}, esc: x => x, renderThreadNow() {}, rowSheet: null };
  vm.runInNewContext(chats.slice(chats.indexOf('  // One per-open route receipt.'), chats.indexOf('  /* Rename (long-press')), ctx);
  return { ctx, w, c, row };
}
test('private, confidential and other agents never expose route controls', () => {
  for (const config of [{ privacy: 'private' }, { privacy: 'confidential' }, { other: true }]) {
    const h = ui(config); assert.equal(h.ctx.canAnswerRoute(h.w), false); assert.equal(h.ctx.answerControl(h.w), '');
  }
});
test('409 hides route control and preserves visible reason', async () => {
  const h = ui(); h.ctx.LIVE.threadRoute = async () => { throw Object.assign(Error('Private agent'), { status: 409 }); };
  await h.ctx.readAnswerRoute(h.w); assert.equal(h.ctx.answerControl(h.w), ''); assert.match(h.ctx.answerNotice(h.c.answerRoute), /Private agent/);
});
test('stale route receipts cannot repaint another navigation, even to the same session', async () => {
  const h = ui(); let resolve, paints = 0;
  h.ctx.renderThreadNow = () => paints++; h.ctx.LIVE.threadRoute = () => new Promise(r => { resolve = r; });
  const pending = h.ctx.readAnswerRoute(h.w); assert.equal(paints, 1); h.c.readNav++;
  resolve({ route: 'opus-direct' }); await pending; assert.equal(paints, 1); assert.equal(h.ctx.answerState(h.w), null);
});
test('fix URLs are visible links only for safe HTTP(S) or same-origin paths', () => {
  const h = ui();
  for (const fix_url of ['/wizard-claude/', 'https://wizard.invalid/claude']) assert.match(h.ctx.answerNotice({ error: { message: 'Sign in', fix_url } }), /<a href=/);
  for (const fix_url of ['javascript:alert(1)', '//untrusted.invalid/', '/\\untrusted.invalid/']) assert.doesNotMatch(h.ctx.answerNotice({ error: { message: 'Sign in', fix_url } }), /<a href=/);
});
test('review fixture is synthetic and rejects route mutations and all other writes', async () => {
  const s = createAnswerRoutePreview(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    assert.equal((await (await fetch(base + '/__preview/receipt')).json()).synthetic, true);
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await fetch(base + '/wizard/v1/threads/sample/route', { method, body: '{}' })).status, 403);
  } finally { s.closeAllConnections(); await new Promise(r => s.close(r)); }
});
