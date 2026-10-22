// Notifications Reply on every skin: the Reply bridge, the reply bubble above an empty New chat composer and the
// quote card in the sent thread are core behaviour, not a Miguel-skin feature. James's five skins get a real bubble
// drawn from their own tokens (no hard-coded colours, no fonts), while Miguel's skins keep their flat quote line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const chats = read('web/core/chats.js'), services = read('web/core/app-services.js'), css = read('web/core/chats.css');
const JAMES = ['nebula', 'grove', 'tide', 'ember', 'signal'];
const block = (src, a, b) => { const s = src.indexOf(a), e = src.indexOf(b, s + a.length); assert.ok(s >= 0 && e > s, a); return src.slice(s, e); };
const rule = sel => { const m = css.match(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); assert.ok(m, sel); return m[2]; };

test('the Reply bridge and bubble are not gated on a skin', () => {
  const bridge = block(services, 'openContextDraft(data)', 'openThread(id)');
  const open = block(chats, '  function openContextDraft(', '  function discardDraft(');
  const refresh = block(chats, '  function refreshReply(', '  function refreshCompose(');
  for (const src of [bridge, open, refresh]) {
    assert.doesNotMatch(src, /dataset\.skin|OURS|obsidian|landscapes|\bours\(/);
  }
  // The thread render puts the bubble in for every skin: only a New chat of the main agent decides it.
  assert.match(chats, /const rpl = isNew && !TAG \? KIT\.drafts\.get\(dkey\)\.reply : null;/);
  assert.match(chats, /\$\{replyBubble\(rpl\)\}/);
  assert.match(chats, /\$\{replyCard\(tn\.u\.reply\)\}/);
});

test('core draws a real bubble (rounded, tinted, accent rule) from skin tokens only', () => {
  const bubble = rule('.ch-reply');
  assert.match(bubble, /border-radius:\s*12px/);
  assert.match(bubble, /background:\s*color-mix\(in srgb, var\(--violet\) 12%, transparent\)/);
  assert.match(bubble, /border-left:\s*3px solid var\(--violet-2/);
  const card = rule('.ch-rq');
  assert.match(card, /border-radius:\s*10px/);
  const start = css.indexOf('/* Reply to a notification');
  const reply = css.slice(start);
  assert.ok(start > 0);
  assert.doesNotMatch(reply, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'reply styles use skin tokens, not literal colours');
  assert.doesNotMatch(reply, /font-family|data-skin/, 'no fonts and no per-skin rules in core');
  assert.ok(rule('.ch-compose button.ch-reply-x').includes('width: 44px'));
});

test("James's skins have no rule that hides or flattens the reply bubble", () => {
  for (const f of ['web/core/skins.css', 'web/core/chats.css', 'web/styles.css']) {
    const src = read(f);
    for (const id of JAMES) {
      assert.doesNotMatch(src, new RegExp(`data-skin=["']?${id}["']?\\][^{]*\\.ch-(reply|rq)`), `${f} restyles the reply for ${id}`);
    }
  }
});

test("Miguel's skins keep their flat quote line (square, untinted) over the new core bubble", () => {
  for (const [f, pre] of [['web/skins/obsidian/skin.css', 'html[data-skin^="obsidian"]'], ['web/skins/landscapes/skin.css', 'html[data-skin="landscapes"]']]) {
    const src = read(f);
    assert.ok(src.includes(pre + ' .ch-compose .ch-reply {') && /\.ch-compose \.ch-reply \{[^}]*background: none;[^}]*border-radius: 0;/.test(src), f);
    assert.ok(/\.msg\.u \.bub \.ch-rq \{[^}]*background: none;[^}]*border-radius: 0;/.test(src), f);
  }
});
