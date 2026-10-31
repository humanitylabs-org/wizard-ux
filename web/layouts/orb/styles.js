/* Orb styles for the Orb desktop (layout.js): seven different ways of drawing the entity, all in canvas 2D, all fed
 * the same inputs every frame: f = { t (seconds), lv (mic level 0..1), state ('idle' | 'listening' | 'thinking' |
 * 'paused'), fl (a "doing it" flash, 1 → 0), blink, P }. P is the colour: { c: four '#rrggbb', white, core, face }.
 * Every style breathes at rest, swells and stirs with the voice, spins up while sending and rings once on a command.
 *
 * Drawn in-house, no vendored code. Ideas (not code) from Teknium's Uncommon Web field guide (webdev.teknium.io):
 * ordered 4×4 Bayer dithering (dithercn, dither-avatar) for Glitch, a Fibonacci-sampled dot sphere (Cobe) and linked
 * constellations (tsParticles) for Swarm, sliced RGB glitches (PowerGlitch) for Glitch, liquid chrome (Paper Shaders'
 * LiquidMetal) for Chrome, and the Tron boardroom hologram (ENCOM Globe) for Hologram. Glass and Oracle are the
 * approved concept's own orb (Files › Pages › orb-shell-concept). */
export const STYLES = Object.freeze([
  ['glass', 'Glass'], ['oracle', 'Oracle'], ['plasma', 'Plasma'], ['swarm', 'Swarm'], ['holo', 'Hologram'], ['glitch', 'Glitch'], ['chrome', 'Chrome'],
]);
const TAU = Math.PI * 2;
const clamp01 = v => Math.max(0, Math.min(1, v));
/** '#rrggbb' + alpha → '#rrggbbaa' (canvas colour). */
export const A = (hex, a) => hex + Math.round(clamp01(a) * 255).toString(16).padStart(2, '0');
const chans = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) || 0);
const toHex = v => '#' + v.map(n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('');
/** Mix two '#rrggbb' colours (k = share of b). */
export const mix = (a, b, k) => { const x = chans(a), y = chans(b); return toHex(x.map((n, i) => n + (y[i] - n) * k)); };
const spinOf = state => state === 'thinking' ? 3.2 : state === 'listening' ? 1.8 : 1;
const radiusOf = (px, f, k = .3) => px * k * (1 + Math.sin(f.t * 1.3) * .015) * (1 + f.lv * .12 + (f.state === 'listening' ? .05 : 0));

/* ---------- shared touches: the soft halo, the listening waves, the command ring ---------- */
function halo(ctx, px, R, P, lv, k = 1) {
  const c = P.c, cx = px / 2, g = ctx.createRadialGradient(cx, cx, R * .6, cx, cx, R * 1.65);
  g.addColorStop(0, A(c[0], (.5 + lv * .3) * k)); g.addColorStop(.5, A(c[1], .12 * k)); g.addColorStop(1, A(c[1], 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, px, px);
}
function waves(ctx, px, R, f, col) {
  if (f.state !== 'listening') return;
  const cx = px / 2;
  for (let i = 0; i < 3; i++) {
    const k = (f.t * .9 + i / 3) % 1; ctx.strokeStyle = A(col, (1 - k) * .45); ctx.lineWidth = px * .004;
    ctx.beginPath(); ctx.arc(cx, cx, R * (1.05 + k * .55), 0, TAU); ctx.stroke();
  }
}
function flashRing(ctx, px, R, f) {
  if (!(f.fl > 0)) return;
  const cx = px / 2; ctx.strokeStyle = A(f.P.white, f.fl * .9); ctx.lineWidth = px * .006 * f.fl;
  ctx.beginPath(); ctx.arc(cx, cx, R * (1 + (1 - f.fl) * .9), 0, TAU); ctx.stroke();
}
// A small seeded random (stable for a short step, so a glitch holds for a few frames instead of flickering).
const rng = seed => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/* ---------- Glass: the concept's glassy orb ---------- */
function glassBody(ctx, px, R, f, { swirls = 5, calm = 1 } = {}) {
  const { t, lv, state, P } = f, c = P.c, cx = px / 2, cy = px / 2;
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
  const base = ctx.createRadialGradient(cx, cy - R * .3, R * .1, cx, cy, R);
  base.addColorStop(0, A(c[0], .55)); base.addColorStop(1, P.core); ctx.fillStyle = base; ctx.fillRect(0, 0, px, px);
  ctx.globalCompositeOperation = 'screen';
  const spin = spinOf(state) * calm;
  for (let i = 0; i < swirls; i++) {
    const a = t * .35 * spin * (i % 2 ? 1 : -1.2) + i * 1.26;
    const rr = R * (.38 + .12 * Math.sin(t * .7 + i));
    const bx = cx + Math.cos(a) * rr, by = cy + Math.sin(a * 1.3) * rr * .8;
    const br = R * (.55 + .1 * Math.sin(t + i * 2) + lv * .2);
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    g.addColorStop(0, A(c[i % 4], .75)); g.addColorStop(1, A(c[i % 4], 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  const hl = ctx.createRadialGradient(cx - R * .35, cy - R * .45, 0, cx - R * .35, cy - R * .45, R * .7);
  hl.addColorStop(0, A(P.white, .28)); hl.addColorStop(1, A(P.white, 0)); ctx.fillStyle = hl; ctx.fillRect(0, 0, px, px);
}
function glass() {
  return (ctx, px, f) => {
    const R = radiusOf(px, f), c = f.P.c, cx = px / 2;
    ctx.clearRect(0, 0, px, px);
    halo(ctx, px, R, f.P, f.lv); waves(ctx, px, R, f, c[2]);
    glassBody(ctx, px, R, f); ctx.restore();
    ctx.strokeStyle = A(c[3], .35 + f.lv * .3); ctx.lineWidth = px * .004; ctx.beginPath(); ctx.arc(cx, cx, R, 0, TAU); ctx.stroke();
    flashRing(ctx, px, R, f);
  };
}

/* ---------- Oracle: the concept's face (calm eyes that blink, a mouth that follows the voice) ---------- */
function oracle() {
  return (ctx, px, f) => {
    const { t, lv, state, blink, P } = f, R = radiusOf(px, f), c = P.c, cx = px / 2, cy = px / 2;
    ctx.clearRect(0, 0, px, px);
    halo(ctx, px, R, P, lv, .8); waves(ctx, px, R, f, c[1]);
    glassBody(ctx, px, R, f, { swirls: 3, calm: .6 });
    // a soft inner veil so the face reads
    const veil = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); veil.addColorStop(0, A(P.core, .35)); veil.addColorStop(1, A(P.core, 0));
    ctx.fillStyle = veil; ctx.fillRect(0, 0, px, px);
    ctx.strokeStyle = A(P.face, .92); ctx.lineCap = 'round'; ctx.lineWidth = px * .009; ctx.shadowColor = P.face; ctx.shadowBlur = px * .03;
    const ey = cy - R * .12, ex = R * .3, open = blink ? .02 : (state === 'listening' ? .16 : .1);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * ex, ey, R * .13, R * open, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); }
    const mo = state === 'listening' ? R * (.02 + .08 * lv) : state === 'thinking' ? R * (.03 + .03 * Math.abs(Math.sin(t * 6))) : R * .012;
    ctx.beginPath(); ctx.ellipse(cx, cy + R * .32, R * .16, mo, 0, 0, TAU); ctx.stroke();
    ctx.shadowBlur = 0; ctx.restore();
    ctx.strokeStyle = A(c[3], .3 + lv * .3); ctx.lineWidth = px * .004; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    flashRing(ctx, px, R, f);
  };
}

/* ---------- Plasma: a soft nebula cloud, no rim (drawn small, then scaled up: the blur is free) ---------- */
function plasma(mk) {
  const S = 96, off = mk(S), o = off.getContext('2d');
  return (ctx, px, f) => {
    const { t, lv, state, P } = f, c = P.c, sp = spinOf(state) * .8, R = radiusOf(px, f);
    o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, S, S); o.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const a = t * .22 * sp * (i % 2 ? 1 : -1) + i * .9;
      const rr = S * (.13 + .08 * Math.sin(t * .5 + i * 1.7) + lv * .05);
      const x = S / 2 + Math.cos(a) * rr + Math.sin(t * .31 + i) * S * .04, y = S / 2 + Math.sin(a * 1.21) * rr;
      const br = S * (.22 + .05 * Math.sin(t * .8 + i * 2) + lv * .1);
      const g = o.createRadialGradient(x, y, 0, x, y, br); g.addColorStop(0, A(c[i % 4], .3)); g.addColorStop(.6, A(c[i % 4], .1)); g.addColorStop(1, A(c[i % 4], 0));
      o.fillStyle = g; o.fillRect(0, 0, S, S);
    }
    // fade to nothing at the edge: a cloud, not a ball
    o.globalCompositeOperation = 'destination-in';
    const m = o.createRadialGradient(S / 2, S / 2, S * .1, S / 2, S / 2, S * .5);
    m.addColorStop(0, A(P.white, 1)); m.addColorStop(.55, A(P.white, .9)); m.addColorStop(.8, A(P.white, .4)); m.addColorStop(1, A(P.white, 0));
    o.fillStyle = m; o.fillRect(0, 0, S, S);
    ctx.clearRect(0, 0, px, px);
    halo(ctx, px, R, P, lv, .55);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const D = px * (.98 + lv * .1) * (1 + Math.sin(t * 1.3) * .02);
    ctx.drawImage(off, (px - D) / 2, (px - D) / 2, D, D);
    ctx.translate(px / 2, px / 2); ctx.rotate(t * .12 * sp); ctx.globalAlpha = .45; const D2 = D * .7;
    ctx.drawImage(off, -D2 / 2, -D2 / 2, D2, D2);
    ctx.restore();
    // a faint bright heart
    const h = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, R * (.3 + lv * .2));
    h.addColorStop(0, A(P.white, .16 + lv * .3)); h.addColorStop(1, A(P.white, 0)); ctx.fillStyle = h; ctx.fillRect(0, 0, px, px);
    waves(ctx, px, R, f, c[2]); flashRing(ctx, px, R, f);
  };
}

/* ---------- Swarm: a turning sphere of points with a few constellation links ---------- */
function swarm() {
  const N = 360, pts = [], ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) { const y = 1 - (i + .5) / N * 2, r = Math.sqrt(1 - y * y), th = ga * i; pts.push([Math.cos(th) * r, y, Math.sin(th) * r, ((i * 7919) % 1000) / 1000]); }
  const links = [];
  for (let i = 0; i < N; i += 3) {
    let best = -1, bd = 9;
    for (let j = 0; j < N; j++) { if (j === i) continue; const d = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2 + (pts[i][2] - pts[j][2]) ** 2; if (d < bd) { bd = d; best = j; } }
    links.push([i, best]);
  }
  const pr = new Float32Array(N * 3);
  let rot = 0, last = 0;
  return (ctx, px, f) => {
    const { t, lv, state, P } = f, c = P.c, cx = px / 2, cy = px / 2;
    const sp = state === 'thinking' ? 1.8 : state === 'listening' ? .8 : .3;
    rot += (last && t > last ? Math.min(.1, t - last) : 0) * sp; last = t;
    const R = px * .3 * (1 + lv * .16) * (1 + Math.sin(t * 1.3) * .015);
    ctx.clearRect(0, 0, px, px);
    halo(ctx, px, R, P, lv, .45);
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * .7); core.addColorStop(0, A(c[0], .35 + lv * .3)); core.addColorStop(1, A(c[0], 0));
    ctx.fillStyle = core; ctx.fillRect(0, 0, px, px);
    const tilt = .42, ct = Math.cos(tilt), st = Math.sin(tilt), cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i < N; i++) {
      const [x, y, z, s] = pts[i];
      const x1 = x * cr + z * sr, z1 = -x * sr + z * cr, y1 = y * ct - z1 * st, z2 = y * st + z1 * ct;
      const k = 1 + (state === 'listening' ? .07 * Math.sin(t * 5 + y * 6) : 0) + lv * .4 * Math.sin(t * 9 + s * 40) * s;
      pr[i * 3] = cx + x1 * R * k; pr[i * 3 + 1] = cy + y1 * R * k; pr[i * 3 + 2] = z2;
    }
    ctx.lineWidth = Math.max(1, px * .0018);
    for (const [i, j] of links) {
      const z = (pr[i * 3 + 2] + pr[j * 3 + 2]) / 2; if (z < -.3) continue;
      ctx.strokeStyle = A(c[2], .06 + .26 * (z + 1) / 2 + lv * .15);
      ctx.beginPath(); ctx.moveTo(pr[i * 3], pr[i * 3 + 1]); ctx.lineTo(pr[j * 3], pr[j * 3 + 1]); ctx.stroke();
    }
    for (let i = 0; i < N; i++) {
      const d = (pr[i * 3 + 2] + 1) / 2, r = Math.max(.6, px * (.002 + .0048 * d) * (1 + lv * .5));
      ctx.fillStyle = A(i % 7 === 0 ? P.white : c[i % 4], .18 + .8 * d);
      ctx.beginPath(); ctx.arc(pr[i * 3], pr[i * 3 + 1], r, 0, TAU); ctx.fill();
    }
    waves(ctx, px, R, f, c[2]); flashRing(ctx, px, R, f);
  };
}

/* ---------- Hologram: a lattice sphere inside turning rings and ticks (Jarvis-like) ---------- */
function holo() {
  let rot = 0, last = 0;
  return (ctx, px, f) => {
    const { t, lv, state, P } = f, c = P.c, cx = px / 2, cy = px / 2, sp = spinOf(state);
    rot += (last && t > last ? Math.min(.1, t - last) : 0) * .35 * sp; last = t;
    const R = px * .25 * (1 + lv * .1) * (1 + Math.sin(t * 1.3) * .012), lw = Math.max(1, px * .0018);
    ctx.clearRect(0, 0, px, px);
    const fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6); fill.addColorStop(0, A(c[0], .22 + lv * .2)); fill.addColorStop(1, A(c[0], 0));
    ctx.fillStyle = fill; ctx.fillRect(0, 0, px, px);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = lw;
    // the lattice: latitudes, and longitudes that turn
    for (let k = -3; k <= 3; k++) {
      const y = k / 4, r = Math.sqrt(1 - y * y) * R;
      ctx.strokeStyle = A(c[2], k === 0 ? .55 : .28); ctx.beginPath(); ctx.ellipse(cx, cy - y * R * .94, r, r * .3, 0, 0, TAU); ctx.stroke();
    }
    for (let k = 0; k < 6; k++) {
      const a = rot + k * Math.PI / 6, rx = Math.abs(Math.cos(a)) * R;
      ctx.strokeStyle = A(c[2], .16 + .2 * Math.abs(Math.sin(a))); ctx.beginPath(); ctx.ellipse(cx, cy, rx, R, 0, 0, TAU); ctx.stroke();
    }
    ctx.strokeStyle = A(c[2], .7); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    // dashed rings at three speeds
    const ring = (rk, speed, dash, alpha, w, col) => {
      ctx.setLineDash(dash.map(d => d * px)); ctx.lineDashOffset = -t * speed * px * .05;
      ctx.lineWidth = w * px; ctx.strokeStyle = A(col, alpha); ctx.beginPath(); ctx.arc(cx, cy, R * rk, 0, TAU); ctx.stroke();
    };
    ring(1.16 + lv * .06, .9 * sp, [.03, .014], .55, .004, c[2]);
    ring(1.3, -.5 * sp, [.09, .02, .006, .02], .4, .0025, c[1]);
    ring(1.42 + lv * .08, .25 * sp, [.004, .012], .5, .006, c[3]);
    ctx.setLineDash([]);
    // tick ring
    const n = 72;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU - t * .06 * sp, big = i % 6 === 0, r0 = R * 1.55, r1 = r0 + R * (big ? .09 : .04);
      ctx.strokeStyle = A(c[2], big ? .55 : .22); ctx.lineWidth = lw * (big ? 1.4 : 1);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    }
    // a sweeping arc
    const sa = t * 1.1 * sp; ctx.lineWidth = px * .007; ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) { ctx.strokeStyle = A(P.white, .5 * (1 - k / 6)); ctx.beginPath(); ctx.arc(cx, cy, R * 1.3, sa - k * .07, sa - (k + 1) * .07, true); ctx.stroke(); }
    ctx.lineCap = 'butt';
    // the core and a scanline through the sphere
    const cr = R * (.22 + lv * .3), core = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 2.2);
    core.addColorStop(0, A(P.white, .95)); core.addColorStop(.3, A(c[2], .6)); core.addColorStop(1, A(c[2], 0));
    ctx.fillStyle = core; ctx.fillRect(cx - cr * 2.2, cy - cr * 2.2, cr * 4.4, cr * 4.4);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    const sy = cy - R + ((t * .3 * sp) % 1) * 2 * R, band = ctx.createLinearGradient(0, sy - R * .12, 0, sy + R * .12);
    band.addColorStop(0, A(c[2], 0)); band.addColorStop(.5, A(c[2], .35)); band.addColorStop(1, A(c[2], 0));
    ctx.fillStyle = band; ctx.fillRect(cx - R, sy - R * .12, R * 2, R * .24);
    ctx.restore();
    waves(ctx, px, R * 1.1, f, c[2]); flashRing(ctx, px, R, f);
  };
}

/* ---------- Glitch: a dithered entity (ordered 4×4 Bayer, few colours) that slips and tears ---------- */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function glitch(mk) {
  const G = 64, src = mk(G), s = src.getContext('2d', { willReadFrequently: true }), out = mk(G), o = out.getContext('2d');
  const img = o.createImageData(G, G);
  let lutKey = '', lut = [];
  return (ctx, px, f) => {
    const { t, lv, state, P } = f, c = P.c, sp = spinOf(state);
    const key = c.join() + P.white; if (key !== lutKey) { lutKey = key; lut = [null, chans(mix(P.core, c[0], .55)), chans(c[0]), chans(c[1]), chans(mix(c[3], P.white, .5))]; }
    // 1. a soft lit ball with moving cores, in grey, small
    s.clearRect(0, 0, G, G);
    const R = G * .33 * (1 + lv * .16 + (state === 'listening' ? .04 : 0)) * (1 + Math.sin(t * 1.3) * .02), m = G / 2;
    const b = s.createRadialGradient(m - R * .35, m - R * .4, 0, m, m, R);
    b.addColorStop(0, A(P.white, .95)); b.addColorStop(.75, A(P.white, .4)); b.addColorStop(1, A(P.white, .12));
    s.fillStyle = b; s.beginPath(); s.arc(m, m, R, 0, TAU); s.fill();
    s.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = t * .5 * sp * (i % 2 ? 1 : -1.3) + i * 2.1, x = m + Math.cos(a) * R * .45, y = m + Math.sin(a * 1.2) * R * .4, r = R * (.45 + lv * .3);
      const g = s.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, A(P.white, .35)); g.addColorStop(1, A(P.white, 0));
      s.fillStyle = g; s.fillRect(0, 0, G, G);
    }
    s.globalCompositeOperation = 'source-over';
    // 2. dither it into five levels of the colour
    const d = s.getImageData(0, 0, G, G).data, q = img.data;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const i = (y * G + x) * 4, v = (d[i + 3] / 255) * (d[i] / 255);
      const lvl = Math.max(0, Math.min(4, Math.floor(v * 4.2 + (BAYER[(y & 3) * 4 + (x & 3)] + .5) / 16 - .3)));
      const col = lut[lvl];
      if (!col) { q[i + 3] = 0; continue; }
      q[i] = col[0]; q[i + 1] = col[1]; q[i + 2] = col[2]; q[i + 3] = 255;
    }
    o.putImageData(img, 0, 0);
    // 3. big and crisp, with torn slices and a colour ghost now and then
    ctx.clearRect(0, 0, px, px);
    ctx.imageSmoothingEnabled = false;
    const D = px * .82, X = (px - D) / 2, sc = D / G;
    const r = rng(1 + Math.floor(t * (state === 'thinking' ? 18 : 9)));
    const tear = state === 'thinking' ? .9 : state === 'listening' ? .35 + lv * .6 : .12;
    if (r() < tear) { ctx.globalAlpha = .45; ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(out, X + (r() - .5) * sc * 4, X, D, D); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    ctx.drawImage(out, X, X, D, D);
    if (r() < tear) {
      const n = 1 + Math.floor(r() * (2 + lv * 4));
      for (let k = 0; k < n; k++) {
        const sy = Math.floor(r() * G), sh = 1 + Math.floor(r() * 5), dx = (r() - .5) * G * .3 * (.4 + lv);
        ctx.clearRect(X, X + sy * sc, D, sh * sc);
        ctx.drawImage(out, 0, sy, G, sh, X + dx * sc, X + sy * sc, D, sh * sc);
      }
    }
    ctx.imageSmoothingEnabled = true;
    // scanlines on the entity only, then the glow behind it
    ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = A(P.core, .3);
    for (let y = 0; y < G; y += 2) ctx.fillRect(X - D * .2, X + y * sc + sc * .7, D * 1.4, Math.max(1, sc * .3));
    ctx.globalCompositeOperation = 'destination-over'; halo(ctx, px, px * .3, P, lv, .35);
    ctx.globalCompositeOperation = 'source-over';
    waves(ctx, px, px * .3, f, c[2]); flashRing(ctx, px, px * .3, f);
  };
}

/* ---------- Chrome: a liquid metal blob whose outline ripples with the voice ---------- */
function chrome() {
  const N = 72;
  return (ctx, px, f) => {
    const { t, lv, state, P } = f, c = P.c, cx = px / 2, cy = px / 2, sp = spinOf(state) * .8;
    const R = px * .29 * (1 + lv * .08) * (1 + Math.sin(t * 1.3) * .015);
    ctx.clearRect(0, 0, px, px);
    halo(ctx, px, R, P, lv, .5);
    const pts = [];
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU;
      const r = R * (1 + .03 * Math.sin(3 * a + t * .9 * sp) + .018 * Math.sin(5 * a - t * 1.3 * sp) + lv * .1 * Math.sin(8 * a + t * 7) + (state === 'listening' ? .02 * Math.sin(11 * a - t * 4) : 0));
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    const path = new Path2D(), mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    let m0 = mid(pts[N - 1], pts[0]); path.moveTo(m0[0], m0[1]);
    for (let i = 0; i < N; i++) { const p = pts[i], m = mid(p, pts[(i + 1) % N]); path.quadraticCurveTo(p[0], p[1], m[0], m[1]); }
    ctx.save(); ctx.clip(path);
    // chrome bands that drift like a liquid surface
    const o = Math.sin(t * .4 * sp) * .05, st = v => Math.max(0, Math.min(1, v + o));
    const g = ctx.createLinearGradient(cx - R * .3, cy - R, cx + R * .3, cy + R);
    g.addColorStop(0, mix(P.white, c[1], .15)); g.addColorStop(st(.2), mix(c[1], P.white, .35)); g.addColorStop(st(.38), mix(P.core, c[0], .35));
    g.addColorStop(st(.48), mix(c[0], P.core, .2)); g.addColorStop(st(.53), mix(P.white, c[3], .1)); g.addColorStop(st(.6), mix(P.core, c[2], .25));
    g.addColorStop(st(.8), mix(c[2], P.white, .25)); g.addColorStop(1, mix(c[3], P.white, .45));
    ctx.fillStyle = g; ctx.fillRect(0, 0, px, px);
    // depth: dark at the rim
    const rim = ctx.createRadialGradient(cx - R * .2, cy - R * .25, R * .3, cx, cy, R * 1.12);
    rim.addColorStop(0, A(P.core, 0)); rim.addColorStop(1, A(P.core, .7)); ctx.fillStyle = rim; ctx.fillRect(0, 0, px, px);
    // a bright window reflection top left and a coloured bounce light at the bottom, like polished metal
    const sp1 = ctx.createRadialGradient(cx - R * .38, cy - R * .5, 0, cx - R * .38, cy - R * .5, R * .5);
    sp1.addColorStop(0, A(P.white, .85)); sp1.addColorStop(.35, A(P.white, .25)); sp1.addColorStop(1, A(P.white, 0));
    ctx.fillStyle = sp1; ctx.fillRect(0, 0, px, px);
    const bounce = ctx.createRadialGradient(cx, cy + R * 1.05, 0, cx, cy + R * 1.05, R * .9);
    bounce.addColorStop(0, A(c[2], .7)); bounce.addColorStop(1, A(c[2], 0)); ctx.fillStyle = bounce; ctx.fillRect(0, 0, px, px);
    // moving reflections
    ctx.globalCompositeOperation = 'screen';
    for (let k = 0; k < 3; k++) {
      const a = t * .3 * sp * (k % 2 ? -1 : 1) + k * 2.1, x = cx + Math.cos(a) * R * .35, y = cy - R * .3 + Math.sin(a * 1.4) * R * .25;
      const h = ctx.createRadialGradient(x, y, 0, x, y, R * (.35 + lv * .2)); h.addColorStop(0, A(P.white, .55)); h.addColorStop(1, A(P.white, 0));
      ctx.fillStyle = h; ctx.fillRect(0, 0, px, px);
    }
    ctx.restore();
    ctx.strokeStyle = A(P.white, .55); ctx.lineWidth = px * .003; ctx.stroke(path);
    ctx.strokeStyle = A(c[1], .35 + lv * .4); ctx.lineWidth = px * .008; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'none'; ctx.stroke(path); ctx.restore();
    waves(ctx, px, R, f, c[1]); flashRing(ctx, px, R, f);
  };
}

const MAKERS = { glass, oracle, plasma, swarm, holo, glitch, chrome };
/** A drawer for one canvas: (ctx, px, f) => void. `mk(size)` makes an offscreen canvas. Unknown ids draw Glass. */
export function renderer(style, mk) { return (MAKERS[style] || glass)(mk); }
