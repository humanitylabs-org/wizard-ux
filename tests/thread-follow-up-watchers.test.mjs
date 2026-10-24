import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chats = fs.readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const live = fs.readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');

test('active follow-ups keep Snooze, make Done temporary, and expose explicit Stop watching', () => {
  assert.match(chats, /followUpActive\(s\)/);
  assert.match(chats, /Done for now/);
  assert.match(chats, /Stop watching/);
  assert.match(chats, /\['snooze', 'stop_watch', 'done'\]/);
  assert.match(chats, /LIVE\.stopWatching\(sid, LIVE\.ownerOf \? LIVE\.ownerOf\(s\) : undefined\)/);
  assert.match(chats, /if \(watching && \(WORKING_ST\.has\(s\.status\)[^\n]*return \['stop_watch'\];/);
});

test('archived watcher checks stay out of Working while their silent run is active', () => {
  const grouping = live.slice(live.indexOf('function groupWork'), live.indexOf('async function fetchDispositions'));
  assert.ok(grouping.indexOf('if (s.archived)') < grouping.indexOf('else if (inWorking(s))'));
});

test('Done and Snooze remain presentation actions; only Stop watching hits the cancellation route', () => {
  assert.match(live, /stopWatching\(id, agent\)/);
  assert.match(live, /\/wizard\/follow-ups\/stop/);
  const archive = live.slice(live.indexOf('archive(id,'), live.indexOf('async stopWatching'));
  const defer = live.slice(live.indexOf('async _defer'), live.indexOf('/* Rename:'));
  assert.doesNotMatch(archive, /follow-ups\/stop|stopWatching/);
  assert.doesNotMatch(defer, /follow-ups\/stop|stopWatching/);
});

test('the full-list normalizer preserves the service watcher projection', () => {
  assert.match(live, /followUp: followUpOf\(item\.wizard_follow_up\)/);
});
