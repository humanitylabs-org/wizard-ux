// Channel emoji from a model (issue 1605, on for everyone; its switch wizard/channel-model-emoji was removed): a new channel whose name has
// no emoji asks the Agent Service (POST /wizard/v1/channel-emoji) for one in the background, and is renamed once if its
// name is still exactly as created. The shipped create step (core/chats-spaces.js createPickerSpace) and the ask
// (core/chats-chanemoji.js chanModelEmoji) run here; only the shell around them and the network are stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs';

const chats = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const emojiPart = readFileSync(new URL('../web/core/chats-chanemoji.js', import.meta.url), 'utf8');
const cut = (src, from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, from); const b = src.indexOf(to, a + from.length); assert.ok(b > a, to); return src.slice(a, b); };
const tick = () => new Promise(r => setImmediate(r));

// answer: what the service says ({status, json}) or a function (body) → that; 'hang' never answers.
async function create({ typed, agent = 'hermes', privacy = 'standard', answer = { status: 200, json: { emoji: '🎯' } }, onStore = true, before = null } = {}) {
  const calls = [], asks = [], list = [];
  let release; const gate = new Promise(r => { release = r; });
  const p = { wid: 'w1', from: 'w1', agent, name: typed, sid: '', busy: false, error: '' };
  const ctx = {
    calls, asks, list, AbortController, setTimeout, clearTimeout, JSON, String, Promise,
    document: { documentElement: { dataset: { tweaks: 'wizard/desktop-chats' } } },
    window: { WizCore: { chatsParts: {} } },
    fetch: async (url, opts) => {
      asks.push({ url, method: opts.method, body: JSON.parse(opts.body), creds: opts.credentials });
      await gate; if (before) before(list);
      const a = typeof answer === 'function' ? answer(JSON.parse(opts.body)) : answer;
      if (a === 'hang') return new Promise(() => {});
      if (a instanceof Error) throw a;
      return { ok: a.status === 200, status: a.status, json: async () => a.json };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(cut(chats, 'window.WizCore.channelFace = function', 'window.WizCore.chats = function'), ctx);
  vm.runInContext(emojiPart, ctx);
  const W = ctx.window.WizCore, norm = s => String(s).toLowerCase();
  const spaces = () => list, spaceAgent = s => s.agent || 'hermes';
  const chanRenameTo = (cid, t, quiet) => { const s = list.find(x => x.id === cid); calls.push(['rename', t, !!quiet]); s.name = t; return true; };
  const { chanModelEmoji } = W.chatsParts.chanemoji({ chanFace: n => W.channelFace(n), chanRenameTo, esc: s => s, norm, openEmojiSheet() {}, spaceAgent, spaces, toast: (...a) => calls.push(['toast', ...a]) });
  Object.assign(ctx, {
    SPACE: { ch: true }, spacePicker: p, CHAN_STORE_MAX: 200, crypto: { randomUUID: () => 'uuid' }, WizCore: W, chanModelEmoji,
    W: { w1: { id: 'w1' } }, spaces, spaceAgent, norm, agentRec: id => ({ id, privacy: id === agent ? privacy : 'standard' }),
    chanStore: () => onStore ? {} : null, storeAgent: a => a,
    LIVE: { chanStore: { create: async (name, a) => { calls.push(['create', name, a]); list.push({ id: 'ch-new', name, agent: a }); return { id: 'ch-new' }; } },
      prefOps: async ops => { calls.push(['prefs', ops[0].item.name]); list.push({ ...ops[0].item }); return true; } },
    spaceMember() {}, renderSpacePicker() {}, closeSpacePicker: () => { ctx.spacePicker = null; },
    chanTarget: () => null, openChannel: () => true, chanToEnd() {}, sendChat: async () => ({}), toast() {},
  });
  vm.runInContext(cut(chats, '  async function createPickerSpace(p) {', '  function bindFocusStrip(') + '\nthis.createPickerSpace = createPickerSpace;', ctx);
  await ctx.createPickerSpace(p);
  // The create is done (stored, picker closed) while the ask is still open: it never waited on the model.
  const createdFirst = JSON.parse(JSON.stringify(calls)), pickerClosed = ctx.spacePicker === null;
  release(); for (let i = 0; i < 10; i++) await tick();
  return { createdFirst, pickerClosed, calls: JSON.parse(JSON.stringify(calls)), asks: JSON.parse(JSON.stringify(asks)), list };
}

test('1605: "Quarterly OKRs" is created at once, then gets the model\'s emoji, for every agent kind', async () => {
  for (const agent of ['hermes', 'host', 'container', 'restricted']) {
    const r = await create({ typed: 'Quarterly OKRs', agent });
    assert.deepEqual(r.createdFirst, [['create', 'Quarterly OKRs', agent]], agent + ': stored as typed first');
    assert.ok(r.pickerClosed, agent + ': New channel closed before the model answered');
    assert.deepEqual(r.asks, [{ url: '/wizard/v1/channel-emoji', method: 'POST', body: { name: 'Quarterly OKRs', agent }, creds: 'same-origin' }], agent);
    assert.deepEqual(r.calls, [['create', 'Quarterly OKRs', agent], ['rename', '🎯 Quarterly OKRs', true]], agent + ': one quiet rename');
    assert.equal(r.list[0].name, '🎯 Quarterly OKRs');
  }
  // The Spaces fallback (no channel store yet) renames the same way.
  const r = await create({ typed: 'Quarterly OKRs', onStore: false });
  assert.deepEqual(r.calls, [['prefs', 'Quarterly OKRs'], ['rename', '🎯 Quarterly OKRs', true]]);
});

test('1605: no broker, a model error, a timeout-shaped failure or an odd answer keeps 💬 (no rename)', async () => {
  for (const answer of [{ status: 503, json: { error: 'channel_emoji_unavailable' } }, { status: 404, json: { error: 'not_found' } }, { status: 403, json: { error: 'private_agent' } },
    new Error('network'), { status: 200, json: { emoji: '🎯 Goals' } }, { status: 200, json: { emoji: 'OK' } }, { status: 200, json: { emoji: '💬' } }, { status: 200, json: {} }, { status: 200, json: null }]) {
    const r = await create({ typed: 'Quarterly OKRs', answer });
    assert.deepEqual(r.calls, [['create', 'Quarterly OKRs', 'hermes']], JSON.stringify(answer?.json ?? String(answer)));
    assert.equal(r.list[0].name, 'Quarterly OKRs');
  }
});

test('1605: a private (Tinfoil) agent never asks; a name with its own emoji never asks', async () => {
  const priv = await create({ typed: 'Quarterly OKRs', agent: 'tinfoil', privacy: 'private' });
  assert.deepEqual(priv.asks, [], 'the name never leaves for a cloud model');
  assert.deepEqual(priv.calls, [['create', 'Quarterly OKRs', 'tinfoil']]);
  const own = await create({ typed: '🚀 Launch' });
  assert.deepEqual(own.asks, []); assert.deepEqual(own.calls, [['create', '🚀 Launch', 'hermes']]);
});

test('1605: renamed, emoji-picked or deleted before the model answered: the owner\'s change wins', async () => {
  for (const [what, edit] of [['renamed', l => { l[0].name = 'OKRs Q3'; }], ['emoji picked', l => { l[0].name = '📈 Quarterly OKRs'; }], ['deleted', l => { l.length = 0; }]]) {
    const r = await create({ typed: 'Quarterly OKRs', before: edit });
    assert.deepEqual(r.calls, [['create', 'Quarterly OKRs', 'hermes']], what);
  }
  // Another channel of the same agent already has the emoji'd name: no second one of that name.
  const r = await create({ typed: 'Quarterly OKRs', before: l => l.push({ id: 'old', name: '🎯 quarterly okrs', agent: 'hermes' }) });
  assert.deepEqual(r.calls, [['create', 'Quarterly OKRs', 'hermes']]);
});

test('1605: on with no switch: a name the keyword map matches or one with its own emoji never asks', async () => {
  for (const agent of ['hermes', 'host', 'container', 'restricted']) for (const [typed, stored] of [['🚀 Launch', '🚀 Launch'], ['Money', '💰 Money']]) {
    const r = await create({ typed, agent });
    assert.deepEqual(r.asks, [], agent + ': ' + typed);
    assert.deepEqual(r.calls, [['create', stored, agent]], agent + ': ' + typed);
  }
});

test('1605: with the keyword map (#1580, on for everyone), only a name it can\'t match asks the model', async () => {
  const money = await create({ typed: 'Money' });
  assert.deepEqual(money.asks, [], 'the keyword map already gave 💰');
  assert.deepEqual(money.calls, [['create', '💰 Money', 'hermes']]);
  const okrs = await create({ typed: 'Quarterly OKRs' });
  assert.deepEqual(okrs.asks.map(a => a.body.name), ['Quarterly OKRs']);
  assert.deepEqual(okrs.calls, [['create', 'Quarterly OKRs', 'hermes'], ['rename', '🎯 Quarterly OKRs', true]]);
  // A name the keyword map can't match asks too, and a 503 (no broker) keeps it as typed.
  const zz = await create({ typed: 'Zzzqx', answer: { status: 503, json: { error: 'channel_emoji_unavailable' } } });
  assert.deepEqual(zz.asks.map(a => a.body.name), ['Zzzqx']); assert.deepEqual(zz.calls, [['create', 'Zzzqx', 'hermes']]);
});
