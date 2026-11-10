// A channel's message box (wizard/chat-channels, wizard-ux issue 1258): its mic and model label run through the real
// core/chat-power.js. A box-mic take is a new chat filed into the channel it STARTED in, even if James leaves the
// channel before Send; main, host-profile, container and restricted channels each keep their own agent. The box's
// model menu offers only that channel's agent's models (never a private agent's, whose chat could not be filed there).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const kit = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const power = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');

function harness({ agent = '', thread = null, chan = { id: 'launch', name: 'Launch', agent: agent || 'hermes' } } = {}) {
  const sent = [], filed = [], recorded = [], privAsked = [], state = {};
  const w = { id: 'win', app: 'chats', thread, focus: chan ? { kind: 'space', key: chan.id } : null };
  const view = { chan };
  const ctx = { console, URL, Intl, Date, File, Blob, Response, setTimeout, clearTimeout, location: { origin: 'https://fixture.invalid', href: 'https://fixture.invalid/', hostname: 'fixture.invalid' }, navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) }, addEventListener() {},
    WizCore: { esc: String, clip: s => s }, WizConfig: { agent: () => 'Fixture' }, WizLive: { session: () => null },
    WosAgents: { isOther: a => !!a && a !== 'hermes', get: id => ({ id, label: id }), route: () => ({ model: 'agent-model', provider: 'agent-provider' }), isPrivate: a => a?.id === 'restricted' },
    WosModels: { currentRoute: () => ({ model: '', provider: '' }), load: async () => {}, ready: true, privateOptions: () => [{ value: 'tinfoil', agent: 'restricted', private: true }], sheetHtml: opt => { privAsked.push(opt.priv); return { list: [], html: '' }; }, defaultOption: () => ({ value: 'default-model', provider: 'default-provider' }) },
    WosOutbox: { unsent: () => [], enqueue: async it => { sent.push(it); return { ...it, sessionId: 'wizard_new_' + sent.length, durable: true }; } } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(kit, ctx); vm.runInContext(power, ctx);
  const H = { win: () => w, recordReply: (id, sid) => { recorded.push([id, sid]); return 'recording'; }, recordingFor: () => '', viewContext: () => '', overlay() {} };
  const chanSpaceOf = x => !x.thread && view.chan ? (view.chan.id === '__general__' ? '' : view.chan.id) : null;
  const api = ctx.WosChatPower({ ch: () => state, CH: { win: state }, toast() {}, H, renderChats() {}, owner: id => id, elOf: () => ({ querySelectorAll: () => [], insertAdjacentHTML() {} }), MIC_SVG: '<svg ', closeRowSheet() {}, vib() {},
    isWorking: () => false, takeComposer: () => ({ text: '', files: [], done() {}, putBack() {} }), leaveAfterSend: () => false, openChat() {},
    winAgent: () => agent, chanOpen: x => !x.thread ? view.chan : null, chanSpaceOf, spaceMember: (key, sid, add) => filed.push([key, sid, add]) });
  const click = sel => api.click({ target: { closest: s => s === sel ? {} : null } }, 'win');
  return { api, w, view, sent, filed, recorded, privAsked, click };
}

test('box mic in a channel records a new chat and files it into the channel it started in, even after leaving', async () => {
  const h = harness();
  assert.match(h.api.micBtn('win'), /data-chmic/);
  h.click('[data-chmic]');
  assert.deepEqual(h.recorded, [['win', '__new__']], 'the box mic records a new chat, not a reply');
  h.view.chan = { id: 'voice', name: 'Voice', agent: 'hermes' }; // James opened another channel before Send
  const it = await h.api.sendVoiceTo('win', '__new__', new Blob(['a']), [], false);
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].kind, 'new'); assert.equal(h.sent[0].space, false, 'the outbox does not file it by what is in front now');
  assert.deepEqual(h.filed, [['launch', it.sessionId, true]], 'filed into the channel the take started in');
});

test('General box mic: a new chat in no Space; a New chat thread mic never pins a channel', async () => {
  const g = harness({ chan: { id: '__general__', name: 'General', general: true } });
  g.click('[data-chmic]'); await g.api.sendVoiceTo('win', '__new__', new Blob(['a']), [], false);
  assert.equal(g.sent[0].space, false); assert.equal(g.filed.length, 0, 'General = unfiled');
  const n = harness({ thread: '__new__' });
  n.click('[data-chmic]'); assert.deepEqual(n.recorded, [['win', '__new__']]);
  await n.api.sendVoiceTo('win', '__new__', new Blob(['a']), [], false);
  assert.equal('space' in n.sent[0], false, 'an ordinary New chat keeps the outbox filing by what is in front'); assert.equal(n.filed.length, 0);
});

for (const agent of ['host', 'container', 'restricted']) test(`${agent} channel: the box-mic chat goes to ${agent} and into ${agent}'s Space`, async () => {
  const h = harness({ agent, chan: { id: agent + '-ops', name: 'Ops', agent } });
  h.click('[data-chmic]');
  const it = await h.api.sendVoiceTo('win', '__new__', new Blob(['a']), [], false);
  assert.equal(h.sent[0].agent, agent); assert.deepEqual(h.filed, [[agent + '-ops', it.sessionId, true]]);
});

test('the box model label opens the new-chat model menu without private-agent models; a New chat still lists them', () => {
  const h = harness();
  h.click('[data-chmodel]');
  assert.equal(h.privAsked.length, 1, 'the box label opens the model menu'); assert.equal(h.privAsked[0], null, 'a main channel box never offers a private agent\'s model');
  const n = harness({ thread: '__new__' });
  n.click('[data-chmodel]');
  assert.equal(n.privAsked[0]?.length, 1, 'the main New chat keeps unified Chats\' private models');
});

// The real composer seal helpers from core/chats.js: a take pinned to channel A's box takes A's box (never channel B's
// in front by Send, never the New chat draft) and gives it back to A when the take is dropped.
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
function seals(d = {}) {
  const a = chats.indexOf('  const composerKey = sid =>'), b = chats.indexOf('  // Typed words first, then what was said');
  assert.ok(a > 0 && b > a);
  const w = { id: 'win', thread: null }, c = {}, view = { box: 'chan:hermes:launch' };
  const ctx = { crypto: { randomUUID: () => 'aaaa-bbbb' }, INC: null, PEND: null, W: { win: w }, ch: () => c, elOf: () => ({ querySelector: () => null }), chanDraftKey: () => view.box,
    KIT: { drafts: { all: () => ({ ...d }), get: k => d[k] || { text: '', files: [] }, set: (k, text, files = []) => { d[k] = { text, files }; }, clear: k => { delete d[k]; }, setReply() {} } },
    OUTBOX: { recoveryComplete: true, ownsSeal: () => false },
    pendRef: f => f, growTa() {}, syncSend() {}, refreshCompose() {}, refreshReply() {}, setDraft: (wid, text, files) => { c.draft = text; c.files = files; }, renderChats() {}, Promise };
  vm.createContext(ctx); vm.runInContext(chats.slice(a, b) + ';this.api={takeComposer,peekComposer,restoreSealed};', ctx);
  return { ...ctx.api, d, w, c, view };
}
test('a channel take seals the box of the channel it started in, and gives the words back there', () => {
  const s = seals();
  s.d['chan:hermes:launch'] = { text: 'launch words', files: [] }; s.d['chan:hermes:voice'] = { text: 'voice words', files: [] }; s.d.new = { text: 'new chat draft', files: [] };
  s.view.box = 'chan:hermes:voice'; // James is on # Voice by Send
  const t = s.takeComposer('win', '__new__', 'chan:hermes:launch');
  assert.equal(t.text, 'launch words'); assert.equal(s.d['chan:hermes:voice'].text, 'voice words', 'the box in front is left alone');
  assert.equal(s.d.new.text, 'new chat draft', 'never the New chat draft');
  t.putBack(); assert.equal(s.d['chan:hermes:launch'].text, 'launch words', 'a dropped take gives the words back to its own channel');
  // Pinned to "no channel" (a New chat mic), a channel in front by Send is not taken either.
  const n = seals(); n.d['chan:hermes:launch'] = { text: 'launch words', files: [] }; n.d.new = { text: 'new words', files: [] };
  assert.equal(n.takeComposer('win', '__new__', '').text, 'new words');
  // The page dies after the seal, before the outbox has the take: on the next start the words go back to # Launch.
  const c1 = seals(); c1.view.box = 'chan:hermes:voice'; c1.d['chan:hermes:launch'] = { text: 'launch words', files: [] };
  c1.takeComposer('win', '__new__', 'chan:hermes:launch'); assert.equal(c1.d['chan:hermes:launch'].text, '');
  const after = seals({ ...c1.d }); after.restoreSealed();
  assert.equal(after.d['chan:hermes:launch']?.text, 'launch words'); assert.equal(after.d.new, undefined, 'not into the New chat draft');
  // No pin (an older take): whatever box is in front, as before.
  const o = seals(); o.d['chan:hermes:launch'] = { text: 'launch words', files: [] };
  assert.equal(o.peekComposer('win', '__new__').here, true);
});

// The model is still read at Send (wizard-ux#1218), but a channel take keeps the agent it started with: by Send another
// agent's channel may be in front, and its chat is filed into the channel it started in (Codex P1).
test('phone and desktop: a channel take never re-routes to the agent of the channel in front by Send', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'), desk = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  const tap = app.slice(app.indexOf('  function sendTapRoute('), app.indexOf('  // A take that sends nothing'));
  let live = { model: 'b-model', provider: 'b', agent: 'container' };
  const ctx = { CHATS: { modelRoute: () => live }, window: { WosModels: { snapshot: () => null } } };
  vm.createContext(ctx); vm.runInContext(tap + ';this.sendTapRoute=sendTapRoute;', ctx);
  const start = { model: 'a-model', provider: 'a', agent: 'host' };
  const snap = { view: { id: 'win', thread: '__new__', space: 'host-ops' }, route: start };
  assert.equal(ctx.sendTapRoute(snap, { wid: 'win', sid: '__new__' }).model, 'a-model', 'another agent in front: the starting route');
  live = { model: 'a-newer', provider: 'a', agent: 'host' };
  assert.equal(ctx.sendTapRoute(snap, { wid: 'win', sid: '__new__' }).model, 'a-newer', 'same agent: the model picked while recording');
  live = { model: 'b-model', provider: 'b', agent: 'container' };
  assert.equal(ctx.sendTapRoute({ view: { id: 'win', thread: '__new__' }, route: start }, { wid: 'win', sid: '__new__' }).model, 'b-model', 'not a channel take: as before');
  const line = desk.slice(desk.indexOf('  const chanRoute ='), desk.indexOf('\n', desk.indexOf('  const chanRoute =')));
  const d = {}; vm.createContext(d); vm.runInContext(line.replace('const chanRoute', 'this.chanRoute'), d);
  assert.equal(d.chanRoute(() => ({ model: 'b', agent: 'container' }), () => start)().model, 'a-model');
  assert.equal(d.chanRoute(() => ({ model: 'a2', agent: 'host' }), () => start)().model, 'a2');
  assert.match(desk, /if \(vRouteAt && typeof vSpace === 'string'\) vRouteAt = chanRoute\(resolveRoute, \(\) => vRoute\);/);
  assert.match(desk, /if \(box\) vRouteAt = chanRoute\(vRouteAt, \(\) => vRoute\);/);
  assert.match(desk, /CHATS\.takeComposer\(sealAt\.wid, sealAt\.sid, sealAt\.box\)/);
});

test('a box-mic take resumed after a reload (no tap pin left) still files into the channel carried by the take', async () => {
  const h = harness(); // no mic tap in this page: the pin comes with the take (phone replyTake, desktop vReply)
  const it = await h.api.sendVoiceTo('win', '__new__', new Blob(['a']), [], false, null, null, null, undefined, '', 'launch');
  assert.equal(h.sent[0].space, false); assert.deepEqual(h.filed, [['launch', it.sessionId, true]]);
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(app, /\.\.\.\(typeof r\.box === 'string' \? \{ box: r\.box \} : \{\}\), \.\.\.\(typeof r\.space === 'string' \? \{ space: r\.space \} : \{\}\)/, 'the reply-take record keeps box and Space over a reload');
  assert.match(app, /CHATS\.sendVoiceTo\(rt\.wid, rt\.sid, audio, files, snap\.seal \|\| false, snap\.route, snap\.custodyId, null, undefined, '', rt\.space\)/);
});

// The real addFiles from core/chats.js: an upload that finishes after another channel opened is saved with its own
// channel (its parked tray), and a failed one leaves that tray; the box in front is never written with it.
test('an upload finishing in a parked channel tray is saved to that channel; a failed one leaves it', async () => {
  const a = chats.indexOf('  async function addFiles(wid, list) {'), b = chats.indexOf('  const UPLOAD_ABORT = new Map();');
  const d = {}, c = { files: [], chanTrays: new Map() }, saves = [];
  let release; const gate = new Promise(r => { release = r; });
  const ctx = { INC: null, PEND: null, PREVIEW: {}, ch: () => c, refreshCompose() {}, paintUpload() {}, toast() {}, saveDraft: () => saves.push('front'), AbortController, URL: { createObjectURL: () => 'blob:x' },
    UPLOAD_ABORT: new Map(), KIT: { drafts: { get: k => d[k] || { text: '', files: [] }, set: (k, text, files = []) => { d[k] = { text, files: files.filter(f => f.id && !f.uploading) }; } } },
    uploadFile: async file => { await gate; if (file.name === 'bad.png') throw new Error('nope'); return { id: 'up-' + file.name, name: file.name, mime: file.type, bytes: 1 }; } };
  vm.createContext(ctx); vm.runInContext(chats.slice(a, b) + ';this.addFiles=addFiles;', ctx);
  d['chan:hermes:launch'] = { text: 'launch words', files: [] };
  const run = ctx.addFiles('win', [{ name: 'ok.png', type: 'image/png', size: 1 }, { name: 'bad.png', type: 'image/png', size: 1 }]);
  const parked = c.files; c.chanTrays.set('chan:hermes:launch', parked); c.files = []; // # Voice opened meanwhile
  release(); await run;
  assert.deepEqual(d['chan:hermes:launch'].files.map(f => f.id), ['up-ok.png'], 'saved with # Launch, the failed one gone');
  assert.equal(d['chan:hermes:launch'].text, 'launch words');
  assert.deepEqual(parked.map(f => f.name), ['ok.png'], 'the failed upload left the parked tray');
  assert.equal(c.files.length, 0, 'the box in front never got it');
});
