// The Running view in the AI apps sidebar (wizard-ux issue 1599, on for everyone; switch wizard/ai-apps-running removed): the
// real core/chats-running.js part with stand-ins for the Chats names and the desktop's H.runningPane.
// Browser proof: tests/qa-agent-inbox-running.cjs (shell ai-apps).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const rec = { id: 'inbox_' + 'a'.repeat(24), agent: 'hermes', thread: 'wizard_worker_1', title: 'Lisbon flights', update: 'Comparing fares', state: 'running', createdAt: Date.now() - 25 * 60e3, updatedAt: Date.now() - 3 * 60e3 };

function part({ tweaks = '', pane = 'main::side', agent = '' } = {}) {
  const window = { WizCore: {}, addEventListener() {} };
  const document = { documentElement: { dataset: { tweaks } } };
  vm.runInNewContext(readFileSync(new URL('../web/core/chats-running.js', import.meta.url), 'utf8'), { window, document });
  const CH = {}, ch = id => (CH[id] ||= {}), painted = [], reads = [];
  const agentInbox = { state: () => ({ ok: true }), records: a => (a === 'hermes' ? [rec] : []), fresh: () => reads.push('fresh'), read: () => reads.push('read') };
  const H = { win: () => null, runningPane: pane === null ? undefined : () => (pane ? { id: pane, thread: null } : null) };
  const api = window.WizCore.chatsParts.running({ ago: () => '3m', ch, CH, chanStore: () => null, clip: (t, n) => String(t).slice(0, n), esc: String, H,
    KIT: null, LIVE: { agentInbox, sessions: [] }, paintListsNow() {}, PIN: {}, renderThreadNow() {}, rerenderList: w => painted.push(w.id), STI: {},
    storeAgent: () => '', toast() {}, W: {}, winAgent: () => agent });
  return { api, ch, painted, reads, document };
}

test('no switch: the Running link opens the view in the sidebar pane (Sent steps aside), and Back leaves it', () => {
  const f = part();
  f.ch('main::side').sent = true;
  assert.equal(f.api.runningSideGo(), true, 'the sidebar took it');
  assert.equal(f.ch('main::side').running, true);
  assert.equal(f.ch('main::side').sent, false, 'the view takes the pane\'s place, Sent included');
  assert.deepEqual(f.painted, ['main::side'], 'the pane repaints at once');
  assert.deepEqual(f.reads, ['fresh', 'read'], 'the inbox is read fresh');
  const side = { id: 'main::side', thread: null };
  assert.equal(f.api.runningOpen(side), true);
  const body = f.api.runningBody();
  assert.match(body, /data-chrunopen="wizard_worker_1"/, 'a row opens the task');
  assert.match(body, /Lisbon flights.*Comparing fares.*Running 25 min/s);
  assert.equal(f.api.runningBack(side), true, 'Esc / ‹: back to the sidebar list');
  assert.equal(f.api.runningOpen(side), false);
  f.ch('main').running = true;
  assert.equal(f.api.runningOpen({ id: 'main', thread: null }), true, 'the Classic / phone list window is unchanged');
});

test('the switch and its package are gone', () => {
  const read = q => readFileSync(new URL('../' + q, import.meta.url), 'utf8'), ID = 'wizard/ai-apps-running';
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(!cat.tweaks.includes(ID) && !(cat.defaults || []).includes(ID));
  assert.equal(existsSync(new URL('../web/tweaks/wizard/ai-apps-running', import.meta.url)), false);
  assert.ok(!Object.values(JSON.parse(read('skill/help.json'))).some(g => g && typeof g === 'object' && Object.hasOwn(g, ID)));
});
