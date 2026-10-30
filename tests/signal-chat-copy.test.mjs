import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skins = readFileSync(new URL('../web/core/skins.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return skins.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
};

test('Signal list copy leans toward white while preserving read and unread hierarchy', () => {
  const prefix = 'html[data-skin="signal"]';
  assert.match(rule(`${prefix} .ch-row:not(.draft) .tp b`), /color-mix\(in srgb,\s*var\(--ink-2\)\s*82%,\s*white\)/);
  assert.match(rule(`${prefix} .ch-row:not(.draft) .pv`), /color-mix\(in srgb,\s*var\(--ink-3\)\s*72%,\s*white\)/);
  assert.match(rule(`${prefix} .ch-row.unread .tp b`), /color-mix\(in srgb,\s*var\(--ink\)\s*86%,\s*white\)/);
  assert.match(rule(`${prefix} .ch-row.unread .pv`), /color-mix\(in srgb,\s*var\(--ink-2\)\s*76%,\s*white\)/);
  assert.equal(rule(`${prefix} .ch-row .pv`), '', 'saved drafts keep their amber semantic preview');
  assert.equal(rule(`${prefix} .ch-row .tp time`), '', 'timestamps keep the shared semantic colours');
  assert.equal(rule(`${prefix} .ch-row .pv em.att`), '', 'status labels keep their shared semantic colours');
});
