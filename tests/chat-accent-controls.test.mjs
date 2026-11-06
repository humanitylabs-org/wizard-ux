import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chats = readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...chats.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  return matches.at(-1)?.[1] || '';
};

test('Chats accent controls follow each active palette and use its base as contrasting ink', () => {
  const count = rule('.ch-sec-h b');
  assert.match(count, /background:\s*var\(--violet\)/);
  assert.match(count, /color:\s*var\(--wz-base,\s*var\(--bg/);
  assert.doesNotMatch(count, /color:\s*#fff/);

  const add = rule('.ch-fab');
  assert.match(add, /var\(--violet\)/, 'New chat follows the active skin accent');
  assert.match(add, /color:\s*var\(--wz-base,\s*var\(--bg/);
  assert.doesNotMatch(add, /#9b6bff|#6d45e6|rgba\(70,\s*30,\s*160/);

  const activeSort = rule('.ch-rdy-bar button.on');
  assert.match(activeSort, /background:\s*color-mix\(in srgb,\s*var\(--violet\)\s*14%,\s*transparent\)/);
  assert.match(activeSort, /border-color:\s*color-mix\(in srgb,\s*var\(--violet-2\)\s*45%,\s*transparent\)/);
  assert.doesNotMatch(activeSort, /143,\s*99,\s*255|185,\s*155,\s*255/);
});
