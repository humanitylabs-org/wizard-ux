import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';
const read = p => readFileSync(process.env.QA_POLICY_TREE ? join(process.env.QA_POLICY_TREE, p) : new URL('../' + p, import.meta.url), 'utf8');
const core = read('web/core/chats.js'), power = read('web/core/chat-power.js');
function cut(src, from, to) { const a = src.indexOf(from), b = src.indexOf(to, a); assert(a >= 0 && b > a, from); return src.slice(a, b); }
function fixture({ phone = true, after = 'stay', sid = 'same', fail = false, deferred = false } = {}) {
  const w = { id: 'chat', app: 'chats', thread: sid }, c = { readNav: 1, trail: [], draft: 'Synthetic words', files: [] }, writes = [];
  let release;
  const saving = deferred ? new Promise(r => { release = r; }) : Promise.resolve();
  const context = {
    H: { keepThreadOpen: !phone, win: () => w, viewContext: () => 'Synthetic voice context' }, W: { chat: w }, PHONE: () => phone,
    window: { WizConfig: { chatAfterAction: () => after } }, ch: () => c, hosted: new Map(), INC: null, MAX_FILES: 8,
    closeHosted() { w.thread = null; }, openHosted() {},
    threadBack() { w.thread = c.trail.pop() || null; c.readNav++; }, save() {},
    openChat(_wid, id) { w.thread = id; c.readNav++; },
    LIVE: { session: () => ({ status: 'ready' }), holdSend: () => 'hold', releaseSend() {} },
    OUTBOX: { async enqueue(item) { writes.push(item); await saving; if (fail) throw Error('Synthetic disk failure'); return { id: 'synthetic-item', sessionId: sid === '__new__' ? 'allocated-new' : sid }; } },
    PW: { follow() {}, newModel: () => null }, winAgent: () => '', AGS: () => null,
    KIT: { drafts: { clear() {}, get: () => ({}), set() {} } },
    isWorking: () => false, joinWords: (a, b) => [a, b].filter(Boolean).join('\n'), focusOf: () => null,
    viewContext: () => 'Synthetic context', renderChats() {}, applyLayout() {}, deskOf: () => 0, toast() {},
    setDraft(_wid, text, files) { c.draft = text; c.files = files; },
    pendRef: x => x, follow() {},
  };
  vm.createContext(context);
  if (core.includes('  const keepThreadOpen =')) vm.runInContext(cut(core, '  const keepThreadOpen =', "  window.addEventListener('wos:boomerang-set'"), context);
  vm.runInContext(cut(core, '  function leaveAfterSend(', '\n  function '), context);
  vm.runInContext(cut(core, '  async function sendChat(', '  const picker ='), context);
  context.A = { leaveAfterSend: context.leaveAfterSend, isWorking: () => false, renderChats() {}, openChat: context.openChat, winAgent: () => '' };
  vm.runInContext(cut(power, '  async function sendVoiceTo(', '  function paintMic('), context);
  return { context, w, c, writes, release: () => release?.(),
    text: () => context.sendChat('chat', 'Synthetic typed reply', 'typed', null, { seal: false }),
    voice: () => context.sendVoiceTo('chat', sid, { syntheticAudio: true }, [], { text: 'Synthetic words', files: [], done() {}, putBack() {} }),
  };
}
for (const phone of [true, false]) for (const after of ['stay', 'list']) for (const mode of ['text', 'voice']) {
  test(`${phone ? 'phone' : 'desktop'} ${mode}, ${after}: immediate navigation and pinned outbox target`, async () => {
    const f = fixture({ phone, after, deferred: true }), sent = f[mode]();
    assert.equal(f.w.thread, phone && after === 'list' ? null : 'same', 'navigation happens before the disk save');
    assert.equal(f.writes[0].sessionId, 'same'); assert.equal(f.writes[0].kind, 'reply');
    f.release(); await sent; assert.equal(f.w.thread, phone && after === 'list' ? null : 'same');
  });
}
for (const mode of ['text', 'voice']) for (const after of ['stay', 'list']) test(`phone New chat ${mode}, ${after}: follow allocated thread only when staying`, async () => {
  const f = fixture({ sid: '__new__', after }); await f[mode]();
  assert.equal(f.writes[0].kind, 'new'); assert.equal(f.w.thread, after === 'stay' ? 'allocated-new' : null);
});
for (const mode of ['text', 'voice']) test(`phone retained New chat ${mode}: late disk save cannot steal newer navigation`, async () => {
  const f = fixture({ sid: '__new__', deferred: true }), sent = f[mode]();
  f.w.thread = 'different'; f.c.readNav++; f.release(); await sent; assert.equal(f.w.thread, 'different');
});
for (const mode of ['text', 'voice']) test(`phone retained New chat ${mode}: A → B → A is a newer visit too`, async () => {
  const f = fixture({ sid: '__new__', deferred: true }), sent = f[mode]();
  f.w.thread = 'different'; f.c.readNav++; f.w.thread = '__new__'; f.c.readNav++; f.release(); await sent; assert.equal(f.w.thread, '__new__');
});
for (const mode of ['text', 'voice']) for (const after of ['stay', 'list']) test(`phone ${mode} disk failure ${after}: stays or restores own visit`, async () => {
  const f = fixture({ after, fail: true });
  if (mode === 'voice') await assert.rejects(f[mode](), /Synthetic disk failure/); else await f[mode]();
  assert.equal(f.w.thread, 'same');
});
test('opt-in linked reply retains old one-step trail and manual Back is untouched', () => {
  const f = fixture({ after: 'list' }); f.c.trail = ['parent']; f.context.leaveAfterSend('chat', 'same', false); assert.equal(f.w.thread, 'parent');
  assert.match(core, /if \(e.target.closest\('\[data-chback\]'\)\) \{ threadBack\(w\); return true; \}/);
  assert.match(read('web/core/thread-swipe-back.js'), /api.nav.back\(\)/);
});
function configFixture({ supported = true, reject = false, mismatch = false } = {}) {
  const storage = new Map(), puts = [], events = [], preferences = supported ? { chatAfterAction: 'stay' } : {};
  const window = { dispatchEvent: e => events.push(e.type), addEventListener() {}, WizLive: { async putPrefs(value) { puts.push(value); if (reject) return false; if (!mismatch) Object.assign(preferences, value); return true; } } };
  const context = { window, Event, CustomEvent: class {}, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, document: { addEventListener() {} },
    fetch: async u => ({ ok: true, status: 200, json: async () => u.endsWith('/bootstrap') ? { bootstrap: 1 } : { ...preferences } }) };
  vm.runInNewContext(read('web/core/config.js'), context);
  return { C: window.WizConfig, puts, events, storage };
}
test('setting defaults to Stay; an unsupported older service is explicitly device-only', async () => {
  const f = configFixture({ supported: false }); assert.equal(f.C.chatAfterAction(), 'stay');
  const saved = f.C.setChatAfterAction('list'); assert.equal(f.C.chatAfterAction(), 'list', 'same-frame choice');
  assert.equal(await saved, 'device'); assert.equal(f.puts.length, 0);
});
test('supported shared preference writes only its own key and confirms by GET', async () => {
  const f = configFixture(); assert.equal(await f.C.setChatAfterAction('list'), 'owner'); assert.equal(f.puts.length, 1);
  assert.equal(JSON.stringify(f.puts[0]), '{"chatAfterAction":"list"}'); assert.equal(f.C.chatAfterAction(), 'list');
});
for (const opts of [{ reject: true }, { mismatch: true }]) test(`unconfirmed shared preference rolls back (${JSON.stringify(opts)})`, async () => {
  const f = configFixture(opts); await assert.rejects(f.C.setChatAfterAction('list')); assert.equal(f.C.chatAfterAction(), 'stay');
});
test('setting rejects invalid tokens without writing', async () => {
  const f = configFixture(); await assert.rejects(f.C.setChatAfterAction('back')); assert.equal(f.storage.has('wos.chats.afterAction.v1'), false);
});

for (const phone of [true, false]) test(`${phone ? 'phone' : 'desktop'} typed disk failure while staying: the visible composer shows the words again`, async () => {
  const f = fixture({ phone, after: 'stay', fail: true }); f.c.draft = '';
  await f.context.sendChat('chat', 'Synthetic typed reply'); // the composer's Send (chats.js: sendChat(id, text))
  assert.equal(f.w.thread, 'same', 'still on the thread');
  assert.equal(f.c.draft, 'Synthetic typed reply', 'words back in the open composer, not only the saved draft');
});
test('typed disk failure after moving on: the newer visit keeps its own composer', async () => {
  const f = fixture({ after: 'stay', fail: true, deferred: true }); const sent = f.context.sendChat('chat', 'Synthetic typed reply');
  f.w.thread = 'other'; f.c.readNav++; f.c.draft = 'Other thread words'; f.release(); await sent;
  assert.equal(f.c.draft, 'Other thread words');
});
