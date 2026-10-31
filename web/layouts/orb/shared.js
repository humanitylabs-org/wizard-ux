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

/* An app's mark when it has no logo: its designed glyph (the sigil in its icon), else one guessed from its name, in its
 * own colour; never a bare letter. Both shells draw satellites with these. */
const GUESS = [[/crm|contact|people|profile/i, 'profile'], [/command|console|terminal/i, 'console'], [/board|\bpr\b|project|kanban/i, 'projects'], [/money|bank|finance|monarch|simplefin|teller/i, 'dollar'],
  [/health|whoop|fit/i, 'gauge'], [/music|tube|audio|podcast/i, 'music'], [/mail|google/i, 'mail'], [/home|house/i, 'home'], [/backup|cloud/i, 'cloud'], [/twitter|social|\bx\b/i, 'social'], [/data|web|bright/i, 'globe']];
export const glyphOf = a => { const m = /sg-([a-z-]+)/.exec(a.icon || ''); return m && !/\bsgl\b/.test(a.icon || '') ? m[1] : (GUESS.find(([re]) => re.test(a.id + ' ' + a.name)) || [0, 'spark'])[1]; };
export const colourOf = a => (/--c:\s*([^;"]+)/.exec(a.icon || '') || [0, 'var(--wz-accent)'])[1].trim();

/* Ids to numbers (FNV-1a), for seeded strikes and blinks: the same input, the same number; never Math.random. */
export const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; };

/* The bolts: the orb powering what is open. Jagged lightning in the orb's colour (canvas-2D midpoint displacement,
 * seeded, pinned at both ends): a glow, two fainter arcs, the hot core, short forks, contact glows and a spark running
 * along it (only with motion). One drawing for both shells: the desktop runs orb → app → panel and orb → chat column,
 * the phone runs the bottom bar's orb → what just opened. boltPainter(ctx, reduced) → { bolt, glowAt }. */
export function boltPainter(sx, reduced) {
    function jag(x1, y1, x2, y2, seed, amp) {
      let pts = [[x1, y1], [x2, y2]], a = amp, rnd = seed;
      const r = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647 - .5; };
      for (let d = 0; d < 5; d++) {
        const next = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
          const off = r() * a, mx = (ax + bx) / 2 - dy / len * off, my = (ay + by) / 2 + dx / len * off;
          next.push([mx, my], pts[i]);
        }
        pts = next; a *= .55;
      }
      // pinned at both ends: the jitter fades to nothing at the orb and at the target
      const n = pts.length - 1;
      return pts.map(([x, y], i) => { const u = i / n, t = Math.sin(Math.PI * u), bx = x1 + (x2 - x1) * u, by = y1 + (y2 - y1) * u; return [bx + (x - bx) * t, by + (y - by) * t]; });
    }
    function stroke(pts, w, col) { sx.lineWidth = w; sx.strokeStyle = col; sx.beginPath(); sx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sx.lineTo(pts[i][0], pts[i][1]); sx.stroke(); }
    function glowAt(x, y, rad, col, a) { const g = sx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, A(col, a)); g.addColorStop(1, A(col, 0)); sx.fillStyle = g; sx.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    function bolt(x1, y1, x2, y2, t, strength, seed, P) {
      if (strength <= .01 || Math.hypot(x2 - x1, y2 - y1) < 6) return;
      const c = P.c, len = Math.hypot(x2 - x1, y2 - y1), amp = Math.max(9, Math.min(30, len * .34));
      const main = jag(x1, y1, x2, y2, seed, amp), twin = jag(x1, y1, x2, y2, seed * 7 + 3, amp * 1.15), third = jag(x1, y1, x2, y2, seed * 13 + 5, amp * .7);
      sx.lineCap = 'round'; sx.lineJoin = 'round';
      // the air around it glows, then a faint second and third arc, then the hot core
      stroke(main, 24, A(c[0], .045 * strength)); stroke(main, 11, A(c[0], .11 * strength)); stroke(main, 5, A(c[1], .2 * strength));
      stroke(twin, 2.2, A(c[0], .35 * strength)); stroke(twin, .8, A(c[2], .5 * strength));
      stroke(third, 1.2, A(c[1], .3 * strength));
      stroke(main, 2.4, A(c[2], .85 * strength)); stroke(main, 1, A(P.white, strength));
      // short forks off the main strike
      let rnd = seed;
      const r = () => { rnd = (rnd * 48271) % 2147483647; return rnd / 2147483647; };
      for (let f = 0; f < 3; f++) {
        const i = 5 + Math.floor(r() * (main.length - 10)), [fx, fy] = main[i] || main[0], ang = (r() - .5) * 2.6 + Math.atan2(y2 - y1, x2 - x1), fl = Math.max(10, len * (.14 + r() * .18));
        const fork = jag(fx, fy, fx + Math.cos(ang) * fl, fy + Math.sin(ang) * fl, seed + f * 101, fl * .45).slice(0, 22);
        stroke(fork, 4, A(c[0], .12 * strength)); stroke(fork, .9, A(c[2], .6 * strength));
      }
      // contact: where it leaves and where it lands, and a spark of energy running along it
      glowAt(x1, y1, 16, c[1], .4 * strength); glowAt(x2, y2, 26, c[0], .5 * strength); glowAt(x2, y2, 7, P.white, .75 * strength);
      if (!reduced) { const u = (t * 1.4 + seed % 7 / 7) % 1, i = Math.floor(u * (main.length - 1)), [px, py] = main[i]; glowAt(px, py, 18, c[2], .6 * strength); glowAt(px, py, 4.5, P.white, strength); }
    }
  return { bolt, glowAt };
}
