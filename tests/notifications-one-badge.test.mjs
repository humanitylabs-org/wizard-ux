import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Miguel (2 Nov 2026): each app's notifications go to exactly one place. With Notifications in Chats on, they are
// Chats Ready rows and count on the Chats badge; the Notifications app badge must not count them again.
const src = readFileSync(new URL('../web/core/notif-bell.js', import.meta.url), 'utf8');

async function load(inboxList) {
  const counts = {}, listeners = {};
  const window = { WosSkinHost: { inboxList }, WizCore: { backendApps: () => [{ id: 'notifications' }], workspaceNav: { setCount: (k, n) => { counts[k] = n; } } }, dispatchEvent() {} };
  const items = [{ id: 'a', read: false }, { id: 'b', read: false }, { id: 'c', read: true }];
  const ctx = { window, document: { querySelectorAll: () => [], addEventListener() {} }, location: { origin: 'https://wizard.example.test' },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); }, setInterval() {}, setTimeout() {}, CustomEvent: class { constructor(type) { this.type = type; } },
    fetch: async url => ({ ok: true, json: async () => url.includes('/items') ? { items } : { unread: 2, needs: 0 } }) };
  vm.runInNewContext(src, ctx);
  window.WosBell.watch(() => {});
  await window.WosBell.refresh(true); await new Promise(r => setImmediate(r));
  return { window, counts, fire: t => (listeners[t] || []).forEach(fn => fn({})) };
}

test('Notifications in Chats on: the items count on Chats only, the Notifications badge is empty', async () => {
  const { window, counts } = await load(true);
  assert.equal(window.WosBell.readyCount(), 3, 'Chats Ready counts its notification rows');
  assert.equal(counts.notifications, 0, 'the Notifications app badge does not count them again');
});

test('Notifications in Chats off: the Notifications badge counts unread, Chats counts none', async () => {
  const { window, counts } = await load(false);
  assert.equal(window.WosBell.readyCount(), 0);
  assert.equal(counts.notifications, 2);
});

test('turning Notifications in Chats on or off moves the count at once (wos:prefs)', async () => {
  const { window, counts, fire } = await load(false);
  assert.equal(counts.notifications, 2);
  window.WosSkinHost.inboxList = true; fire('wos:prefs');
  assert.equal(counts.notifications, 0);
  window.WosSkinHost.inboxList = false; fire('wos:prefs');
  assert.equal(counts.notifications, 2);
});
