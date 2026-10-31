/* What the Orbs view draws and lists, shared by its two shells: the desktop scene (layout.js) and the phone Home
 * (phone.js). One source each, so the phone can never drift from the desktop:
 *   - the orb's look: the Style × Colour kept per device (the same stored choice on both), its colours read from the
 *     wearing tweak's skin-layer tokens (--ob-look-<id>, --ob-white, …) and normalised to #rrggbb;
 *   - the night sky: the starfield and the soft glow behind the orb;
 *   - the satellites: which apps float round the orb (orbitApps). Change what floats here and both shells follow.
 * No storage, network or DOM reads beyond the computed tokens; everything else goes through the layout API. */
import { STYLES, RETIRED, mix, A } from './styles.js';

export { A };
// Seventeen colours: sixteen from the tweak's tokens (--ob-look-<id>: four colours each) and the skin's own accent.
export const COLOURS = [['nebula', 'Nebula'], ['ember', 'Ember'], ['tide', 'Tide'], ['gold', 'Gold'], ['mono', 'Mono'], ['emerald', 'Emerald'], ['rose', 'Rose'], ['arctic', 'Arctic'],
  ['marble', 'Marble'], ['obsidian', 'Obsidian'], ['bronze', 'Bronze'], ['royal', 'Royal'], ['crimson', 'Crimson'], ['cyber', 'Cyber'], ['sunset', 'Sunset'], ['ocean', 'Ocean'], ['skin', 'Skin accent']];
export const has = (L, id) => L.some(l => l[0] === id);

/* Kept per device: style + colour (api.storage of the Orb layout, the same keys on the desktop and the phone). The v3
 * single "look" (nebula / ember / tide / oracle) maps onto them once; a style retired in v7 becomes Plasma. */
export function lookOf(api) {
  const legacy = api.storage.get('look');
  let styleId = api.storage.get('style'), colourId = api.storage.get('colour');
  if (!has(STYLES, styleId)) styleId = legacy === 'oracle' ? 'oracle' : RETIRED.includes(styleId) ? 'plasma' : 'glass';   // v7 retired five styles
  if (!has(COLOURS, colourId)) colourId = legacy === 'oracle' ? 'gold' : has(COLOURS, legacy) ? legacy : 'nebula';
  return { styleId, colourId };
}

/* colours: skin-layer tokens, normalised to #rrggbb so alpha can be appended. palette(id) → { ok, c: four colours,
 * white, core, face }, cached a few seconds (the tweak's CSS may land after the first frame). */
export function palettes(doc) {
  const root = doc.documentElement;
  const probe = doc.createElement('canvas').getContext('2d');
  const norm = c => { if (!c || !probe) return ''; probe.fillStyle = 'black'; probe.fillStyle = c; const v = probe.fillStyle; return /^#[0-9a-f]{6}$/i.test(v) ? v : ''; };
  const cssVar = n => getComputedStyle(root).getPropertyValue(n).trim();
  const pals = new Map();
  return function palette(id) {
    const now = performance.now(), hit = pals.get(id);
    if (hit && hit.ok && now - hit.at < 5000) return hit;
    const white = norm(cssVar('--ob-white')) || norm('white'), core = norm(cssVar('--ob-core')) || norm('black');
    let list = id === 'skin' ? [] : cssVar('--ob-look-' + id).split(',').map(s => norm(s.trim())).filter(Boolean);
    const acc = norm(cssVar('--wz-accent')) || norm(cssVar('--ob-v1')) || norm('slateblue');
    // the skin's accent, in four shades of itself (deep, light, pale, warm)
    if (id === 'skin') list = [acc, mix(acc, white, .35), mix(acc, white, .65), mix(acc, norm(cssVar('--ob-amber')) || white, .3)];
    const ok = list.length >= 4 && !!cssVar('--ob-look-nebula');   // tokens loaded
    const p = { at: now, ok, c: list.length >= 4 ? list.slice(0, 4) : [acc, acc, acc, acc], white, core, face: norm(cssVar('--ob-face')) || white };
    pals.set(id, p); return p;
  };
}

/* the night sky: the same stars for the same size (a seeded walk, never Math.random), twinkling; a soft glow in the
 * orb's colour behind it that swells a little with the voice. */
export function starsFor(W, H) {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({ length: Math.round(W * H / 5200) }, () => ({ x: rnd() * W, y: rnd() * H, r: rnd() * 1.1 + .2, p: rnd() * 6.3, s: .3 + rnd() }));
}
export function paintSky(sx, { W, H, gx, cy, t, lv, P, stars }) {
  const c = P.c;
  sx.clearRect(0, 0, W, H);
  const g = sx.createRadialGradient(gx, cy, 0, gx, cy, Math.max(W, H) * .7);
  g.addColorStop(0, A(c[0], .16 + lv * .1)); g.addColorStop(.35, A(c[1], .05)); g.addColorStop(1, 'transparent');
  sx.fillStyle = g; sx.fillRect(0, 0, W, H);
  sx.fillStyle = P.white;
  for (const s of stars) { sx.globalAlpha = .25 + .45 * (.5 + .5 * Math.sin(t * s.s + s.p)); sx.beginPath(); sx.arc(s.x, s.y, s.r, 0, 7); sx.fill(); }
  sx.globalAlpha = 1;
}

/* Satellites are ambient status, not a launcher (Miguel, v7): only (a) apps running (api.panel.running(): the shell's
 * own list of what is open, shown or kept out of sight) and (b) regular apps with an unread count float. Agents,
 * connectors, agent apps, system and in-development apps never float for a count (the shell's own kinds:
 * core/app-kinds.js); everything stays one search away. Nothing running and nothing new: just the orb.
 * The desktop and the phone both float exactly this list (each shell's adapter says what is running). */
export const regular = a => !a.system && !a.dev && !a.connector && !a.agent;
export function orbitApps(api, badgeMap) {
  const all = api.apps.list(), run = new Map(api.panel.running().map(r => [r.id, r]));
  return all.filter(a => run.has(a.id) ? !a.agent && !a.connector : regular(a) && (badgeMap[a.id] || 0) > 0).map(a => ({ ...a, run: run.get(a.id) || null }));
}
