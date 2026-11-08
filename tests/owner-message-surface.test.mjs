// James (8 Nov 2026): his own messages must stand out from agent replies on every skin so a thread skims by speaker.
// One Appearance token (--wz-owner-message) paints the bubble: opaque, clearly apart from the reply surface, AA ink.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const base = read('web/core/base.css'), chats = read('web/core/chats.css'), skinsJs = read('web/core/skins.js');

const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const parse = c => c.startsWith('#') ? [...hex(c), 1] : c.match(/rgba?\(([^)]*)\)/)[1].split(',').map(Number).concat(1).slice(0, 4);
const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
const mix = (a, b, p) => a.map((v, i) => v * p + b[i] * (1 - p));
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = c.map(f); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function skinTokens() {
  const out = {};
  for (const m of skinsJs.matchAll(/\{ id: '([\w-]+)',[^\n]*\n\s*t: T\(\{([\s\S]*?)\}\) \}/g)) {
    out[m[1]] = Object.fromEntries([...m[2].matchAll(/'?([\w-]+)'?: '([^']+)'/g)].map(x => [x[1], x[2]]));
  }
  return out;
}
const pct = (css, sel) => {
  const block = css.slice(css.indexOf(sel)); const m = block.match(/--wz-owner-message: color-mix\(in srgb, var\(--violet[^)]*\) (\d+)%, var\(--bg[^)]*\)\)/);
  return m ? Number(m[1]) / 100 : null;
};

test('the owner bubble is painted by the opaque --wz-owner-message token on every skin', () => {
  assert.match(chats, /\.msg\.u \.bub \{[^}]*background: var\(--wz-owner-message[^}]*color: var\(--wz-on-owner-message/);
  assert.match(chats, /\.msg\.a \.bub \{[^}]*background: none/, 'agent replies keep the window surface');
  // No skin package may put a translucent wash back on his bubbles.
  for (const dir of readdirSync(new URL('../web/skins/', import.meta.url))) {
    let css = ''; try { css = read(`web/skins/${dir}/skin.css`); } catch { continue; }
    for (const rule of css.match(/[^}\n]*\.msg\.u \.bub \{[^}]*\}/g) || []) {
      const bg = rule.match(/background:\s*([^;]+);/)?.[1];
      if (bg) assert.match(bg, /^var\(--wz-owner-message\)$/, `${dir}: ${rule}`);
    }
  }
});

test('every built-in skin and the dark fallback: distinct surface, AA text', () => {
  const tokens = skinTokens(), light = new Set(['obsidian-light', 'landscapes-light', 'sepia']);
  for (const id of ['nebula', 'grove', 'tide', 'ember', 'signal', 'obsidian', 'obsidian-light', 'landscapes', 'landscapes-light', 'novairecito', 'sepia']) assert.ok(tokens[id], id);
  const darkP = pct(base, ':root {\n  /* Opaque'), lightP = pct(base, 'html:is([data-skin="obsidian-light"]');
  const obsP = pct(read('web/skins/obsidian/skin.css'), 'html[data-skin="obsidian"] {');
  assert.ok(darkP && lightP && obsP);
  for (const s of light) assert.match(base, new RegExp(`\\[data-skin="${s}"\\]`));
  const cases = Object.entries(tokens).map(([id, t]) => [id, t]);
  cases.push(['standalone dark fallback', { bg: '#05030c', ink: '#f3efff', violet: '#8f63ff', 'sk-win': 'rgba(12,8,26,.82)' }]);
  for (const [id, t] of cases) {
    const bg = parse(t.bg).slice(0, 3), ink = parse(t.ink), v = parse(t.violet).slice(0, 3);
    const p = id === 'obsidian' ? obsP : light.has(id) ? lightP : darkP;
    const owner = mix(v, bg, p);                         // color-mix of two opaque colours: fully opaque
    const reply = over(parse(t['sk-win']), bg);          // agent replies sit on the window material
    const text = ink[3] < 1 ? over(ink, owner) : ink.slice(0, 3);
    assert.ok(ratio(text, owner) >= 4.5, `${id}: text contrast ${ratio(text, owner).toFixed(2)}`);
    assert.ok(ratio(owner, reply) >= 1.4, `${id}: owner vs reply surface ${ratio(owner, reply).toFixed(2)}`);
  }
});
