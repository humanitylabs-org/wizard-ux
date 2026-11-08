import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

function nav() {
  const c = {
    console,
    Set,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    dispatchEvent() {},
    WosBell: { unreadCount: () => 0, readyMore: () => false, inChats: () => false, isOff: () => false },
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(read('web/core/workspace-navigation.js'), c);
  return c.WizCore.workspaceNav;
}

test('Chats unread excludes Working while keeping Working independently countable', () => {
  const readyUnread = { id: 'ready-unread' };
  const workingUnread = { id: 'working-unread' };
  const readReady = { id: 'read-ready' };
  const rows = [readyUnread, workingUnread, readReady];
  const live = {
    ok: true,
    unified: () => rows,
    visibleUnread: received => [received[0], received[1]],
    workGroups: received => ({ ready: [received[0], received[2]], working: [received[1]] }),
  };
  const api = nav();
  assert.equal(api.chatUnreadCount(live), 1);
  assert.equal(live.workGroups(rows).working.length, 1);
  api.refreshChats(live);
  assert.equal(api.counts.wizard, 1);
  assert.equal(api.chatUnreadCount({ ...live, ok: false }), 0);
});

test('phone orb exposes authoritative uncapped status counts before painting capped dots', () => {
  const app = read('web/app.js');
  for (const key of ['needs', 'working', 'ready']) assert.match(app, new RegExp(`moons\\.dataset\\.${key} = String\\(L\\.${key}\\.length\\)`));
  assert.ok(app.indexOf('moons.dataset.working') < app.indexOf('moons.innerHTML'), 'counts publish before capped dot markup');
});