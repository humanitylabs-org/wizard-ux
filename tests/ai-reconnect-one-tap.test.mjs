// A model or account that stopped working is one tap from its fix: Home's "Reconnect" row and an empty slot in
// Miguel's model switch open the connection app straight at Reconnect (`?reconnect=1`), never a dead greyed control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('an empty model-switch slot is tappable and opens its app at the fix', () => {
  const src = read('web/core/chat-power.js');
  assert.doesNotMatch(src, /opts\[i\] \? '' : ' disabled'/, 'an empty slot must not be a dead disabled button');
  assert.match(src, /data-msfix="\$\{SW_FIX\[i\]\}"/);
  assert.match(src, /'\/wizard-chatgpt\/\?reconnect=1'/);
  assert.match(src, /'\/wizard-claude\/\?reconnect=1'/);
  assert.match(src, /if \(!d\.moved\) openFix\(SW_FIX\[i\]\)/, 'a tap (not a drag) on an empty slot opens the fix');
  assert.match(src, /function openFix\(path\) \{ const app = path\.split\('\/'\)\[1\]; if \(!window\.WizOpenApp\?\.\(app, path\)\)/);
  for (const skin of ['landscapes', 'obsidian']) {
    assert.match(read(`web/skins/${skin}/skin.css`), /\.ms-o:is\(:disabled, \[aria-disabled="true"\]\) \{ opacity: \.35; \}/, skin);
  }
});

test('Home reconnect rows open the connection app at Reconnect', () => {
  const src = read('web/core/resources.js');
  assert.match(src, /sub:'Reconnect',attrs:`data-res-signin="\$\{esc\(APP_OF\[id\]\)\}" data-res-reconnect="1"`/);
  assert.match(src, /RECONNECT_APPS=new Set\(\['wizard-chatgpt','wizard-claude'\]\)/);
  assert.match(src, /si\.hasAttribute\('data-res-reconnect'\)&&RECONNECT_APPS\.has\(app\)\?`\/\$\{app\}\/\?reconnect=1`/);
});
