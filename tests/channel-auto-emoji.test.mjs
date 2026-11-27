// Auto channel emoji (on for everyone since the switch wizard/channel-auto-emoji was removed): a new channel gets a fitting emoji (issue 1580). James, 18 Nov 2026: "all of
// mine are just a chat box"; he wants "the system auto detect what a good emoji would be when creating a channel and
// assign one." The shipped keyword map and New channel's create step run here; only the shell around them is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)

const j = x => JSON.parse(JSON.stringify(x));
const chats = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const cut = (src, from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, from); const b = src.indexOf(to, a + from.length); assert.ok(b > a, to); return src.slice(a, b); };
const core = () => { const ctx = { window: { WizCore: {} } }; vm.createContext(ctx); vm.runInContext(cut(chats, '/* Channel emoji (wizard-ux issue 1506', 'window.WizCore.chats = function'), ctx); return ctx.window.WizCore; };

test('1580: the keyword map picks a fitting emoji from the name, or none', () => {
  const C = core(), pick = n => C.channelAutoEmoji(n);
  assert.equal(pick('Money'), '💰'); assert.equal(pick('Podcast'), '🎙️'); assert.equal(pick('Music'), '🎵'); assert.equal(pick('Health'), '🩺');
  assert.equal(pick('Zzzqx'), '', 'no match: no emoji (the list shows 💬)');
  assert.equal(pick(''), ''); assert.equal(pick('  '), ''); assert.equal(pick('123'), '');
  assert.equal(pick('MONEY'), '💰', 'any case'); assert.equal(pick('Podcasts'), '🎙️', 'plural'); assert.equal(pick('Podcasting'), '🎙️', 'a longer word of a 4+ letter keyword');
  assert.equal(pick('Family trip to Rome'), '👪', 'the first word that matches wins');
  assert.equal(pick('Morning workout'), '🏋️', 'a whole word before a word start ("workout", not "work")');
  assert.equal(pick('Carrots'), '', 'no 3-letter word starts ("car" never matches "carrots")');
  assert.equal(pick('Shopping'), '🛒'); assert.equal(pick('Photos'), '📷');
  assert.equal(pick('AI research'), '🤖'); assert.equal(pick('Said'), '', 'words, never letters inside one');
  // Every map emoji reads back as a channel's own emoji, so the list shows it and the picker can take it off again.
  for (const [e, ks] of C.CHANNEL_AUTO_EMOJI) { assert.ok(C.channelFace(e + ' x').own, e); assert.equal(C.channelFace(C.channelEmojiName('x', e)).emoji, e); assert.ok(ks.trim() === ks && !/ {2}/.test(ks), e); }
  const seen = new Map(); for (const [e, ks] of C.CHANNEL_AUTO_EMOJI) for (const k of ks.split(' ')) { assert.ok(!seen.has(k), `"${k}" in ${seen.get(k)} and ${e}`); seen.set(k, e); }
});

test('1580: the stored name gets the emoji in front; a name with its own emoji is never overridden', () => {
  const C = core(), name = n => C.channelAutoName(n);
  assert.equal(name('Money'), '💰 Money'); assert.equal(name('  Podcast '), '🎙️ Podcast'); assert.equal(name('Zzzqx'), 'Zzzqx');
  assert.equal(name('🚀 Money'), '🚀 Money', 'the owner\'s own emoji stays'); assert.equal(name('🎯Money'), '🎯Money', 'as typed');
  assert.equal(name('🚀'), '🚀');
  assert.equal(name('Money ' + 'x'.repeat(54)), 'Money ' + 'x'.repeat(54), 'no room for the emoji: kept as typed, never cut');
  assert.equal(name('Money ' + 'x'.repeat(51)), '💰 Money ' + 'x'.repeat(51), 'exactly 60 fits');
});

// --- New channel's create step (chats.js createPickerSpace) ---
async function create({ typed, channelsOn = true, agent = 'hermes', existing = [], onStore = true } = {}) {
  const calls = [], p = { wid: 'w1', from: 'w1', agent, name: typed, sid: '', busy: false, error: '' };
  const ctx = {
    calls, SPACE: { get ch() { return channelsOn; } }, document: { documentElement: { dataset: { tweaks: '' } } }, spacePicker: p, CHAN_STORE_MAX: 200, crypto: { randomUUID: () => 'uuid' }, WizCore: core(),
    W: { w1: { id: 'w1' } }, spaces: () => existing, spaceAgent: s => s.agent || 'hermes', norm: s => String(s).toLowerCase(),
    chanStore: () => onStore ? {} : null, storeAgent: a => a,
    LIVE: { chanStore: { create: async (name, a) => (calls.push(['create', name, a]), { id: 'ch-new' }) }, prefOps: async ops => (calls.push(['prefs', ops[0].item.name, ops[0].item.agent]), true) },
    spaceMember() {}, renderSpacePicker() {}, closeSpacePicker: () => { ctx.spacePicker = null; },
    chanTarget: () => null, openChannel: () => true, chanToEnd() {}, setTimeout: fn => fn(), setFocus() {}, sendChat: async () => ({}), toast() {},
  };
  vm.createContext(ctx);
  vm.runInContext(cut(chats, '  async function createPickerSpace(p) {', '  function bindFocusStrip(') + '\nthis.createPickerSpace = createPickerSpace;', ctx);
  await ctx.createPickerSpace(p);
  return { calls: j(calls), error: p.error };
}

test('1580: creating "Money", "Podcast" and "Zzzqx" stores "💰 Money", "🎙️ Podcast" and "Zzzqx", for every agent', async () => {
  // The main agent and the routed ones (a host profile, a box container, a restricted agent) file the same way.
  for (const agent of ['hermes', 'host', 'container', 'restricted']) {
    assert.deepEqual((await create({ typed: 'Money', agent })).calls, [['create', '💰 Money', agent]], agent);
    assert.deepEqual((await create({ typed: 'Podcast', agent })).calls, [['create', '🎙️ Podcast', agent]], agent);
    assert.deepEqual((await create({ typed: 'Zzzqx', agent })).calls, [['create', 'Zzzqx', agent]], agent + ': no match keeps 💬');
    assert.deepEqual((await create({ typed: '🎯 Money', agent })).calls, [['create', '🎯 Money', agent]], agent + ': a picked emoji wins');
  }
  // Channels on but the box has no channel store yet (older service): the Spaces fallback stores the same name.
  assert.deepEqual((await create({ typed: 'Money', onStore: false })).calls, [['prefs', '💰 Money', 'hermes']]);
});

test('1580: a typed name that is already a channel with or without its emoji is refused, never a second one', async () => {
  for (const existing of [[{ id: 'a', name: '💰 Money' }], [{ id: 'a', name: 'Money' }], [{ id: 'a', name: '🎯 Money' }], [{ id: 'a', name: '💰 money' }]]) {
    const r = await create({ typed: 'Money', existing });
    assert.deepEqual(r.calls, [], existing[0].name); assert.equal(r.error, 'Already a channel');
  }
  // No emoji added (no match, or the owner typed one): the name alone decides, as before.
  assert.deepEqual((await create({ typed: 'Zzzqx', existing: [{ id: 'a', name: '🎯 Zzzqx' }] })).calls, [['create', 'Zzzqx', 'hermes']]);
  assert.deepEqual((await create({ typed: '🎯 Money', existing: [{ id: 'a', name: '💰 Money' }] })).calls, [['create', '🎯 Money', 'hermes']]);
  // Another agent's "💰 Money" is not this agent's.
  assert.deepEqual((await create({ typed: 'Money', agent: 'host', existing: [{ id: 'a', name: '💰 Money', agent: 'hermes' }] })).calls, [['create', '💰 Money', 'host']]);
});

test('1580: no switch: a fresh device with no tweaks on picks the emoji; classic Spaces keep names as typed', async () => {
  for (const agent of ['hermes', 'host', 'container', 'restricted']) {
    assert.deepEqual((await create({ typed: 'Money', agent })).calls, [['create', '💰 Money', agent]], agent);
    assert.deepEqual((await create({ typed: 'Zzzqx', agent, onStore: false })).calls[0], ['prefs', 'Zzzqx', agent], agent);
  }
  // Classic Spaces wording (Channels off) never picks.
  assert.deepEqual((await create({ typed: 'Money', channelsOn: false, onStore: false })).calls[0], ['prefs', 'Money', 'hermes']);
});
