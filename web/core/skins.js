/* Wizard OS skins: one shell, many looks (James, 11 Oct 2026: "same exact layout, feel and sizing; a skin of
 * our existing operating system"). A skin changes only:
 *   - design tokens, set inline on <html> so every existing var(--ink)/var(--glass)/… follows (blended while browsing)
 *   - the clock typeface and a few card details (core/skins.css, keyed on html[data-skin])
 *   - the living background: two canvases under the desks (#skinA/#skinB) that crossfade while browsing
 *   - the orb's colour, through a CSS filter; orb.js stays byte-identical with the Android copy
 * Nebula is the original look and sets nothing. Choice persists in localStorage 'wos.skin'.
 * API: WosSkin.list, .current, .set(id), .preview(pos), .commit(i), .index(id). */
(() => {
  'use strict';
  const KEY = 'wos.skin';
  const TAU = Math.PI * 2, rnd = (a, b) => a + Math.random() * (b - a);
  const T = (o) => o; // token table helper (readability)
  const SKINS = [
    { id: 'nebula', name: 'Nebula', who: 'For dreamers and late-night thinkers. The original.', orb: [0, 1, 1],
      t: T({ bg: '#05030c', ink: '#f3efff', 'ink-2': '#b9b0d8', 'ink-3': '#7d74a3', line: 'rgba(205,190,255,.13)', 'line-2': 'rgba(205,190,255,.24)', glass: 'rgba(18,12,38,.58)', 'glass-2': 'rgba(28,19,58,.72)',
        violet: '#8f63ff', 'violet-2': '#b99bff', pink: '#ff5ccf', cyan: '#3fe0ff', amber: '#ffbe55', green: '#4ff0b0', red: '#ff6b86',
        'sk-time-a': '#ffffff', 'sk-time-b': '#b8a6ff', 'sk-dock': 'rgba(8,5,18,.94)', 'sk-dock-line': 'rgba(205,190,255,.10)', 'sk-ddot': 'rgba(205,190,255,.45)', 'sk-tour': 'rgba(8,5,18,.78)', 'sk-dim': 'rgba(3,1,10,.74)' }) },
    { id: 'grove', name: 'Grove', who: 'For the grounded. Walkers, gardeners, anyone who finds screens too loud.', orb: [-160, .85, 1.08],
      t: T({ bg: '#0e2116', ink: '#eef5e9', 'ink-2': '#b5cbb9', 'ink-3': '#7f9a86', line: 'rgba(207,232,200,.14)', 'line-2': 'rgba(207,232,200,.26)', glass: 'rgba(12,30,19,.55)', 'glass-2': 'rgba(22,48,32,.72)',
        violet: '#7ddc8a', 'violet-2': '#e6c66b', pink: '#e8a07a', cyan: '#8fd6c4', amber: '#f0b45a', green: '#9be37a', red: '#e8806a',
        'sk-time-a': '#f6f9ee', 'sk-time-b': '#cfe3a6', 'sk-dock': 'rgba(9,22,14,.94)', 'sk-dock-line': 'rgba(207,232,200,.10)', 'sk-ddot': 'rgba(207,232,200,.45)', 'sk-tour': 'rgba(9,22,14,.82)', 'sk-dim': 'rgba(4,12,7,.72)' }) },
    { id: 'paper', name: 'Paper', who: 'For minimalists. A phone that looks like a good notebook.', orb: [95, 1.1, 1],
      t: T({ bg: '#f6f3ec', ink: '#1d1b17', 'ink-2': '#57524a', 'ink-3': '#8a8577', line: 'rgba(40,30,15,.12)', 'line-2': 'rgba(40,30,15,.22)', glass: 'rgba(255,253,248,.92)', 'glass-2': 'rgba(255,253,248,1)',
        violet: '#d9462b', 'violet-2': '#c2412a', pink: '#2f6fde', cyan: '#2f6fde', amber: '#c98a12', green: '#2e8b57', red: '#c43d2b',
        'sk-time-a': '#1d1b17', 'sk-time-b': '#4a443a', 'sk-dock': 'rgba(246,243,236,.97)', 'sk-dock-line': 'rgba(40,30,15,.12)', 'sk-ddot': 'rgba(40,30,15,.35)', 'sk-tour': 'rgba(255,253,248,.95)', 'sk-dim': 'rgba(246,243,236,.74)' }) },
    { id: 'tide', name: 'Tide', who: 'For the calm. Breath, water, slow mornings.', orb: [-95, 1, 1.06],
      t: T({ bg: '#052a36', ink: '#e8f6f8', 'ink-2': '#a9cdd4', 'ink-3': '#6f98a2', line: 'rgba(168,230,238,.15)', 'line-2': 'rgba(168,230,238,.27)', glass: 'rgba(4,38,50,.5)', 'glass-2': 'rgba(8,56,72,.7)',
        violet: '#3fd2c0', 'violet-2': '#7fd8ff', pink: '#ffd08a', cyan: '#7fd8ff', amber: '#ffc070', green: '#8fe3a8', red: '#ff8a8a',
        'sk-time-a': '#f2fbfc', 'sk-time-b': '#9fe6e6', 'sk-dock': 'rgba(3,26,34,.94)', 'sk-dock-line': 'rgba(168,230,238,.10)', 'sk-ddot': 'rgba(168,230,238,.45)', 'sk-tour': 'rgba(3,26,34,.82)', 'sk-dim': 'rgba(1,14,19,.72)' }) },
    { id: 'ember', name: 'Ember', who: 'For night owls who want a lamp, not a lab.', orb: [115, 1.15, 1.05],
      t: T({ bg: '#140a06', ink: '#ffe9d6', 'ink-2': '#d4b49c', 'ink-3': '#a0806a', line: 'rgba(255,176,122,.15)', 'line-2': 'rgba(255,176,122,.27)', glass: 'rgba(36,18,10,.58)', 'glass-2': 'rgba(52,26,14,.74)',
        violet: '#ff8a3d', 'violet-2': '#ffb470', pink: '#e2553a', cyan: '#ffcf8a', amber: '#ffc24d', green: '#ffd27a', red: '#ff6a4d',
        'sk-time-a': '#fff1e2', 'sk-time-b': '#ffb27a', 'sk-dock': 'rgba(20,10,6,.95)', 'sk-dock-line': 'rgba(255,176,122,.10)', 'sk-ddot': 'rgba(255,176,122,.45)', 'sk-tour': 'rgba(20,10,6,.84)', 'sk-dim': 'rgba(10,5,3,.74)' }) },
    { id: 'signal', name: 'Signal', who: 'For operators. A phone that means business.', orb: [-125, 1.2, 1.1],
      t: T({ bg: '#000000', ink: '#d8ffd8', 'ink-2': '#8fc79a', 'ink-3': '#4f8a5a', line: 'rgba(57,255,140,.16)', 'line-2': 'rgba(57,255,140,.32)', glass: 'rgba(0,10,4,.62)', 'glass-2': 'rgba(0,20,8,.76)',
        violet: '#39ff8c', 'violet-2': '#ffbe55', pink: '#5ad1ff', cyan: '#5ad1ff', amber: '#ffbe55', green: '#39ff8c', red: '#ff5f56',
        'sk-time-a': '#e6ffe6', 'sk-time-b': '#39ff8c', 'sk-dock': 'rgba(0,0,0,.96)', 'sk-dock-line': 'rgba(57,255,140,.18)', 'sk-ddot': 'rgba(57,255,140,.5)', 'sk-tour': 'rgba(0,8,3,.88)', 'sk-dim': 'rgba(0,0,0,.76)' }) },
  ];
  const N = SKINS.length;
  const idxOf = id => Math.max(0, SKINS.findIndex(s => s.id === id));
  const stored = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };

  /* ---------- colour blending ---------- */
  const parse = c => {
    if (c[0] === '#') { const h = c.slice(1); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]; }
    const m = c.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] == null ? 1 : m[3]];
  };
  const PARSED = SKINS.map(s => Object.fromEntries(Object.entries(s.t).map(([k, v]) => [k, parse(v)])));
  const mixc = (A, B, f) => { const r = A.map((v, i) => v + (B[i] - v) * f); return `rgba(${r[0] | 0},${r[1] | 0},${r[2] | 0},${+r[3].toFixed(3)})`; };
  const root = document.documentElement;
  let pos = idxOf(stored()), shown = -1;
  function paint(p) {
    p = Math.max(0, Math.min(N - 1, p)); pos = p;
    const a = Math.floor(p), b = Math.min(N - 1, a + 1), f = p - a;
    const st = root.style;
    if (a === 0 && f < 1e-3) { for (const k of Object.keys(SKINS[0].t)) st.removeProperty('--' + k); st.removeProperty('--sk-orb'); }
    else {
      for (const k of Object.keys(SKINS[0].t)) st.setProperty('--' + k, mixc(PARSED[a][k], PARSED[b][k], f));
      const o = SKINS[a].orb.map((v, i) => v + (SKINS[b].orb[i] - v) * f);
      st.setProperty('--sk-orb', `hue-rotate(${o[0].toFixed(1)}deg) saturate(${o[1].toFixed(3)}) brightness(${o[2].toFixed(3)})`);
    }
    // space layers belong to Nebula only
    const space = a === 0 ? 1 - f : 0; st.setProperty('--sk-space', space.toFixed(3));
    const near = Math.round(p);
    if (near !== shown) { shown = near; root.dataset.skin = SKINS[near].id; const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = SKINS[near].t.bg; }
    BGL.a = a; BGL.b = b; BGL.f = f; wake();
  }

  /* ---------- living backgrounds ---------- */
  const BGL = { a: 0, b: 0, f: 0, cv: [], cx: [], st: {}, W: 0, H: 0, dpr: 1, raf: 0, last: 0, t: 0 };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const sprite = (r, rgb, mid = .4) => { const c = mk(r * 2, r * 2), x = c.getContext('2d'), g = x.createRadialGradient(r, r, 0, r, r, r); g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(.3, `rgba(${rgb},${mid})`); g.addColorStop(1, `rgba(${rgb},0)`); x.fillStyle = g; x.fillRect(0, 0, r * 2, r * 2); return c; };
  const BG = {
    grove: {
      init(s, W, H) {
        const o = mk(W, H), x = o.getContext('2d'); const g = x.createLinearGradient(0, 0, W * .3, H); g.addColorStop(0, '#1b3a26'); g.addColorStop(.5, '#122a1b'); g.addColorStop(1, '#09170f'); x.fillStyle = g; x.fillRect(0, 0, W, H);
        s.off = o; s.sh = sprite(64, '3,12,6', .55); s.li = sprite(90, '255,226,140', .35); s.fl = sprite(10, '255,232,150', .5);
        s.shadows = Array.from({ length: 26 }, () => ({ x: rnd(-40, W + 40), y: rnd(-40, H + 40), rx: rnd(50, 120), ry: rnd(24, 60), rot: rnd(0, TAU), ph: rnd(0, TAU), amp: rnd(6, 16) }));
        s.lights = Array.from({ length: 10 }, () => ({ x: rnd(0, W), y: rnd(0, H * .8), r: rnd(40, 110), ph: rnd(0, TAU), sp: rnd(.2, .5) }));
        s.flies = Array.from({ length: 14 }, () => ({ x: rnd(0, W), y: rnd(H * .2, H * .9), p1: rnd(0, TAU), p2: rnd(0, TAU), sp: rnd(.15, .4), bl: rnd(.6, 1.4) }));
        s.leaves = []; s.next = 1.5;
      },
      draw(c, s, t, dt, W, H) {
        c.drawImage(s.off, 0, 0, W, H); c.globalCompositeOperation = 'lighter';
        for (const l of s.lights) { c.globalAlpha = .06 + .1 * (.5 + .5 * Math.sin(t * l.sp + l.ph)); c.drawImage(s.li, l.x - l.r + Math.sin(t * .35 + l.ph) * 10, l.y - l.r, l.r * 2, l.r * 2); }
        c.globalCompositeOperation = 'source-over';
        for (const q of s.shadows) { c.save(); c.globalAlpha = .55; c.translate(q.x + Math.sin(t * .45 + q.ph) * q.amp, q.y + Math.cos(t * .3 + q.ph) * q.amp * .4); c.rotate(q.rot + Math.sin(t * .2 + q.ph) * .08); c.drawImage(s.sh, -q.rx, -q.ry, q.rx * 2, q.ry * 2); c.restore(); }
        c.globalCompositeOperation = 'lighter';
        for (const f of s.flies) { const a = Math.pow(Math.max(0, Math.sin(t * f.bl + f.p1)), 3); if (a < .02) continue; c.globalAlpha = a; c.drawImage(s.fl, f.x + Math.sin(t * f.sp + f.p1) * 34 - 9, f.y + Math.cos(t * f.sp * .8 + f.p2) * 26 - 9, 18, 18); }
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
        if (t > s.next) { s.leaves.push({ x: rnd(-20, W * .7), y: -20, vx: rnd(18, 42), vy: rnd(36, 58), r: rnd(0, TAU), vr: rnd(-1.4, 1.4), sz: rnd(8, 13), ph: rnd(0, TAU) }); s.next = t + rnd(2.5, 5.5); }
        for (const l of s.leaves) {
          l.x += (l.vx + Math.sin(t * 1.6 + l.ph) * 30) * dt; l.y += l.vy * dt; l.r += l.vr * dt;
          c.save(); c.translate(l.x, l.y); c.rotate(l.r); c.scale(1, .55 + .45 * Math.abs(Math.sin(t * 1.3 + l.ph)));
          c.fillStyle = '#4f8a52'; c.beginPath(); c.moveTo(-l.sz, 0); c.quadraticCurveTo(0, -l.sz * .75, l.sz, 0); c.quadraticCurveTo(0, l.sz * .75, -l.sz, 0); c.fill(); c.restore();
        }
        s.leaves = s.leaves.filter(l => l.y < H + 30);
      }
    },
    paper: {
      init(s) { const g = mk(160, 160), x = g.getContext('2d'), d = x.createImageData(160, 160); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() < .5 ? 0 : 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = Math.random() * 14; } x.putImageData(d, 0, 0); s.grain = g; s.ticks = []; s.next = 1.5; },
      draw(c, s, t, dt, W, H) {
        c.fillStyle = '#f6f3ec'; c.fillRect(0, 0, W, H);
        for (let y = 0; y < H; y += 160) for (let x = 0; x < W; x += 160) c.drawImage(s.grain, x, y);
        c.fillStyle = '#1d1b17';
        for (let y = 22; y < H; y += 22) for (let x = 11; x < W; x += 22) { c.globalAlpha = .07 + .05 * Math.sin(t * .7 - (x + y) * .012); c.fillRect(x, y, 1.5, 1.5); }
        c.globalAlpha = 1;
        if (t > s.next) { s.ticks.push({ x: rnd(60, W - 60), y: rnd(H * .25, H * .6), b: t, sz: rnd(14, 22), blue: Math.random() < .3 }); s.next = t + rnd(3, 5); }
        c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 2.2;
        for (const k of s.ticks) {
          const age = t - k.b, p = Math.min(1, age / .32), a = age < 1.6 ? 1 : Math.max(0, 1 - (age - 1.6) / 2), L = k.sz * 2;
          c.setLineDash([L * p, L + 10]); c.strokeStyle = k.blue ? `rgba(47,111,222,${.45 * a})` : `rgba(217,70,43,${.5 * a})`;
          c.beginPath(); c.moveTo(k.x, k.y); c.lineTo(k.x + k.sz * .35, k.y + k.sz * .4); c.lineTo(k.x + k.sz, k.y - k.sz * .55); c.stroke();
        }
        c.setLineDash([]); s.ticks = s.ticks.filter(k => t - k.b < 4);
      }
    },
    tide: {
      init(s, W, H) {
        const o = mk(W, H), x = o.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0d5466'); g.addColorStop(.45, '#073746'); g.addColorStop(1, '#021219'); x.fillStyle = g; x.fillRect(0, 0, W, H);
        const rg = x.createRadialGradient(W * .5, -H * .05, 0, W * .5, -H * .05, H * .55); rg.addColorStop(0, 'rgba(255,214,150,.16)'); rg.addColorStop(1, 'rgba(255,214,150,0)'); x.fillStyle = rg; x.fillRect(0, 0, W, H);
        s.off = o; s.bub = Array.from({ length: 16 }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(1.2, 3.4), sp: rnd(14, 40), ph: rnd(0, TAU) }));
        s.rays = Array.from({ length: 6 }, (_, i) => ({ x: W * (i + .5) / 6 + rnd(-20, 20), w: rnd(14, 34), ph: rnd(0, TAU) }));
      },
      draw(c, s, t, dt, W, H) {
        c.drawImage(s.off, 0, 0, W, H); c.globalCompositeOperation = 'lighter';
        for (const r of s.rays) { const sk = W * .18 + Math.sin(t * .25 + r.ph) * 30, a = .035 + .03 * Math.sin(t * .4 + r.ph), g = c.createLinearGradient(0, 0, 0, H * .85); g.addColorStop(0, `rgba(190,240,245,${a})`); g.addColorStop(1, 'rgba(190,240,245,0)'); c.fillStyle = g; c.beginPath(); c.moveTo(r.x - r.w, 0); c.lineTo(r.x + r.w, 0); c.lineTo(r.x + sk + r.w * 3, H * .85); c.lineTo(r.x + sk - r.w * 3, H * .85); c.fill(); }
        c.lineWidth = 1.4;
        for (let fam = 0; fam < 2; fam++) for (let k = 0; k < 10; k++) {
          const y0 = H * .6 * k / 9 + 10; c.strokeStyle = `rgba(175,235,242,${.1 * (1 - k / 12)})`; c.beginPath();
          for (let x = -10; x <= W + 12; x += 12) { const y = y0 + Math.sin(x * (fam ? .021 : .017) + t * (fam ? .9 : -.7) + k * 1.7) * 9 + Math.sin(x * .043 - t * (fam ? .6 : 1.1) + k) * 5; x < 0 ? c.moveTo(x, y) : c.lineTo(x, y); }
          c.stroke();
        }
        c.globalCompositeOperation = 'source-over';
        for (const b of s.bub) { b.y -= b.sp * dt; if (b.y < -10) { b.y = H + 10; b.x = rnd(0, W); } const x = b.x + Math.sin(t * 2 + b.ph) * 3; c.strokeStyle = 'rgba(200,242,248,.35)'; c.lineWidth = 1; c.beginPath(); c.arc(x, b.y, b.r, 0, TAU); c.stroke(); }
      }
    },
    ember: {
      spawn(p, W, H, any) { p.x = rnd(W * .08, W * .92); p.y = any ? rnd(H * .2, H + 10) : H + rnd(0, 20); p.vy = -rnd(22, 66); p.vx = rnd(-8, 8); p.max = rnd(4, 9); p.life = any ? rnd(0, p.max) : p.max; p.sz = rnd(2, 5); p.hot = Math.random() < .35; p.ph = rnd(0, TAU); return p; },
      init(s, W, H) {
        const v = mk(W, H), x = v.getContext('2d'), g = x.createRadialGradient(W / 2, H * .45, H * .2, W / 2, H * .45, H * .78); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.7)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
        s.vig = v; s.sa = sprite(8, '255,140,60', .5); s.sb = sprite(8, '255,214,120', .6); s.sp = Array.from({ length: 60 }, () => this.spawn({}, W, H, true));
      },
      draw(c, s, t, dt, W, H) {
        c.fillStyle = '#140a06'; c.fillRect(0, 0, W, H);
        const pulse = .78 + .22 * Math.sin(t * .35) + .05 * Math.sin(t * 2.1);
        const g = c.createRadialGradient(W / 2, H * 1.1, 0, W / 2, H * 1.1, H * .85); g.addColorStop(0, `rgba(255,110,30,${.4 * pulse})`); g.addColorStop(.45, `rgba(180,50,10,${.15 * pulse})`); g.addColorStop(1, 'rgba(80,20,5,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
        c.globalCompositeOperation = 'lighter';
        for (const p of s.sp) { p.life -= dt; p.vx += Math.sin(t * 1.7 + p.y * .015 + p.ph) * 26 * dt; p.vx *= .99; p.x += p.vx * dt; p.y += p.vy * dt; if (p.life <= 0 || p.y < -10) this.spawn(p, W, H); const a = Math.min(1, p.life / p.max * 1.6) * (.6 + .4 * Math.sin(t * 9 + p.ph)); c.globalAlpha = Math.max(0, a); const z = p.sz * (.4 + .6 * p.life / p.max) * 2; c.drawImage(p.hot ? s.sb : s.sa, p.x - z, p.y - z, z * 2, z * 2); }
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.drawImage(s.vig, 0, 0, W, H);
      }
    },
    signal: {
      init(s, W, H) {
        const o = mk(W, H), x = o.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
        x.fillStyle = 'rgba(57,255,140,.08)'; for (let yy = 12; yy < H; yy += 24) for (let xx = 12; xx < W; xx += 24) x.fillRect(xx, yy, 1, 1);
        x.fillStyle = 'rgba(0,0,0,.22)'; for (let yy = 0; yy < H; yy += 3) x.fillRect(0, yy, W, 1);
        s.off = o; s.CH = '0123456789ABCDEF<>/#*:;=+';
        s.gl = Array.from({ length: 46 }, () => ({ x: Math.round(rnd(0, W) / 12) * 12, y: Math.round(rnd(0, H) / 18) * 18, ch: s.CH[(Math.random() * s.CH.length) | 0], ph: rnd(0, TAU), sp: rnd(.4, 1.6) }));
      },
      draw(c, s, t, dt, W, H) {
        c.drawImage(s.off, 0, 0, W, H);
        const scan = ((t / 7) % 1) * (H + 160) - 80;
        c.font = '11px "Sk Mono", ui-monospace, monospace';
        for (const g of s.gl) { const near = Math.max(0, 1 - Math.abs(g.y - scan) / 60); if (near > .9 && Math.random() < .2) g.ch = s.CH[(Math.random() * s.CH.length) | 0]; c.fillStyle = `rgba(57,255,140,${.05 + .14 * Math.pow(Math.max(0, Math.sin(t * g.sp + g.ph)), 10) + near * .45})`; c.fillText(g.ch, g.x, g.y); }
        const gr = c.createLinearGradient(0, scan - 120, 0, scan); gr.addColorStop(0, 'rgba(57,255,140,0)'); gr.addColorStop(1, 'rgba(57,255,140,.06)'); c.fillStyle = gr; c.fillRect(0, scan - 120, W, 120);
        c.fillStyle = 'rgba(57,255,140,.3)'; c.fillRect(0, scan, W, 1);
        const px = W * (.5 + .38 * Math.sin(t * .23)), py = H * (.42 + .25 * Math.sin(t * .17 + 1)), R = 130, sz = 17, hw = Math.sqrt(3) * sz, vh = 1.5 * sz;
        c.lineWidth = 1;
        for (let r = Math.floor((py - R) / vh); r <= Math.ceil((py + R) / vh); r++) {
          const off = (r & 1) ? hw / 2 : 0;
          for (let q = Math.floor((px - R - off) / hw); q <= Math.ceil((px + R - off) / hw); q++) {
            const cx = q * hw + off, cy = r * vh, d = Math.hypot(cx - px, cy - py); if (d > R) continue;
            c.strokeStyle = `rgba(57,255,140,${(1 - d / R) * .14})`; c.beginPath();
            for (let k = 0; k < 6; k++) { const an = Math.PI / 6 + k * Math.PI / 3, X = cx + Math.cos(an) * sz * .92, Y = cy + Math.sin(an) * sz * .92; k ? c.lineTo(X, Y) : c.moveTo(X, Y); }
            c.closePath(); c.stroke();
          }
        }
      }
    },
  };
  function size() {
    const d = BGL.cv[0] && BGL.cv[0].parentElement; if (!d) return;
    const r = d.getBoundingClientRect(); BGL.W = r.width; BGL.H = r.height; BGL.dpr = Math.min(devicePixelRatio || 1, 1.5);
    for (const c of BGL.cv) { c.width = BGL.W * BGL.dpr | 0; c.height = BGL.H * BGL.dpr | 0; }
    BGL.st = {};
  }
  function drawLayer(k, i, op, dt) {
    const c = BGL.cv[k], x = BGL.cx[k];
    c.style.opacity = op.toFixed(3);
    if (op < .002) return;
    const id = SKINS[i].id, R = BG[id]; if (!R) return;
    if (!BGL.st[id]) { BGL.st[id] = {}; R.init.call(R, BGL.st[id], BGL.W, BGL.H); }
    x.setTransform(BGL.dpr, 0, 0, BGL.dpr, 0, 0); R.draw.call(R, x, BGL.st[id], BGL.t, dt, BGL.W, BGL.H);
  }
  // ~30 fps while a skin background is on screen; nothing at all for Nebula or a hidden page.
  function frame(now) {
    BGL.raf = 0; if (document.hidden) return;
    const { a, b, f } = BGL;
    const needs = a !== 0 || f > .002;
    if (!needs) { BGL.cv.forEach(c => c.style.opacity = 0); return; }
    if (now - BGL.last >= 31) {
      const dt = Math.min(.1, (now - (BGL.last || now)) / 1000); BGL.last = now; BGL.t += dt;
      const opA = a === 0 ? 0 : (b === 0 ? 1 - f : 1), opB = (b === a || b === 0) ? 0 : f;
      drawLayer(0, a, opA, dt); drawLayer(1, b, opB, dt);
    }
    BGL.raf = requestAnimationFrame(frame);
  }
  function wake() { if (!BGL.raf && BGL.cv.length && !document.hidden) BGL.raf = requestAnimationFrame(frame); }

  function mount() {
    const device = document.getElementById('device'); if (!device || BGL.cv.length) return;
    const ref = device.querySelector('.lean') || device.firstChild;
    ['skinA', 'skinB'].forEach(id => { const c = document.createElement('canvas'); c.id = id; c.className = 'skin-bg'; c.setAttribute('aria-hidden', 'true'); device.insertBefore(c, ref); BGL.cv.push(c); BGL.cx.push(c.getContext('2d')); });
    size(); addEventListener('resize', () => { size(); wake(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { BGL.last = 0; wake(); } });
    paint(pos);
  }
  paint(pos); // tokens before first paint (no flash of the wrong skin)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  window.WosSkin = {
    list: SKINS.map(s => ({ id: s.id, name: s.name, who: s.who })),
    get current() { return SKINS[Math.round(pos)].id; },
    get pos() { return pos; },
    get chosen() { return stored(); },
    index: idxOf,
    preview(p) { paint(p); },
    set(id) { const i = idxOf(id); paint(i); try { localStorage.setItem(KEY, SKINS[i].id); } catch (e) {} return SKINS[i].id; },
    commit(i) { return this.set(SKINS[Math.max(0, Math.min(N - 1, Math.round(i)))].id); },
    _bg: BGL,
  };
})();
