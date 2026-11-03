import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { listFixture } from './fixtures/chats-list-render.mjs';
const window = {};
vm.runInNewContext(fs.readFileSync(new URL('../web/core/chat-search.js', import.meta.url), 'utf8'), { window });
const { rank, rankDetails, bodyEvidence, relevance, SEARCH_RELEVANCE: B } = window.WizCore.chatSearch;
const HOUR = 3600000, NOW = Date.parse('2026-10-31T12:00:00Z');
const row = (id, title = '', hours = 0, more = {}) => ({ id, title, activityAt: new Date(NOW - hours * HOUR).toISOString(), ...more });
const sorted = (rows, q = 'usage', hits) => Array.from(rank(rows, q, s => s.activityAt, hits, NOW), s => s.id);
test('rare query word has more IDF weight than common query word in the same coverage tier', () => {
  const rows = [row('common','usage'),row('rare','cloud'),...Array.from({length:8},(_,i)=>row('c'+i,'usage'))];
  assert.equal(sorted(rows,'cloud usage')[0],'rare');
  const d=rankDetails(rows,'cloud usage',s=>s.activityAt,null,NOW)[0]; assert.ok(d.idf.cloud>d.idf.usage);
});
test('all words across fields/messages always beat partial coverage, regardless of age', () => {
  const rows=[row('partial','cloud',0),row('all','usage',1000)];
  const hits=new Map([['all',{query:'cloud usage',body:bodyEvidence(['cloud here','usage elsewhere'],'cloud usage') }]]);
  assert.deepEqual(sorted(rows,'cloud usage',hits),['all','partial']);
});
test('single incidental body mention goes after a topical title, even a very old Archive title', () => {
  assert.deepEqual(sorted([row('body','New unrelated',0,{searchSnippet:'one usage mention'}),row('title','Usage burn audit',1000,{archived:true})]),['title','body']);
});
test('title word-prefix 8 > substring 5 > preview 3; archived and pinned get no extra weight', () => {
  assert.equal(B.titlePrefix,8); assert.equal(B.titleSubstring,5); assert.equal(B.preview,3);
  assert.deepEqual(sorted([row('preview','',0,{preview:'usage'}),row('substring','preusage'),row('prefix','Usage audit')]),['prefix','substring','preview']);
  assert.deepEqual(sorted([row('a','usage',0,{archived:true}),row('b','usage',0,{pinned:true})]),['a','b']);
});
test('adjacent phrase in title or snippet gets a bonus, not reversed words', () => {
  assert.deepEqual(sorted([row('reverse','usage cloud'),row('phrase','cloud usage')],'cloud usage'),['phrase','reverse']);
  assert.deepEqual(sorted([row('reverse','',0,{searchSnippet:'usage cloud'}),row('phrase','',0,{searchSnippet:'cloud usage'})],'cloud usage'),['phrase','reverse']);
});
test('body density counts distinct positions across messages, is log scaled and capped', () => {
  const hits=new Map([['many',{query:'usage',body:bodyEvidence(['usage usage','usage'],'usage')}],['one',{query:'usage',body:bodyEvidence(['usage'],'usage')}]]);
  assert.deepEqual(sorted([row('one'),row('many')],'usage',hits),['many','one']);
  const a=relevance({},'usage',{query:'usage',body:bodyEvidence(['usage '.repeat(B.densityCap)],'usage')});
  const b=relevance({},'usage',{query:'usage',body:bodyEvidence(['usage '.repeat(1000)],'usage')});
  assert.equal(a.fields[0].weight,b.fields[0].weight); assert.equal(a.strong,true);
});
test('single-word body strength requires two distinct locations, not messageCount or duplicated snippet', () => {
  assert.equal(relevance({searchSnippet:'usage',messageCount:9999},'usage').strong,false);
  assert.equal(relevance({searchSnippet:'usage usage'},'usage').strong,true);
  assert.equal(relevance({searchSnippet:'usage'},'usage',{query:'usage',body:bodyEvidence(['usage'],'usage'),snippet:'usage'}).fields[0].count,1);
});
test('query-bound evidence cannot leak counts from a previous query', () => {
  assert.equal(relevance({},'cloud',{query:'usage',body:{counts:{cloud:10}}}).coverage,0);
});
test('recency multiplier gently orders equal relevance with a 4-day half-life and .5 floor', () => {
  const rows=[row('old','usage',96),row('new','usage')];
  assert.deepEqual(sorted(rows),['new','old']);
  const d=rankDetails(rows,'usage',s=>s.activityAt,null,NOW);
  assert.equal(d[0].multiplier,1); assert.equal(d[1].multiplier,.75);
  assert.equal(B.halfLifeDays,4); assert.equal(B.recencyFloor,.5);
});
test('uses the injected live card clock, not stale updatedAt or active/pin priority', () => {
  assert.deepEqual(sorted([row('stale','usage',200,{updatedAt:new Date(NOW).toISOString(),status:'running',pinned:true}),row('new','usage')]),['new','stale']);
});
test('ties are stable, ranking does not mutate inputs; invalid clocks rank deterministically', () => {
  const rows=[row('z','usage'),row('a','usage')]; assert.deepEqual(sorted(rows),['z','a']); assert.deepEqual(rows.map(s=>s.id),['z','a']);
  assert.deepEqual(sorted([row('invalid','usage',0,{activityAt:''}),row('valid','usage')]),['valid','invalid']);
});
test('empty, repeated and odd input are deterministic and regex-safe', () => {
  assert.deepEqual(Array.from(rank(null,null)),[]); assert.deepEqual(Array.from(rank([null,{},false],'' )).map(r=>Object.keys(r).length),[0]);
  assert.deepEqual(sorted([row('a','usage'),row('b')],'usage usage'),['a','b']);
  assert.deepEqual(sorted([row('a','[x]'),row('b','λ')],'[x]'),['a','b']);
  assert.deepEqual(sorted([row('a','usage',1),row('b','usage')],''),['b','a']);
});
test('real list renderer mixes pinned/archived matches, labels status and pages once', () => {
  const rows = Array.from({ length: 55 }, (_, i) => row('r' + i, 'match', i, { section: i === 1 ? 'archive' : 'ready' }));
  const f = listFixture({ query: 'match', inputRows: rows, pinned: ['r54'] });
  let html = f.render();
  const ids = h => [...h.matchAll(/data-chopen="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids(html).length, 40); assert.deepEqual(ids(html).slice(0, 2), ['r0', 'r1']);
  assert.doesNotMatch(html, /ch-sec-h|data-sec="pinned"/);
  assert.equal((html.match(/data-secmore="search"/g) || []).length, 1);
  f.state.more.search = true; html = f.render();
  assert.equal(ids(html).length, 55); assert.doesNotMatch(html, /data-secmore/); assert.match(html, /ch-search-status">Archive/);
});
