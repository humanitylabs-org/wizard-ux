// Archive and other one-tap list actions paint on the tap's own frame, never after the backend (James, 7 Nov 2026).
// The browser proof is tests/qa-archive-instant.cjs (held backend, stale poll, failure restore; phone + desktop, two skins).
// Runs it when QA_PLAYWRIGHT points at a playwright module; otherwise this static guard keeps the wiring in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const aad = readFileSync(new URL('../web/layouts/ai-apps/desktop.js', import.meta.url), 'utf8');
test('threadAct starts the write, paints every list, and only then awaits', () => {
  const body = chats.slice(chats.indexOf('async function threadAct('), chats.indexOf('/* Threads and alerts share'));
  assert.match(body, /const write = a === 'done' \? LIVE\.archive\(sid\)[^\n]*\n\s*paintListsNow\(\);\s*\n\s*const ok = await write;/);
  assert.doesNotMatch(body, /await \(a === 'done'/);
  assert.match(chats, /const holdList = id => \{\s*if \(paintForced\) return false;/);
});
test('Archive row action in the AI apps sidebar repaints before its 120 ms pass', () => {
  assert.match(aad, /api\.sessions\.act\(s\.id, k\); readSessions\(\); paintList\(true\);/);
});
test('a write that never answers cannot pin a thread out of its list', () => {
  assert.match(live, /setTimeout\(\(\) => no\(new Error\('write timed out'\)\), capMs\)/);
  assert.match(live, /\}, file \? 11 \* 60000 : 60000\);/); // Close & file polls for up to 10 minutes: its cap outlasts that
});
test('browser regression (held backend, stale poll, failure)', { skip: !process.env.QA_PLAYWRIGHT }, () => {
  const r = spawnSync(process.execPath, [new URL('./qa-archive-instant.cjs', import.meta.url).pathname], { encoding: 'utf8', env: { ...process.env, QA_SKINS: 'nebula' } });
  assert.equal(r.status, 0, r.stdout.slice(-3000));
});
