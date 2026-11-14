// A saved draft is never lost to another box (wizard-ux issue 1444): a channel box's send, failure or typing never
// writes over or empties a thread's draft; drafts have no count cap; a device that can't store them says so.
// Real chat-kit drafts + the real chats.js draft functions (draftKey, loadDraft, saveDraft, typedInto) in a vm.
// Browser proof of the whole path (phone + desktop, send / failed send / typing only / New chat / list): tests/qa-chat-thread-draft-channel-send.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const kitSrc = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const chatsSrc = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const KEY = 'wos.chat.drafts.v1', CHAN = 'chan:hermes:launch', THREAD = 'direct:philosopher';

function kit(seed = {}, failure = '') {
  const store = new Map([[KEY, JSON.stringify(seed)]]), events = [];
  const ctx = { location: { origin: 'https://w.example', hostname: 'w.example', href: 'https://w.example/' },
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => { if (failure) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } store.set(k, v); }, removeItem: k => store.delete(k) },
    navigator: {}, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) }, addEventListener() {},
    dispatchEvent: e => { events.push(e); return true; }, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    setTimeout, clearTimeout, console, URL, Intl, Date };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(kitSrc, ctx);
  return { drafts: ctx.WosChat.drafts, store, events };
}

// The real draft functions of chats.js, cut out word for word.
function chats(K, state, agent = '') {
  const a = chatsSrc.indexOf('  const draftKey = w =>'), b = chatsSrc.indexOf('  function openMedia(', a);
  assert.ok(a > 0 && b > a, 'draft functions found in chats.js');
  const ctx = { W: state.W, CH: state.CH, ch: id => state.CH[id] || (state.CH[id] = {}), INC: null, KIT: { drafts: K.drafts }, PREVIEW: {}, fileUrl: id => '/f/' + id,
    winAgent: () => agent, chanDraftKey: w => w.chanKey || '', elOf: id => state.el[id] || null };
  vm.createContext(ctx);
  vm.runInContext(chatsSrc.slice(a, b) + '\nthis.api = { draftKey, loadDraft, saveDraft, typedInto };', ctx);
  return ctx.api;
}
const form = (chan) => ({ dataset: chan ? { chchanform: '', morphKey: 'chanbox:' + chan } : {} });
const ta = (value, f) => ({ value, form: f, closest: () => f });

test('a channel box state never empties a thread draft when the window is back on the thread', () => {
  const K = kit({ [THREAD]: { text: 'A half-typed reply', files: [], at: 1 } });
  // The window shows the thread again, but its box state still belongs to the channel box just emptied by a send.
  const state = { W: { w1: { id: 'w1', thread: 'philosopher' } }, CH: { w1: { draft: '', files: [], draftFor: CHAN } }, el: {} };
  const api = chats(K, state);
  api.saveDraft('w1');
  assert.equal(K.drafts.get(THREAD).text, 'A half-typed reply', 'the other box\'s empty words were not saved over the thread');
  // Once the thread's own draft is loaded, saving is normal again.
  api.loadDraft(state.W.w1); state.CH.w1.draft += ' and more'; api.saveDraft('w1');
  assert.equal(K.drafts.get(THREAD).text, 'A half-typed reply and more');
});

test('words typed in a box are saved under that box, whatever the window state says', () => {
  const K = kit({ [THREAD]: { text: 'thread words', files: [], at: 1 } });
  const state = { W: { w1: { id: 'w1', thread: 'philosopher' } }, CH: { w1: { draft: 'thread words', files: [], draftFor: THREAD } }, el: { w1: { dataset: { draftFor: THREAD } } } };
  const api = chats(K, state);
  // A channel box (still in the page) fires input while the window shows the thread.
  api.typedInto('w1', ta('channel words', form(CHAN)));
  assert.equal(K.drafts.get(CHAN).text, 'channel words');
  assert.equal(K.drafts.get(THREAD).text, 'thread words');
  assert.equal(state.CH.w1.draft, 'thread words', 'the thread box state is untouched');
  // The thread's own box saves under the thread.
  api.typedInto('w1', ta('thread words!', form('')));
  assert.equal(K.drafts.get(THREAD).text, 'thread words!');
  // The window on the channel: its box saves under the channel, the thread draft stays.
  state.W.w1 = { id: 'w1', thread: null, chanKey: CHAN }; state.CH.w1 = { draft: '', files: [], draftFor: CHAN };
  api.typedInto('w1', ta('', form(CHAN)));
  assert.equal(K.drafts.get(CHAN).text, '', 'emptying the channel box clears only the channel draft');
  assert.equal(K.drafts.get(THREAD).text, 'thread words!');
});

test('switching between boxes keeps each box\'s own draft', () => {
  const K = kit();
  const state = { W: { w1: { id: 'w1', thread: 'philosopher' } }, CH: {}, el: { w1: { dataset: { draftFor: THREAD } } } };
  const api = chats(K, state);
  api.loadDraft(state.W.w1); api.typedInto('w1', ta('thread half', form('')));
  state.W.w1 = { id: 'w1', thread: null, chanKey: CHAN }; delete state.el.w1.dataset.draftFor; api.loadDraft(state.W.w1);
  api.typedInto('w1', ta('channel half', form(CHAN))); api.saveDraft('w1');
  state.W.w1 = { id: 'w1', thread: 'philosopher' }; api.saveDraft('w1'); // a stale save before the thread loads: no write
  assert.equal(api.loadDraft(state.W.w1), 'thread half');
  assert.equal(K.drafts.get(CHAN).text, 'channel half');
});

test('drafts have no count cap: the 250th draft keeps the first one', () => {
  const K = kit();
  for (let i = 0; i < 250; i++) K.drafts.set('direct:t' + i, 'words ' + i, []);
  assert.equal(K.drafts.get('direct:t0').text, 'words 0');
  assert.equal(Object.keys(K.drafts.all()).length, 250);
});

test('a device that refuses to store a draft says so (once a minute), never silently', () => {
  const K = kit({}, 'full');
  K.drafts.set(THREAD, 'words', []); K.drafts.set(THREAD, 'more words', []);
  assert.equal(K.events.length, 1);
  assert.equal(K.events[0].type, 'wos:drafts-unsaved');
  assert.equal(K.events[0].detail.reason, 'QuotaExceededError');
  assert.match(chatsSrc, /addEventListener\('wos:drafts-unsaved', \(\) => toast\(/, 'Chats tells the owner');
});

test('a thread paint never takes a channel box\'s field as its own composer', () => {
  const a = chatsSrc.indexOf('    const dkey = draftKey(w);\n'), part = chatsSrc.slice(a, a + 600);
  assert.match(part, /oldTa = ta0 && !ta0\.closest\?\.\('\[data-chchanform\]'\) \? ta0 : null/);
  assert.match(chatsSrc, /if \(el\.dataset\) delete el\.dataset\.draftFor; \/\/ a list holds no thread's box/);
});

// Main and routed agents (host profile, container, restricted): each agent's channel box, New chat box and thread box keep
// their own drafts; another agent's or box's state never writes over them.
for (const [kind, agent] of [['main', ''], ['host-ops', 'host'], ['box', 'container'], ['locked', 'restricted']]) {
  test(`${kind}: a channel send and a New chat never touch the thread's or another box's draft`, () => {
    const ag = agent || 'hermes', chan = `chan:${ag}:launch`, nw = agent ? 'agentnew:' + agent : 'new', sid = 'p-' + kind, dk = 'direct:' + sid;
    const K = kit({ [dk]: { text: 'thread half', files: [], at: 1 }, [nw]: { text: 'new half', files: [], at: 2 }, 'chan:other:launch': { text: 'other agent', files: [], at: 3 } });
    const state = { W: { w1: { id: 'w1', thread: null, chanKey: chan } }, CH: {}, el: { w1: { dataset: {} } } }, api = chats(K, state, agent);
    api.loadDraft(state.W.w1); api.typedInto('w1', ta('post words', form(chan)));
    // The channel's own send empties its box state; the window then goes to the thread and to a New chat.
    state.CH.w1.draft = ''; K.drafts.clear(chan);
    state.W.w1 = { id: 'w1', thread: sid }; api.saveDraft('w1');
    assert.equal(api.draftKey(state.W.w1), dk);
    assert.equal(api.loadDraft(state.W.w1), 'thread half');
    state.W.w1 = { id: 'w1', thread: '__new__' }; api.saveDraft('w1');
    assert.equal(api.draftKey(state.W.w1), nw);
    assert.equal(api.loadDraft(state.W.w1), 'new half');
    // The old thread box (still painted for the thread) types: saved under the thread, never the New chat.
    state.el.w1.dataset.draftFor = dk; api.typedInto('w1', ta('thread half+', form('')));
    assert.equal(K.drafts.get(dk).text, 'thread half+'); assert.equal(K.drafts.get(nw).text, 'new half');
    assert.equal(K.drafts.get('chan:other:launch').text, 'other agent');
  });
}
