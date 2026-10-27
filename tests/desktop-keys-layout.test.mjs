import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../web/desktop.html', import.meta.url), 'utf8');

test('keys sheet leads with speaking, then switching what you see', () => {
  const groups = [...js.slice(js.indexOf('const KEYS = ['), js.indexOf("const keysEl = $('#keys')")).matchAll(/^\s{4}\['([^']+)'/gm)].map(m => m[1]);
  assert.deepEqual(groups, ['Speak and ask · same key again sends', 'Switch what you see', 'Arrange windows', 'In Chats', 'Wizard for Mac (any app)']);
});

test('⌥S speaks about the screen, ⌥C speaks a command, ⌥D dictates', () => {
  assert.match(js, /code === 'KeyS' \|\| code === 'KeyC' \|\| code === 'KeyD'/);
  assert.match(js, /code === 'KeyS' \? talk\(\) : commandVoice\(\)/);
  assert.match(js, /if \(code === 'KeyD'\) return dictate\(\)/);
  for (const [id, key] of [['micBtn', 'Alt\\+S'], ['commandBtn', 'Alt\\+C'], ['dictateBtn', 'Alt\\+D']]) assert.match(html, new RegExp(`id="${id}"[^>]*aria-keyshortcuts="${key}"`));
});

test('holding left ⌥ alone shows key hints; any other key or release hides them', () => {
  assert.match(js, /e\.code === 'AltLeft' && !e\.repeat/);
  assert.match(js, /keyHints\.down\(e\)/);
  assert.match(js, /addEventListener\('keyup', e => keyHints\.up\(e\), true\)/);
  assert.match(js, /doc\.addEventListener\('keyup', e => keyHints\.up\(e\), true\)/);
});
