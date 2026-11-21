// Issue 1650: every readable part of an alert thread selects like a chat message (the shell is user-select:none).
// The surfaces come from chats.js (renderThread's NV branch, noteStackHtml, alertsHtml / sweepItemHtml); their
// selectors must sit in a `user-select: text` rule of chats.css, and buttons stay unselectable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withWebParts } from './fixtures/web-parts.mjs';

const css = withWebParts(fs.readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
// chats.js and the parts moved out of it (core/chats-running.js, core/chats-drafts.js, issue 1665).
const js = ['chats.js', 'chats-running.js', 'chats-drafts.js'].map(f => withWebParts(fs.readFileSync(new URL('../web/core/' + f, import.meta.url), 'utf8'))).join('\n');
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => ({ sel: m[1].split(',').map(s => s.trim()), body: m[2] }));
const textSels = new Set(rules.filter(r => /(^|;)\s*user-select:\s*text/.test(r.body)).flatMap(r => r.sel));
const noneSels = new Set(rules.filter(r => /(^|;)\s*user-select:\s*none/.test(r.body)).flatMap(r => r.sel));

test('alert thread surfaces are drawn by chats.js', () => {
  for (const cls of ['ch-notif-original', 'ch-ncard-h', 'ch-sw-ask', 'ch-sw-rec', 'ch-sw-t'])
    assert.ok(js.includes(`class="${cls}"`), `chats.js still draws .${cls}`);
  assert.ok(js.includes('class="appr ch-sweep ch-alerts"'), 'Alerts now is a .ch-sweep section');
});

test('alert message, Original alert, open card title and Alerts now asks are selectable', () => {
  for (const s of ['.msg .bub', '.msg .bub *', '.ch-notif-original', '.ch-notif-original *', '.ch-ncard-h b', '.ch-ncard-h b *',
    '.ch-sweep .ch-sw-t b', '.ch-sweep .ch-sw-ask', '.ch-sweep .ch-sw-ask *', '.ch-sweep .ch-sw-rec'])
    assert.ok(textSels.has(s), `${s} has user-select: text`);
  const rule = rules.find(r => r.sel.includes('.ch-notif-original') && /user-select/.test(r.body));
  assert.match(rule.body, /-webkit-user-select:\s*text/); assert.match(rule.body, /-webkit-touch-callout:\s*default/);
});

test('buttons stay unselectable', () => {
  for (const s of textSels) assert.doesNotMatch(s, /button|\[data-ch/, `${s} must not make a control selectable`);
  assert.ok(noneSels.has('.msg .bub button'));
});
