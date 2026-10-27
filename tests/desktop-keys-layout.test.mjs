import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../web/desktop.html', import.meta.url), 'utf8');

test('holding ⌥ is the one keys guide: speak keys named and explained, no separate sheet', () => {
  assert.doesNotMatch(js, /const KEYS = \[/);
  for (const name of ['Talk about this', 'New voice chat', 'Tell the computer', 'Type with your voice']) assert.ok(js.includes(name), name);
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

test('⌥↓/⌥↑ walk Ready chats from anywhere into the message box; no ⌥←/⌥→ list hop', () => {
  assert.match(js, /\.ch-sec\[data-sec="ready"\] \.ch-row\[data-chopen\]/);
  assert.match(js, /chatsUpDown\(code === 'ArrowDown' \? 1 : -1\)/);
  assert.match(js, /function chatsUpDown\(dir\) \{ return stepReady\(dir\); \}/);
  assert.doesNotMatch(js, /chatsSide|chatsZone/);
  assert.match(js, /focusInside\(f\.id\); \}, 30\); \/\/ straight into the message box/);
  assert.ok(js.includes("'Next ready chat'"));
});

test('⌥E Done and ⌥Z Snooze act on the open chat; the guide shows chat keys in a thread', () => {
  assert.match(js, /code === 'KeyE' \|\| code === 'KeyZ'/);
  assert.match(js, /CHATS\.threadAct\(f\.id, f\.thread, act\)/);
  assert.match(js, /code === 'ArrowLeft' \|\| code === 'ArrowRight'\) && chatOpen\(\)\) return hit/);
  assert.match(js, /code === 'ArrowLeft' \|\| code === 'ArrowRight'\) && chatOpen\(\)\) return hit\(\(\) => \{ if \(!e\.repeat\) chatAct\(code === 'ArrowRight' \? 'done' : 'snooze'/);
  assert.match(js, /\['\[data-chact="done"\]', '→', 'Done'\], \['\[data-chact="snooze"\]', '←', 'Snooze'\]/);
  assert.match(js, /chip\(next, '↓', 'inside'\)/);
});

test('after a text or voice reply is sent, the window goes back to a focused New chat', () => {
  assert.match(js, /stage\.addEventListener\('submit', e => \{[\s\S]*?toNewChat\(wid, 'text'\)/);
  assert.match(js, /function toNewChat\(wid, why\) \{[\s\S]*?CHATS\.openNewDraft\(wid, ''\)[\s\S]*?focusInside\(wid\)/);
  assert.match(js, /Voice reply · waiting to send', 1400\); setTimeout\(\(\) => toNewChat\(rp\.wid, 'voice'\)/);
});
test('desktop recordings skip echo cancellation (no music ducking) and pick a wired mic explicitly', async () => {
  const { readFileSync: r } = await import('node:fs');
  const v = r(new URL('../web/core/voice.js', import.meta.url), 'utf8');
  assert.match(v, /echoCancellation: PHONE/);
  assert.match(v, /if \(wired\) return wired\.deviceId/);
});

test('Home is ⌥` (again goes back); desktops are ⌥1…9 from the first desk', async () => {
  const { readFileSync: r } = await import('node:fs');
  const nav = r(new URL('../web/core/workspace-navigation.js', import.meta.url), 'utf8');
  const C = {}; new Function('window', nav)({ WizCore: C });
  assert.deepEqual(C.workspaceNav.digitTarget(1, 3), { kind: 'desktop', index: 0 });
  assert.deepEqual(C.workspaceNav.digitTarget(4, 3), { kind: 'new', index: 3 });
  assert.equal(C.workspaceNav.digitTarget(5, 3), null);
  assert.equal(C.workspaceNav.slot(0), 1);
  assert.match(js, /code === 'Backquote'\) return hit\(\(\) => \{ if \(e\.repeat\) return; if \(homeOpen\) \{ leaveHome\(\)/);
  assert.doesNotMatch(js, /code === 'Digit1'\) return hit/);
  assert.ok(js.includes("['`', 'Home', 'Again to go back']") && js.includes("['1–9', 'Desktop 1 to 9'"));
});

test('⌥G Pick anything: letter chips on every clickable, typed letters click it, guide lists it', () => {
  assert.match(js, /code === 'KeyG'\) return hit\(\(\) => \{ if \(!e\.repeat\) pick\.start\(\); \}\)/);
  assert.match(js, /function onKey\(e, fromFrame = false\) \{\n    if \(pick\.active\(\)\) return pick\.key\(e\);/);
  assert.match(js, /\[data-chopen\],\[data-chdraft\]/);
  assert.match(js, /querySelectorAll\('iframe'\)/);
  assert.ok(js.includes("['G', 'Pick anything',"));
});

test('the keys guide is chips in place, no boxes: ↓ on the next Ready chat, F W R on window buttons, H J K L on neighbours, words only on Speak', () => {
  assert.doesNotMatch(js, /kh-card|function card\(/);
  assert.match(js, /rows\[0\] : rows\[\(i \+ 1\) % rows\.length\]/);
  assert.match(js, /\['\[data-wact="mono"\]', 'F'\], \['\[data-wact="close"\]', 'W'\], \['\[data-wact="reload"\]', 'R'\]/);
  assert.match(js, /\(dx < 0 \? 'H' : 'L'\) : \(dy < 0 \? 'K' : 'J'\)/);
  assert.match(js, /\['#micBtn', 'S', 'Talk about this'\]/);
})

test('guide: → ← sit above Done / Snooze; no "/" chip on chat search', () => {
  assert.match(js, /filter\(vis\)\.map\(n => chip\(n, l, 'above'\)\)/);
  assert.doesNotMatch(js, /chip\(srch, '\/'/);
});

test('guide extras: ↓ on Home, [ ] on neighbour desks, ↑ on the previous Ready chat, I on chat search; ⌥I again searches chats', () => {
  assert.match(js, /\$\('#desktopHome \[data-home-act="ready"\]'\) \|\| \$\('#desktopHome \.home-card \.home-row'\)/);
  assert.match(js, /\[\['\[', \(cur - 1 \+ ws\.length\) % ws\.length\], \['\]', \(cur \+ 1\) % ws\.length\]\]/);
  assert.match(js, /chip\(prev, '↑', 'inside'\)/);
  assert.match(js, /chip\(srch, 'I', 'inside'\)/);
  assert.match(js, /log\('key:search-chats'\)/);
  assert.match(js, /chip\(cancel, 'Esc'\)/);
});
