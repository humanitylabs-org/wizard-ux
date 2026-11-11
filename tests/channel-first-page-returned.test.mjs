// wizard-ux issue 1269, item 5: the real LIVE.firstMessages (web/live.js) carries how many rows the service itself
// returned. Its view=wizard page can hold fewer rows than that (46 rows while pagination.returned says 50), and the
// Channels feed took such a page for the whole thread and undercounted long threads' replies.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const i = live.indexOf('    async firstMessages(id, agent = \'\', limit = 20) {'), j = live.indexOf('    /* One thread\'s whole history', i);
assert.ok(i > 0 && j > i);
const firstMessages = live.slice(i, j);

function harness(reply) {
  const reqs = [], ctx = { otherAgent: id => !!id && id !== 'hermes', encodeURIComponent, Number, Math, isFinite, req: async path => { reqs.push(path); return { json: async () => reply }; } };
  vm.createContext(ctx);
  vm.runInContext(`this.L={\n${firstMessages}\n};`, ctx);
  return { L: ctx.L, reqs };
}
const rows = n => Array.from({ length: n }, (_, k) => ({ role: k ? 'assistant' : 'user', content: 'm' + k }));

test('a page the service returned full (50) but that holds 46 rows reports 50: not the whole thread', async () => {
  const h = harness({ data: rows(46), pagination: { returned: 50 } });
  const page = await h.L.firstMessages('bitwarden', '', 50);
  assert.equal(page.length, 46);
  assert.equal(page.returned, 50);
  assert.match(h.reqs[0], /limit=50&offset=0/);
});

test('a short page reports its own size; has_more always reports the limit; no pagination falls back to the rows', async () => {
  assert.equal((await harness({ data: rows(3), pagination: { returned: 3 } }).L.firstMessages('a', '', 50)).returned, 3);
  assert.equal((await harness({ data: rows(3), pagination: { returned: 3, has_more: true } }).L.firstMessages('a', '', 50)).returned, 50);
  assert.equal((await harness({ messages: rows(7) }).L.firstMessages('a', '', 50)).returned, 7);
  const routed = harness({ data: rows(2), pagination: { returned: 2 } }); await routed.L.firstMessages('h1', 'host', 50);
  assert.match(routed.reqs[0], /&agent=host$/, 'a routed row reads with its own agent');
});
