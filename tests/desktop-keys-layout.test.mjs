import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../web/desktop.html', import.meta.url), 'utf8');

test('holding ⌥ is the one keys guide: speak keys named and explained, no separate sheet', () => {
  assert.doesNotMatch(js, /const KEYS = \[/);
  for (const name of ['Talk about this', 'New voice chat', 'Tell the computer', 'Type with your voice', 'Switch what you see', 'This window']) assert.ok(js.includes(name), name);
  assert.match(js, /function toggleKeys\(on\) \{[^\n]*keyHints\.show\(true\)/);
  assert.match(js, /if \(keyHints\.pinned\(\)\) \{ toggleKeys\(false\)/);
});

test('⌥S speaks about the screen, ⌥C speaks a command, ⌥D dictates', () => {
  assert.match(js, /code === 'KeyS' \|\| code === 'KeyC' \|\| code === 'KeyD'/);
  assert.match(js, /code === 'KeyS' \? speakScreen\(\) : commandVoice\(\)/);
  assert.match(js, /if \(code === 'KeyD'\) \{[\s\S]*?return dictate\(\);/);
  for (const [id, key] of [['micBtn', 'Alt\\+S'], ['commandBtn', 'Alt\\+C'], ['dictateBtn', 'Alt\\+D']]) assert.match(html, new RegExp(`id="${id}"[^>]*aria-keyshortcuts="${key}"`));
});

test('holding left ⌥ alone shows key hints; any other key or release hides them', () => {
  assert.match(js, /if \(pinned \|\| e\.repeat \|\| e\.code !== 'AltLeft'/);
  assert.match(js, /keyHints\.down\(e\)/);
  assert.match(js, /addEventListener\('keyup', e => keyHints\.up\(e\), true\)/);
  assert.match(js, /doc\.addEventListener\('keyup', e => keyHints\.up\(e\), true\)/);
});

test('⌥S only sends its own kind of take', () => {
  assert.match(js, /function speakScreen\(\) \{[\s\S]*?vMode === 'talk' && !vNewChat && !commandTake\) return talk\('send'\)/);
});

test('⌥↓/⌥↑ walk Ready chats only; ⌥←/⌥→ hop between list and message box; the guide explains both', () => {
  assert.match(js, /\.ch-sec\[data-sec="ready"\] \.ch-row\[data-chopen\]/);
  assert.match(js, /chatsUpDown\(code === 'ArrowDown' \? 1 : -1\)/);
  assert.match(js, /chatsZone\(f\) === 'thread' && f\.thread/);
  assert.match(js, /if \(!chatsSide\(d\)\) dirFocus\(d, 0\)/);
  assert.ok(js.includes("'Top ready chat'") && js.includes("<h5>Ready chats</h5>"));
});

test('⌥E Done and ⌥Z Snooze act on the open chat; the guide shows chat keys in a thread', () => {
  assert.match(js, /code === 'KeyE' \|\| code === 'KeyZ'/);
  assert.match(js, /CHATS\.threadAct\(f\.id, f\.thread, act\)/);
  assert.match(js, /\['\[data-chact="done"\]', 'E'\], \['\[data-chact="snooze"\]', 'Z'\]/);
  assert.ok(js.includes("['Enter', 'Send', `Then") && js.includes("'This chat'"));
});

test('after a send, focus returns to the chat list; list-side ⌥↑↓ walk Ready only', () => {
  assert.match(js, /stage\.addEventListener\('submit', e => \{[\s\S]*?send:list-focus/);
  assert.match(js, /return stepReady\(dir\); \/\/ list side/);
});
test('desktop recordings skip echo cancellation (no music ducking) and pick a wired mic explicitly', async () => {
  const { readFileSync: r } = await import('node:fs');
  const v = r(new URL('../web/core/voice.js', import.meta.url), 'utf8');
  assert.match(v, /echoCancellation: PHONE/);
  assert.match(v, /if \(wired\) return wired\.deviceId/);
});
