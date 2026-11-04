import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(process.env.APP_KINDS_FILE ? resolve(process.env.APP_KINDS_FILE) : new URL('../web/core/app-kinds.js', import.meta.url), 'utf8');

function classify() {
  const mainAgent = { id: 'hermes', label: 'Personal', is_default: true };
  const backend = [
    { id: 'transcriber', name: 'Transcriber', kind: 'wizard', type: 'service' },
    { id: 'wizard-google', name: 'Google', kind: 'wizard', type: 'external' },
  ];
  const routeOpens = [];
  const window = {
    WizCore: { backendApps: () => backend },
    WizConfig: { agent: () => 'Fallback' },
    WosSkinHost: { inboxThreads: true },
    WosAgents: { list: [mainAgent], defaultId: () => 'hermes', get: id => id === 'hermes' ? mainAgent : null },
    WosAppRoute: { open: (...args) => routeOpens.push(args) },
  };
  vm.runInNewContext(source, { window });
  const APPS = [
    { id: 'wizard', name: 'Chats', kind: 'chats' },
    { id: 'agent:private', name: 'Private Agent', kind: 'chats', agent: 'private' },
    { id: 'pages', name: 'Pages', kind: 'wizard', screen: true },
    { id: 'notifications', name: 'Notifications', kind: 'wizard', url: '/notifications/' },
    { id: 'sync-helper', name: 'Sync helper', kind: 'wizard', type: 'service' },
  ];
  const APP = Object.fromEntries(APPS.map(a => [a.id, a]));
  return { AK: window.WosAppKinds, APPS, APP, routeOpens };
}

test('owner-operated apps and specialist groups stay correctly separated', () => {
  const { AK, APPS, APP } = classify();
  const K = AK.kinds(APPS, APP);
  const ids = list => Array.from(list, a => a.id).sort();
  assert.deepEqual(ids(K.apps), ['notifications', 'pages', 'wizard']);
  assert.equal(K.apps.find(a => a.id === 'wizard').name, 'Personal Main Agent');
  assert.deepEqual(ids(K.agents), ['agent:private']);
  assert.deepEqual(ids(K.wiz), ['sync-helper', 'transcriber']);
  assert.deepEqual(ids(K.conns), ['wizard-google']);
  assert.equal(AK.inChats(APP.notifications), true);
  assert.equal(AK.opensScreen(APP.pages), true);
  assert.equal(AK.opensScreen(APP['sync-helper']), false);
});

test('shared rows keep the same groups and route screens versus screenless settings correctly', () => {
  const { AK, APPS, APP, routeOpens } = classify();
  const rows = AK.rows(APPS, APP, a => a.id);
  assert.deepEqual(Array.from(rows.apps, a => a.id).sort(), ['notifications', 'pages', 'wizard']);
  assert.deepEqual(Array.from(rows.agents, a => a.id), ['agent:private']);

  const opened = [];
  assert.equal(AK.openRow(APPS, APP, 'pages', id => { opened.push(id); return true; }), true);
  assert.deepEqual(opened, ['pages']);
  assert.equal(AK.openRow(APPS, APP, 'sync-helper', () => false), true);
  assert.equal(routeOpens.length, 1);
  assert.equal(routeOpens[0][0], 'sync-helper');
  assert.equal(routeOpens[0][1].name, 'Sync helper');
});
