/* Orb styles for the Orb desktop (layout.js): thirteen different ways of drawing the entity, all in canvas 2D, all fed
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
  ['marble', 'Marble'], ['sun', 'Sun'], ['blackhole', 'Black hole'], ['crystal', 'Crystal'], ['aurora', 'Aurora'], ['planet', 'Planet'],
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

/* ---------- Marble: a classical Greek head in veined white stone (modelled and lit in code, not a photograph) ----------
 * It breathes and nods like every style; with the voice the veins and the closed eyes light up in the colour, and
 * while it listens the lips part. */
function noise2(seed) {
  const h = (x, y) => { let n = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const sm = v => v * v * (3 - 2 * v);
  return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf; };
}
// The head itself: a small signed-distance sculpture (cranium, jaw, chin, brow, straight Greek nose, closed lids,
// full lips, cheeks, ears, neck; curls of hair as a ripple over the crown) ray-marched ONCE per page on the CPU into a
// lit greyscale image (soft key light from the upper left, a cool fill, ambient occlusion) plus a vein mask that
// follows the form in 3D. Every frame only composites those two images.
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * .25; };
const smax = (a, b, k) => -smin(-a, -b, k);
const ell = (x, y, z, cx, cy, cz, rx, ry, rz) => { const X = (x - cx) / rx, Y = (y - cy) / ry, Z = (z - cz) / rz, k0 = Math.hypot(X, Y, Z), k1 = Math.hypot(X / rx, Y / ry, Z / rz); return k1 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz); };
const cap = (x, y, z, ax, ay, az, bx, by, bz, r) => { const px = x - ax, py = y - ay, pz = z - az, dx = bx - ax, dy = by - ay, dz = bz - az, h = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz))); return Math.hypot(px - dx * h, py - dy * h, pz - dz * h) - r; };
function headSDF(x, y, z) {
  const ax = Math.abs(x);
  let d = ell(x, y, z, 0, .22, -.04, .56, .68, .68);                               // cranium
  d = smin(d, ell(x, y, z, 0, -.24, .1, .4, .52, .5), .24);                       // face and jaw, tapering to the chin
  d = smin(d, ell(x, y, z, 0, -.6, .3, .2, .16, .18), .16);                       // chin
  d = smin(d, ell(ax, y, z, .26, -.12, .4, .16, .18, .17), .16);                  // cheeks
  d = smin(d, cap(ax, y, z, .06, .2, .54, .36, .2, .5, .075), .12);               // brow ridge
  d = smin(d, cap(x, y, z, 0, .14, .6, 0, -.19, .77, .065), .1);                  // nose bridge, straight from the brow
  d = smin(d, ell(x, y, z, 0, -.21, .74, .1, .06, .07), .06);                     // nose tip and wings
  d = smax(d, -ell(ax, y, z, .22, .04, .66, .14, .1, .12), .08);                 // eye sockets
  d = smin(d, ell(ax, y, z, .21, .025, .545, .105, .055, .075), .05);             // closed lids, heavy and calm
  d = smin(d, cap(ax, y, z, 0, -.355, .64, .12, -.37, .6, .045), .04);           // upper lip
  d = smin(d, cap(ax, y, z, 0, -.43, .62, .1, -.42, .58, .05), .04);              // lower lip
  d = smax(d, -cap(ax, y, z, 0, -.395, .68, .13, -.395, .62, .012), .02);        // the parting of the lips
  d = smin(d, ell(ax, y, z, .53, -.02, -.06, .045, .12, .07), .09);               // ears, close to the head
  d = smin(d, cap(x, y, z, 0, -.5, -.1, 0, -1.6, -.16, .33), .2);               // neck
  // curls over the crown and the back of the head
  const hair = Math.max(0, Math.min(1, (y - .22 + Math.max(0, -z) * .6) * 4));
  if (hair > 0) d -= hair * .022 * (Math.sin(x * 34 + Math.sin(y * 11) * 2) * Math.sin(y * 30 + Math.sin(z * 9) * 2) * Math.sin(z * 32) + .5);
  return d;
}
let bustCache = null;
function bust(mk, S) {
  if (bustCache && bustCache.S === S) return bustCache;
  const lum = mk(S), vein = mk(S), lo = lum.getContext('2d'), vo = vein.getContext('2d');
  const L = lo.createImageData(S, S), V = vo.createImageData(S, S), n = noise2(11);
  const th = -.32, ct = Math.cos(th), sn = Math.sin(th), SC = 1.12, Y0 = -.08;
  const f = (x, y, z) => headSDF(x * ct - z * sn, y, x * sn + z * ct);       // turned a little: three-quarter view
  const lx = -.55, ly = .62, lz = .56, ll = Math.hypot(lx, ly, lz);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = (i / S * 2 - 1) * SC, y = -(j / S * 2 - 1) * SC + Y0, pix = SC * 2 / S; let z = 1.6, d = 0, hit = false, best = 9, bz = 0;
    for (let s = 0; s < 140; s++) { d = f(x, y, z); if (d < best) { best = d; bz = z; } if (d < .002) { hit = true; break; } z -= Math.max(d * .55, .003); if (z < -1.4) break; }
    const p = (j * S + i) * 4;
    let cover = 1;   // anti-aliased silhouette: a ray that only grazes the head covers part of its pixel
    if (!hit) { if (best > pix) continue; cover = 1 - best / pix; z = bz; }
    const e = .003, nx = f(x + e, y, z) - f(x - e, y, z), ny = f(x, y + e, z) - f(x, y - e, z), nz = f(x, y, z + e) - f(x, y, z - e), nl = Math.hypot(nx, ny, nz) || 1;
    const Nx = nx / nl, Ny = ny / nl, Nz = nz / nl;
    let ao = 0; for (let k = 1; k <= 5; k++) { const h = k * .045; ao += (h - f(x + Nx * h, y + Ny * h, z + Nz * h)) / Math.pow(2, k); }
    ao = Math.max(0, Math.min(1, 1 - ao * 4.5));
    const dif = Math.max(0, (Nx * lx + Ny * ly + Nz * lz) / ll), fill = Math.max(0, Nx * .6 - Ny * .2 + Nz * .4) * .25, rim = Math.pow(1 - Math.max(0, Nz), 3) * .18;
    const sss = .1 * Math.max(0, 1 - Math.abs(Nz));   // marble lets a little light through at the edges
    const v = Math.min(1, Math.pow((.08 + .85 * dif + fill + rim + sss) * (.35 + .65 * ao), 1.15));
    // a soft fade at the bottom of the neck: a bust, not a cut
    const fade = Math.max(0, Math.min(1, (y + 1.02) * 3.2));
    L.data[p] = L.data[p + 1] = L.data[p + 2] = Math.round(v * 255); L.data[p + 3] = Math.round(255 * fade * cover);
    // veins in the stone, following the form (3D coordinates)
    const q = x * .8 + y * .9 + z * .5, w = n(x * 2.5 + 7, y * 2.5 + z * 1.7) * .6 + n(x * 5.3 + 3, y * 5.1 - z * 2.3) * .3;
    const vv = Math.abs(Math.sin(q * 3.4 + w * 6)), va = Math.pow(1 - vv, 16) * .9 + Math.pow(1 - vv, 3) * .07;
    V.data[p] = V.data[p + 1] = V.data[p + 2] = 255; V.data[p + 3] = Math.round(255 * va * fade * cover);
  }
  lo.putImageData(L, 0, 0); vo.putImageData(V, 0, 0);
  // where the lids and lips land on the image (same turn), for the glow and the parting while it speaks
  const proj = (x, y, z) => [((x * ct + z * sn) / SC + 1) / 2, ((-(y - Y0)) / SC + 1) / 2];
  bustCache = { S, lum, vein, eyes: [proj(-.22, .03, .62), proj(.22, .03, .62)], mouth: proj(0, -.395, .66) };
  return bustCache;
}
function marble(mk) {
  const S = 260, tone = mk(S), to = tone.getContext('2d'), tint = (src, col) => { to.globalCompositeOperation = 'source-over'; to.clearRect(0, 0, S, S); to.drawImage(src, 0, 0); to.globalCompositeOperation = 'source-in'; to.fillStyle = col; to.fillRect(0, 0, S, S); return tone; };
  const stoneCv = mk(S), so = stoneCv.getContext('2d'); let stoneKey = '';
  return (ctx, px, f) => {
    const { t, lv, state, blink, P } = f, c = P.c, cx = px / 2, cy = px / 2, B = bust(mk, S);
    const stone = mix(P.white, c[1], .12), deep = mix(c[2], P.core, .35);
    if (stoneKey !== stone + deep) {   // the lit stone in this colour: light → the stone, shadow → a deep tint of it
      stoneKey = stone + deep; so.globalCompositeOperation = 'source-over'; so.clearRect(0, 0, S, S); so.fillStyle = deep; so.fillRect(0, 0, S, S);
      so.globalCompositeOperation = 'screen'; so.drawImage(B.lum, 0, 0); so.globalCompositeOperation = 'multiply'; so.fillStyle = stone; so.fillRect(0, 0, S, S);
      so.globalCompositeOperation = 'destination-in'; so.drawImage(B.lum, 0, 0); so.globalCompositeOperation = 'source-over';
      so.globalAlpha = .75; so.drawImage(tint(B.vein, mix(deep, stone, .25)), 0, 0); so.globalAlpha = 1;
    }
    const R = radiusOf(px, f, .3), D = R * 2.75, nod = Math.sin(t * .5) * R * .02, x0 = cx - D / 2, y0 = cy - D / 2 + nod;
    ctx.clearRect(0, 0, px, px);
    halo(ctx, px, R, P, lv, .35 + (state === 'listening' ? .25 : 0));
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(stoneCv, x0, y0, D, D);
    // with the voice the veins light up in the colour, and the closed eyes glow
    const glow = Math.min(1, lv * 1.6 + (state === 'thinking' ? .35 + .25 * Math.sin(t * 5) : 0) + (state === 'listening' ? .2 : 0));
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (glow > .02) { ctx.globalAlpha = glow; ctx.drawImage(tint(B.vein, c[0]), x0, y0, D, D); ctx.globalAlpha = glow * .5; ctx.drawImage(tint(B.vein, c[3]), x0, y0, D, D); ctx.globalAlpha = 1; }
    const eg = blink ? 0 : Math.max(glow, .12);
    for (const [ex, ey] of B.eyes) { const X = x0 + ex * D, Y = y0 + ey * D, r = D * .07;
      const g = ctx.createRadialGradient(X, Y, 0, X, Y, r); g.addColorStop(0, A(mix(c[3], P.white, .5), .9 * eg)); g.addColorStop(.35, A(c[0], .55 * eg)); g.addColorStop(1, A(c[0], 0)); ctx.fillStyle = g; ctx.fillRect(X - r, Y - r, r * 2, r * 2); }
    ctx.restore();
    const mo = state === 'listening' ? .2 + lv * .9 : state === 'thinking' ? .2 + .2 * Math.abs(Math.sin(t * 6)) : 0;
    if (mo > .02) { const [mx, my] = B.mouth, X = x0 + mx * D, Y = y0 + my * D; ctx.fillStyle = A(P.core, .32 * Math.min(1, mo)); ctx.beginPath(); ctx.ellipse(X, Y, D * .045, D * .004 * (1 + mo * 1.5), 0, 0, TAU); ctx.fill(); }
    waves(ctx, px, R * 1.1, f, c[0]); flashRing(ctx, px, R, f);
  };
}

/* ---------- Sun: a burning disc (granules, darker limb) with a corona of flares that leap with the voice ---------- */
function sun() {
  const N = 96, seeds = Array.from({ length: N }, (_, i) => ((i * 7919) % 997) / 997);
  return (ctx, px, f) => {
    const { t, lv, state, P } = f, c = P.c, R = radiusOf(px, f, .24), cx = px / 2, cy = px / 2, sp = spinOf(state);
    ctx.clearRect(0, 0, px, px);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const cor = ctx.createRadialGradient(cx, cy, R * .9, cx, cy, R * 2.05); cor.addColorStop(0, A(c[3], .55 + lv * .3)); cor.addColorStop(.3, A(c[0], .22)); cor.addColorStop(1, A(c[0], 0));
    ctx.fillStyle = cor; ctx.fillRect(0, 0, px, px);
    // flares: thin tapering rays, each breathing at its own pace
    ctx.lineCap = 'round';
    for (let i = 0; i < N; i++) {
      const s = seeds[i], a = i / N * TAU + Math.sin(t * .1 * sp + s * 9) * .05;
      const L = R * (.12 + .32 * Math.pow(.5 + .5 * Math.sin(t * (.6 + s) * sp + s * 40), 3) + lv * .7 * s);
      ctx.strokeStyle = A(i % 3 ? c[1] : c[3], .18 + .25 * s); ctx.lineWidth = px * (.002 + .003 * s);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * .97, cy + Math.sin(a) * R * .97); ctx.quadraticCurveTo(cx + Math.cos(a + .05) * (R + L * .6), cy + Math.sin(a + .05) * (R + L * .6), cx + Math.cos(a + .08 * (s - .5)) * (R + L), cy + Math.sin(a + .08 * (s - .5)) * (R + L)); ctx.stroke();
    }
    // two prominences: loops of fire on the limb
    for (let k = 0; k < 2; k++) {
      const a = t * .05 * sp + k * 2.7, h = R * (.25 + .12 * Math.sin(t * .8 + k) + lv * .3);
      ctx.strokeStyle = A(c[0], .5); ctx.lineWidth = px * .008;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a - .18) * R, cy + Math.sin(a - .18) * R); ctx.bezierCurveTo(cx + Math.cos(a - .25) * (R + h), cy + Math.sin(a - .25) * (R + h), cx + Math.cos(a + .25) * (R + h), cy + Math.sin(a + .25) * (R + h), cx + Math.cos(a + .18) * R, cy + Math.sin(a + .18) * R); ctx.stroke();
    }
    ctx.restore();
    // the disc: white-hot middle, a darker orange limb, slowly churning granules
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    const d = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); d.addColorStop(0, mix(P.white, c[3], .25)); d.addColorStop(.55, c[3]); d.addColorStop(.85, c[1]); d.addColorStop(1, mix(c[0], P.core, .3));
    ctx.fillStyle = d; ctx.fillRect(0, 0, px, px);
    ctx.globalCompositeOperation = 'overlay';
    for (let i = 0; i < 26; i++) { const s = seeds[i * 3], a = s * TAU + t * .04 * sp * (i % 2 ? 1 : -1), r = R * Math.sqrt(seeds[i * 3 + 1]) * .9, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, gr = R * (.12 + .1 * seeds[i * 3 + 2]);
      const g = ctx.createRadialGradient(x, y, 0, x, y, gr); g.addColorStop(0, A(i % 2 ? P.white : c[0], .35)); g.addColorStop(1, A(c[0], 0)); ctx.fillStyle = g; ctx.fillRect(x - gr, y - gr, gr * 2, gr * 2); }
    ctx.restore();
    flashRing(ctx, px, R, f);
  };
}

/* ---------- Black hole: a dark heart, a bright photon ring and a turning accretion disc bent over the top ---------- */
function blackhole() {
  return (ctx, px, f) => {
    const { t, lv, state, P } = f, c = P.c, R = radiusOf(px, f, .36), cx = px / 2, cy = px / 2, sp = spinOf(state), tilt = .3;
    const H = R * .44, ring = (from, to, alpha, back) => {
      // the disc as many thin streaks on an ellipse; the side coming at us brighter (Doppler)
      for (let k = 0; k < 7; k++) {
        const rr = R * (.6 + k * .06), w = px * (.007 + .003 * (k % 3));
        for (let s = 0; s < 36; s++) {
          const a0 = from + (to - from) * s / 36, a1 = a0 + (to - from) / 36 * .8, ph = a0 - t * (.9 - k * .08) * sp;
          const dop = .55 + .45 * Math.cos(a0), flick = .6 + .4 * Math.sin(ph * 5 + k * 1.7);
          ctx.strokeStyle = A(k < 2 ? mix(c[3], P.white, .5) : c[k % 2 ? 0 : 1], alpha * dop * flick * (1 + lv * .6) * (back ? .7 : 1)); ctx.lineWidth = w;
          ctx.beginPath(); ctx.ellipse(cx, cy, rr * (1 + lv * .05), rr * tilt, 0, a0, a1); ctx.stroke();
        }
      }
    };
    ctx.clearRect(0, 0, px, px);
    halo(ctx, px, R, P, lv, .35);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ring(Math.PI, TAU, .65, true);   // the far half of the disc, behind the hole
    // light bent over the top and under the bottom (lensing): two arcs hugging the shadow
    for (const [s, a] of [[-1, .7], [1, .35]]) {
      const g = ctx.createLinearGradient(cx - R * .6, 0, cx + R * .6, 0); g.addColorStop(0, A(c[0], 0)); g.addColorStop(.5, A(mix(c[3], P.white, .4), a * (1 + lv))); g.addColorStop(1, A(c[1], 0));
      ctx.strokeStyle = g; ctx.lineWidth = px * (.012 + lv * .01);
      ctx.beginPath(); ctx.ellipse(cx, cy, R * .52, R * .5, 0, s < 0 ? Math.PI * 1.08 : Math.PI * .08, s < 0 ? Math.PI * 1.92 : Math.PI * .92); ctx.stroke();
    }
    ctx.restore();
    // the shadow and its photon ring
    const sh = ctx.createRadialGradient(cx, cy, H * .5, cx, cy, H * 1.15); sh.addColorStop(0, P.core); sh.addColorStop(.86, P.core); sh.addColorStop(1, A(P.core, 0));
    ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(cx, cy, H * 1.15, 0, TAU); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = A(mix(c[3], P.white, .6), .8 + lv * .2); ctx.lineWidth = px * .004; ctx.beginPath(); ctx.arc(cx, cy, H * 1.02, 0, TAU); ctx.stroke();
    ctx.strokeStyle = A(c[0], .35); ctx.lineWidth = px * .012; ctx.beginPath(); ctx.arc(cx, cy, H * 1.06, 0, TAU); ctx.stroke();
    ring(0, Math.PI, .9, false);   // the near half, in front
    ctx.restore();
    waves(ctx, px, R, f, c[2]); flashRing(ctx, px, R, f);
  };
}

/* ---------- Crystal: a turning cut gem (an icosahedron), each facet lit by angle, edges catching the light ---------- */
function crystal() {
  const p = (1 + Math.sqrt(5)) / 2, V = [[-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0], [0, -1, p], [0, 1, p], [0, -1, -p], [0, 1, -p], [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1]].map(v => { const l = Math.hypot(...v); return v.map(x => x / l); });
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  let rot = 0, last = 0;
  return (ctx, px, f) => {
    const { t, lv, state, P } = f, c = P.c, R = radiusOf(px, f, .3), cx = px / 2, cy = px / 2;
    rot += (last && t > last ? Math.min(.1, t - last) : 0) * (state === 'thinking' ? 1.6 : state === 'listening' ? .7 : .25); last = t;
    const ca = Math.cos(rot), sa = Math.sin(rot), cb = Math.cos(.45 + Math.sin(t * .3) * .15), sb = Math.sin(.45 + Math.sin(t * .3) * .15);
    const Q = V.map(([x, y, z]) => { const x1 = x * ca + z * sa, z1 = -x * sa + z * ca, y1 = y * cb - z1 * sb, z2 = y * sb + z1 * cb; return [cx + x1 * R, cy + y1 * R, z2]; });
    const L = [-.45, -.6, .66];
    ctx.clearRect(0, 0, px, px);
    halo(ctx, px, R, P, lv, .5);
    const faces = F.map(fc => { const [a, b, d] = fc.map(i => Q[i]); const ux = b[0] - a[0], uy = b[1] - a[1], uz = (b[2] - a[2]) * R, vx = d[0] - a[0], vy = d[1] - a[1], vz = (d[2] - a[2]) * R;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      return { pts: [a, b, d], z: (a[2] + b[2] + d[2]) / 3, n: [nx, ny, nz] }; }).sort((a, b) => a.z - b.z);
    ctx.lineJoin = 'round';
    faces.forEach((fc, i) => {
      const lit = Math.max(0, fc.n[0] * L[0] + fc.n[1] * L[1] + fc.n[2] * L[2]), front = fc.z > 0;
      const col = mix(c[i % 4], P.white, .15 + lit * .5);
      ctx.fillStyle = A(front ? col : mix(col, P.core, .5), front ? .3 + lit * .45 : .35);
      ctx.beginPath(); ctx.moveTo(fc.pts[0][0], fc.pts[0][1]); ctx.lineTo(fc.pts[1][0], fc.pts[1][1]); ctx.lineTo(fc.pts[2][0], fc.pts[2][1]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = A(P.white, front ? .35 + lit * .45 + lv * .3 : .1); ctx.lineWidth = px * (front ? .003 : .0015); ctx.stroke();
    });
    // the light inside, and a few glints on the corners facing us
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (.55 + lv * .3)); core.addColorStop(0, A(c[1], .45 + lv * .4)); core.addColorStop(1, A(c[0], 0)); ctx.fillStyle = core; ctx.fillRect(0, 0, px, px);
    for (const q of Q) if (q[2] > .55) { const s = (.5 + .5 * Math.sin(t * 3 + q[0])) * (q[2] - .55) * 2.2; const g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], R * .12); g.addColorStop(0, A(P.white, .8 * s)); g.addColorStop(1, A(P.white, 0)); ctx.fillStyle = g; ctx.fillRect(q[0] - R * .12, q[1] - R * .12, R * .24, R * .24); }
    ctx.restore();
    waves(ctx, px, R, f, c[2]); flashRing(ctx, px, R, f);
  };
}

/* ---------- Aurora: northern-lights curtains rippling inside a dark glass sphere ---------- */
function aurora() {
  return (ctx, px, f) => {
    const { t, lv, state, P } = f, c = P.c, R = radiusOf(px, f), cx = px / 2, cy = px / 2, sp = spinOf(state);
    ctx.clearRect(0, 0, px, px);
    halo(ctx, px, R, P, lv, .5);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    const bg = ctx.createLinearGradient(0, cy - R, 0, cy + R); bg.addColorStop(0, P.core); bg.addColorStop(1, mix(P.core, c[0], .25)); ctx.fillStyle = bg; ctx.fillRect(0, 0, px, px);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      const base = cy - R * (.15 - k * .14), amp = R * (.12 + lv * .18), hgt = R * (.55 - k * .07), col = c[k % 4];
      for (let x = cx - R; x < cx + R; x += px * .006) {
        const u = (x - cx) / R, y = base + Math.sin(u * 3.2 + t * .5 * sp + k * 1.3) * amp + Math.sin(u * 7.1 - t * .8 * sp + k) * amp * .35;
        const s = .5 + .5 * Math.sin(u * 13 + t * 1.7 * sp + k * 2.3);
        const g = ctx.createLinearGradient(x, y - hgt, x, y + hgt * .12);
        g.addColorStop(0, A(col, 0)); g.addColorStop(.75, A(col, (.05 + .1 * s) * (1 + lv))); g.addColorStop(.97, A(mix(col, P.white, .4), .22 + .2 * s)); g.addColorStop(1, A(col, 0));
        ctx.fillStyle = g; ctx.fillRect(x, y - hgt, px * .007, hgt * 1.12);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    const hl = ctx.createRadialGradient(cx - R * .35, cy - R * .45, 0, cx - R * .35, cy - R * .45, R * .7); hl.addColorStop(0, A(P.white, .2)); hl.addColorStop(1, A(P.white, 0)); ctx.fillStyle = hl; ctx.fillRect(0, 0, px, px);
    const rim = ctx.createRadialGradient(cx, cy, R * .7, cx, cy, R); rim.addColorStop(0, A(P.core, 0)); rim.addColorStop(1, A(P.core, .6)); ctx.fillStyle = rim; ctx.fillRect(0, 0, px, px);
    ctx.restore();
    ctx.strokeStyle = A(c[1], .3 + lv * .3); ctx.lineWidth = px * .003; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    waves(ctx, px, R, f, c[1]); flashRing(ctx, px, R, f);
  };
}

/* ---------- Planet: a banded world turning under a tilted ring; the ring brightens with the voice ---------- */
function planet() {
  return (ctx, px, f) => {
    const { t, lv, state, P } = f, c = P.c, R = radiusOf(px, f, .22), cx = px / 2, cy = px / 2, sp = spinOf(state), tilt = -.32;
    const ringPart = (from, to) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilt);
      for (let k = 0; k < 22; k++) { const rr = R * (1.3 + k * .028), a = (k % 5 === 3 ? .08 : .35 - k * .008) * (1 + lv * .9);
        ctx.strokeStyle = A(k % 3 ? c[3] : c[1], a); ctx.lineWidth = px * .004; ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * .28, 0, from, to); ctx.stroke(); }
      ctx.restore();
    };
    ctx.clearRect(0, 0, px, px);
    halo(ctx, px, R, P, lv, .4);
    ringPart(Math.PI, TAU);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip(); ctx.translate(cx, cy); ctx.rotate(tilt);
    const off = (t * .04 * sp) % 1;
    for (let i = -12; i < 12; i++) { const y = (i / 12 + off * .2) * R * 1.2, h = R * (.06 + .05 * Math.abs(Math.sin(i * 2.3)));
      ctx.fillStyle = mix(c[(i + 40) % 4], P.white, .12 + .1 * Math.sin(i * 1.7)); ctx.fillRect(-R * 1.2, y, R * 2.4, h + 1); }
    // a storm turning in one band
    const sx = Math.cos(t * .2 * sp) * R * .5, st = ctx.createRadialGradient(sx, R * .2, 0, sx, R * .2, R * .16); st.addColorStop(0, A(c[0], .8)); st.addColorStop(1, A(c[0], 0)); ctx.fillStyle = st; ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    const sh = ctx.createRadialGradient(cx - R * .45, cy - R * .4, R * .2, cx - R * .1, cy - R * .1, R * 1.25); sh.addColorStop(0, A(P.white, .25)); sh.addColorStop(.5, A(P.core, 0)); sh.addColorStop(1, A(P.core, .8));
    ctx.fillStyle = sh; ctx.fillRect(0, 0, px, px); ctx.restore();
    ringPart(0, Math.PI);
    waves(ctx, px, R * 1.3, f, c[2]); flashRing(ctx, px, R, f);
  };
}

const MAKERS = { glass, oracle, plasma, swarm, holo, glitch, chrome, marble, sun, blackhole, crystal, aurora, planet };
/** A drawer for one canvas: (ctx, px, f) => void. `mk(size)` makes an offscreen canvas. Unknown ids draw Glass. */
export function renderer(style, mk) { return (MAKERS[style] || glass)(mk); }
