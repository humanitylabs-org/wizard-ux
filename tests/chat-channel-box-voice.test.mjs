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
