// A reload keeps the AI apps main column's open channel feed (wizard-ux issue 1339). The desktop saves feedBase (the
// feed's stand-in list window) with the desks and reads it back at boot. Sliced from the real desktop.js and run in a vm:
// save() runs once before feedBase's own line, so it must neither throw nor wipe the saved feed then.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js = fs.readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const line = start => { const l = js.split('\n').find(x => x.startsWith(start)); assert.ok(l, start); return l; };
const block = (a, b) => { const i = js.indexOf(a), j = js.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return js.slice(i, j); };

function boot(saved) {
  const data = { feed: saved };
  const store = { get: (k, d) => (k in data ? JSON.parse(JSON.stringify(data[k])) : d), set: (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); } };
  const ctx = { store, data, W: {}, ws: [], cur: 0, hud: null, window: {}, desktop: null };
  vm.createContext(ctx);
  const src = [
    line('  const feedSaved = store.get('),
    line('  const save = () => {'),
    'save();', // the boot's first save (normalised desks) comes before feedBase's line
    'this.afterFirstSave = JSON.stringify(data.feed);',
    line('  var feedBase = null;'),
    block('  // A reload (an update\'s too) opens the channel feed', '  // The window behind the sidebar\'s Channels pane'),
    'this.feed = () => feedBase; this.save = save;',
  ].join('\n');
  vm.runInContext(src, ctx);
  return ctx;
}

const open = { id: 'feed-wq1', chan: { id: 'launch', prev: { kind: 'agent', key: 'hermes' } }, focus: { kind: 'space', key: 'launch' } };

test('a saved channel feed comes back after a reload, and the first boot save keeps it', () => {
  const x = boot(open);
  assert.equal(x.afterFirstSave, JSON.stringify(open), 'the save before feedBase\'s line leaves the saved feed alone');
  assert.deepEqual(JSON.parse(JSON.stringify(x.feed())), { id: 'feed-wq1', app: 'chats', thread: null, focus: { kind: 'space', key: 'launch' }, chan: { id: 'launch', prev: { kind: 'agent', key: 'hermes' } } });
  x.save();
  assert.deepEqual(x.data.feed, open, 'saved again as it was');
});

test('opening and closing a feed is saved with the desks', () => {
  const x = boot(null);
  assert.equal(x.feed(), null);
  vm.runInContext("feedBase = { id: 'feed-wq2', app: 'chats', thread: null, focus: { kind: 'agent', key: 'hermes' }, chan: { id: '__general__', prev: null } }; save();", x);
  assert.deepEqual(x.data.feed, { id: 'feed-wq2', chan: { id: '__general__', prev: null }, focus: { kind: 'agent', key: 'hermes' } });
  vm.runInContext('feedBase.chan = null; save();', x);
  assert.equal(x.data.feed, null, 'a closed feed is not reopened by the next reload');
});

test('a damaged saved feed is ignored, never thrown on', () => {
  for (const bad of ['x', 3, [], { id: 'w1', chan: { id: 'launch' } }, { id: 'feed-a', chan: null }, { id: 'feed-a', chan: { id: 7 } }, { id: 'feed-<b>', chan: { id: 'launch' } }]) {
    assert.equal(boot(bad).feed(), null, JSON.stringify(bad));
  }
  const odd = boot({ id: 'feed-a', chan: { id: 'launch', prev: 'x', extra: 1 }, focus: { kind: 5 } }).feed();
  assert.deepEqual(JSON.parse(JSON.stringify(odd)), { id: 'feed-a', app: 'chats', thread: null, focus: null, chan: { id: 'launch', prev: null } });
});
