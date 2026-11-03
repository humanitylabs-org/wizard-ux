// An app that lists only its newest items (Mail: newest 50 unread) shows "50+", not a number that looks exact
// (Miguel, 1 Nov 2026). Its own badge and, when routed to Chats, the Chats badge both say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

function nav() {
  const events = [], window = { WizCore: {}, dispatchEvent: e => events.push(e), CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } } };
  vm.runInNewContext(read('web/core/workspace-navigation.js'), { window, CustomEvent: window.CustomEvent });
  return { N: window.WizCore.workspaceNav, events };
}

test('fmt adds a plus for a capped count and keeps 99+ above 99', () => {
  const { N } = nav();
  assert.equal(N.fmt(50, true), '50+'); assert.equal(N.fmt(50), '50'); assert.equal(N.fmt(150, true), '99+');
});

test('an app reporting more shows N+ on its desk mark; turning it off repaints', () => {
  const { N, events } = nav();
  const desk = { wins: ['w1'] }, wins = { w1: { app: 'frame' } }, appOf = () => ({ id: 'wizard-mail' });
  N.setCount('wizard-mail', 50, true);
  assert.equal(N.deskMore(desk, wins, appOf), true);
  const n = events.length; N.setCount('wizard-mail', 50, false);
  assert.ok(events.length > n, 'losing the plus repaints even when the number is the same');
  assert.equal(N.deskMore(desk, wins, appOf), false);
});

test('apps pass { more } through the badge API; Chats reads it from routed feeds', () => {
  assert.match(read('web/core/app-client.js'), /request\('badge\.set', \{ n, more \}\)/, 'the app SDK forwards more');
  assert.match(read('web/core/app-services.js'), /svc\.badge\.set\(d\.args\?\.n, \{ more: d\.args\?\.more === true \}\)/);
  assert.match(read('web/core/app-services.js'), /set\(n, o\) \{ check\(\); setBadge\(st\.appId, n, !!\(o && o\.more === true\)\)/);
  const bell = read('web/core/notif-bell.js');
  assert.match(bell, /FD\.more\[id\] = d\.more === true \|\| d\.items\.length > 50/);
  assert.match(bell, /const readyMore = \(\) => .*inChats\(id\)/);
  for (const f of ['web/app.js', 'web/desktop/desktop.js']) assert.match(read(f), /!!window\.WosBell\?\.readyMore\?\.\(\)\);/, f);
});
