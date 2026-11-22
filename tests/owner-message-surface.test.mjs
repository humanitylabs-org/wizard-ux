// James (8 Nov 2026): his own messages must stand out from agent replies on every skin so a thread skims by speaker.
// One Appearance token (--wz-owner-message) paints the bubble: opaque, clearly apart from the reply surface, AA ink.
// Each case runs the real skins.js for the skin and cascades every stylesheet the shell page links, plus the skin's
// package sheet where skin-host puts it (tests/fixtures/r8A-skin-paint.mjs), over a Chats thread skeleton.
import test from 'node:test';
import assert from 'node:assert/strict';
import { skinPage, skinsJs, colour, over, contrast } from './fixtures/r8A-skin-paint.mjs';

const BODY = '<div class="win"><div class="wbody"><div class="msg u"><div class="bub">mine</div></div><div class="msg a"><div class="bub">reply</div></div></div></div>';
const SKINS = skinsJs().S.list.map(s => s.id);
const cases = () => ['phone', 'desktop'].flatMap(shell => [null, ...SKINS].map(skin => {
  const p = skinPage(skin, shell, BODY), q = s => p.doc.querySelector(s);
  const bg = el => p.value(el, 'background') || p.value(el, 'background-color');
  return { name: `${shell} ${skin || 'standalone dark fallback'}`, owner: bg(q('.msg.u .bub')), token: p.value(q('.msg.u .bub'), '--wz-owner-message'),
    ink: p.value(q('.msg.u .bub'), 'color'), reply: bg(q('.msg.a .bub')), win: bg(q('.win')), page: p.value(p.doc.documentElement, '--bg') };
}));
let memo; const all = () => (memo ||= cases());

test('the owner bubble is painted by the opaque --wz-owner-message token on every skin', () => {
  assert.ok(SKINS.length >= 11, 'every built-in skin');
  for (const c of all()) {
    assert.ok(c.token, `${c.name}: the token is set`);
    assert.equal(c.owner, c.token, `${c.name}: no skin package puts another wash on his bubbles`);
    assert.equal(colour(c.owner)[3], 1, `${c.name}: opaque`);
    assert.ok(c.reply === 'none' || colour(c.reply)[3] === 0, `${c.name}: agent replies keep the window surface (${c.reply})`);
  }
});

test('every built-in skin and the dark fallback: distinct surface, AA text', () => {
  for (const c of all()) {
    const page = colour(c.page), owner = over(colour(c.owner), page), reply = over(colour(c.win), page);
    const text = over(colour(c.ink), owner);
    assert.ok(contrast(text, owner) >= 4.5, `${c.name}: text contrast ${contrast(text, owner).toFixed(2)}`);
    assert.ok(contrast(owner, reply) >= 1.4, `${c.name}: owner vs reply surface ${contrast(owner, reply).toFixed(2)}`);
  }
});
