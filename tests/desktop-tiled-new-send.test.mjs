import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Execute the shipped capture handler and the actual composer-mic handoff branch.
// Browser-free branch regression with James's return-to-list tweak explicitly ON, not proof of client geometry.
const root = process.env.QA_POLICY_TREE || path.resolve(import.meta.dirname, '..');
test('return-to-list is discoverable but excluded from defaults and legacy author recipes', () => {
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'web/tweaks/catalog.json'),'utf8'));
  const profile=JSON.parse(fs.readFileSync(path.join(root,'web/tweaks/wizard/profile.json'),'utf8'));
  assert.ok(catalog.tweaks.includes('wizard/new-send-list')); assert.equal(catalog.defaults.includes('wizard/new-send-list'),false); assert.equal(profile.tweaks.includes('wizard/new-send-list'),false);
});
const source = fs.readFileSync(path.join(root, 'web/desktop/desktop.js'), 'utf8');
function fixture({ viewport = 1920, count = 2, mono = false, sid = '__new__', narrow = false, focus = null, optIn = true } = {}) {
  const timers = [], w = { id: 'qa', app: 'chats', thread: sid, focus }, desk = { wins: count === 2 ? ['qa', 'other'] : ['qa'], mono };
  const width = narrow ? 580 : count === 2 && !mono ? Math.min(1200, (viewport - 24) / 2) : Math.min(1200, viewport - 16);
  let submit, attr = sid;
  const el = { dataset: { win: 'qa' }, contains: () => true, querySelector: () => ({ getBoundingClientRect: () => ({ width }) }) };
  const ta = { value: 'Synthetic retained words' }, form = { querySelector: () => ta, closest: () => el };
  const context = vm.createContext({
    W: { qa: w }, ws: [desk], wsOf: () => 0, winEl: () => el,
    stage: { addEventListener: (_name, fn) => { submit = fn; } },
    mainChats: x => x?.app === 'chats' && !x.agent, focused: () => w, hud: null, homeOpen: false,
    document: { activeElement: null, documentElement: {} }, getComputedStyle: () => ({getPropertyValue: () => optIn ? 'on' : ''}), setTimeout: (fn, ms) => timers.push({ fn, ms }),
    CHATS: { sendVoiceTo: () => { context.leaveAfterSend('qa', sid, sid === '__new__'); } },
    syncChatsPane() { attr = w.thread || ''; }, focusInside() {}, log() {}, toast() {},
    rp: { wid: 'qa', sid }, r: { blob: {} }, extraFiles: [], sealed: false,
    modelRoute: {}, stagedId: null, transcript: '',
  });
  const shared = fs.readFileSync(path.join(root, 'web/core/chats.js'), 'utf8');
  const start = shared.indexOf('  function leaveAfterSend('), end = shared.indexOf('\n  }', start) + 4;
  Object.assign(context, { keepThreadOpen: () => true, H: { keepThreadOpen: true }, PHONE: () => false, hosted: new Map(),
    ch: () => ({trail: [], readNav: 0}), save() {}, threadBack() {}, renderChats() {}, applyLayout() {}, deskOf: () => 0 });
  vm.runInContext(shared.slice(start, end), context);
  return { w, desk, width, get attr() { return attr; },
    text() { context.leaveAfterSend('qa', sid, sid === '__new__'); attr = w.thread || ''; },
    voice() {
      const line = source.split('\n').find(x => x.includes('if (rp) { CHATS.sendVoiceTo(') || x.includes('if (rp) { const stayOnList'));
      assert.ok(line, 'actual composer-mic handoff branch found');
      vm.runInContext(`(function () { ${line} })()`, context);
    },
    drain() { for (let n = 0; n < timers.length; n++) timers[n].fn(); },
  };
}
for (const mode of ['text', 'voice']) test(`new ${mode} keeps the shared new-send list return`, () => {
  const f = fixture({optIn:false, count:1, viewport:1920}); f[mode](); f.drain(); assert.equal(f.w.thread,null); assert.equal(f.attr,'');
});
for (const viewport of [1280, 1920, 2560]) for (const mode of ['text', 'voice']) {
  test(`half-width desktop ${viewport}: new ${mode} keeps list past the shell timer`, () => {
    const f = fixture({ viewport }); f[mode](); f.drain();
    assert.equal(f.w.thread, null, `half-width ${f.width}px is layout ownership, not a 620px breakpoint`);
    assert.equal(f.attr, '', 'desktop pane projection also leaves New chat');
  });
}
test('new text leaves a later visit and failed-save recovery untouched', () => {
  for (const destination of ['qa_other', '__new__']) {
    const f = fixture(); f.text(); f.w.thread = destination; f.drain(); assert.equal(f.w.thread, destination);
  }
});
for (const viewport of [595,1190,1920]) for (const mode of ['text', 'voice']) test(`single OS window ${viewport}px new ${mode} returns to list`, () => {
  const f = fixture({ count: 1, viewport }); f[mode](); f.drain(); assert.equal(f.w.thread, null); assert.equal(f.attr, '');
});
test('fullscreen new send also keeps shared list return', () => {
  const f = fixture({ mono: true }); f.text(); f.drain(); assert.equal(f.w.thread, null);
});
for (const mode of ['text','voice']) for(const count of [1,2]) test(`existing ${mode} reply (${count} windows) stays on the same thread`, () => {
  const f = fixture({ sid: 'qa_existing', count }); f[mode](); f.drain(); assert.equal(f.w.thread, 'qa_existing');
});
test('pre-existing narrow new-text guard is retained', () => {
  const f = fixture({ narrow: true }); f.text(); f.drain(); assert.equal(f.w.thread, null);
});
for (const viewport of [595,1190]) for (const mode of ['text', 'voice']) for (const focus of [null, { kind: 'agent', key: 'hermes' }]) {
  test(`single OS window ${viewport}px ${mode}, ${focus ? 'saved main-agent Focus' : 'main launcher'}: does not reopen New chat`, () => {
    const f = fixture({ count: 1, viewport, focus });
    f[mode](); f.drain();
    assert.equal(f.w.thread, null);
    assert.equal(f.attr, '');
    assert.equal(f.desk.wins.length, 1, 'an OS-window regression must not silently use two shell tiles');
    assert.deepEqual(f.w.focus, focus, 'list return must retain saved Focus');
  });
}
