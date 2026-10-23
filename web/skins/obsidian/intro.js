// Skin-switch transition for Miguel's skins (Dark, Light, Landscapes). Plays once when someone picks one of them:
// the screen they were on melts away in drips, and the new skin arrives underneath. Dark and Light come into focus
// out of a soft blur; Landscapes builds a landscape piece by piece (sky, sun, far ridge, nearer ridges, water) and then
// dissolves into the real wallpaper. MIZEL is only a small signature in the bottom-right corner.
// About as quick as the old brand intro (~2.5 s). Plays in full for everyone: no skip, no reduced-motion variant
// (Miguel's call). Web Animations only (no timers or raw listeners), so it stays inside the skin-package lint.

// How each skin looks as the "old screen" that melts away.
const LOOK = {
  obsidian: { name: 'Dark', fill: '#000000', ink: '#ffffff', rim: 'rgba(255,255,255,.34)' },
  'obsidian-light': { name: 'Light', fill: '#ffffff', ink: '#0b0b0f', rim: 'rgba(0,0,0,.22)' },
  landscapes: { name: 'Landscapes', fill: 'linear-gradient(180deg,#1b2747 0%,#4a4f7c 38%,#c47a63 68%,#2c3d58 100%)', ink: '#ffffff', rim: 'rgba(255,255,255,.4)' },
};
// Dark, Light and Landscapes import this one module (same URL), so it remembers which of them was worn last.
let wearing = null;
export function noteSkin(id) { wearing = id || (typeof document !== 'undefined' && document.documentElement.dataset.skin) || null; }

const CSS = `
.mz-intro{position:fixed;inset:0;z-index:2147483000;overflow:hidden;pointer-events:auto;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}
.mz-scene,.mz-melt{position:absolute;inset:0}
.mz-scene>div{position:absolute;left:0;right:0;will-change:transform,opacity}
.mz-sky{top:0;bottom:0;background:linear-gradient(180deg,#0d1730 0%,#2e3f72 34%,#8a6b8f 56%,#e6956a 70%,#f7c98e 78%)}
.mz-scene>.mz-sun{left:50%;right:auto;top:47%;width:min(30vw,160px);height:min(30vw,160px);margin-left:calc(min(30vw,160px) / -2);border-radius:50%;
  background:radial-gradient(circle,#fff6de 0 46%,rgba(255,226,170,.55) 62%,rgba(255,200,140,0) 72%)}
.mz-far{top:0;bottom:0;background:linear-gradient(180deg,#8094c0,#5d6f9e);clip-path:polygon(0 62%,8% 56%,18% 60%,30% 47%,40% 55%,52% 43%,62% 53%,72% 47%,84% 55%,100% 50%,100% 100%,0 100%)}
.mz-mid{top:0;bottom:0;background:linear-gradient(180deg,#46557f,#2d3a60);clip-path:polygon(0 69%,10% 62%,22% 67%,34% 57%,46% 66%,58% 60%,70% 67%,82% 60%,92% 66%,100% 63%,100% 100%,0 100%)}
.mz-near{top:0;bottom:0;background:linear-gradient(180deg,#26324f,#141c33);clip-path:polygon(0 75%,15% 71%,30% 74%,45% 70%,60% 73%,75% 69%,90% 73%,100% 71%,100% 100%,0 100%)}
.mz-water{top:77%;bottom:0;background:linear-gradient(180deg,#e3a57a 0%,#6c6f8e 14%,#24456a 46%,#0c1a30 100%)}
.mz-water i{position:absolute;height:2px;border-radius:2px;background:rgba(255,236,205,.7)}
.mz-col{position:absolute;top:-2px;height:calc(100% + 4px);will-change:transform;border-radius:50% 50% 0 0 / 18px 18px 0 0;
  -webkit-mask:linear-gradient(180deg,transparent 0,#000 16px);mask:linear-gradient(180deg,transparent 0,#000 16px)}
.mz-col b{position:absolute;top:100%;margin-top:-1px;border-radius:0 0 999px 999px;background:inherit}
.mz-sig{position:absolute;right:calc(env(safe-area-inset-right) + 20px);bottom:calc(var(--pill-top, 82px) + 14px);opacity:0;
  font:600 10px/1 'WOS Sora',var(--font-display,ui-sans-serif),system-ui,sans-serif;letter-spacing:.38em;color:var(--mz-ink);
  text-shadow:0 1px 6px rgba(0,0,0,.25)}
`;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
const rnd = (a, b) => a + Math.random() * (b - a);

export function playIntro({ id, listen } = {}) {
  if (typeof document === 'undefined' || !document.body) return { stop() {}, done: Promise.resolve() };
  const to = id || document.documentElement.dataset.skin || 'obsidian';
  const N = LOOK[to] || LOOK.obsidian;
  // The old screen: the skin worn before, or (coming from a skin outside this family) a neutral that still contrasts.
  const fromId = wearing && wearing !== to && LOOK[wearing] ? wearing : null;
  const O = fromId ? LOOK[fromId] : { fill: to === 'obsidian' ? '#d9d9de' : '#121118', rim: to === 'obsidian' ? 'rgba(0,0,0,.2)' : 'rgba(255,255,255,.3)' };
  wearing = to;

  let style = document.getElementById('mz-intro-style');
  if (!style) { style = el('style'); style.id = 'mz-intro-style'; style.textContent = CSS; document.head.appendChild(style); }
  document.querySelectorAll('.mz-intro').forEach(n => n.remove());

  const root = el('div', 'mz-intro'); root.setAttribute('role', 'img'); root.setAttribute('aria-label', `Switching to ${N.name}`);
  root.style.setProperty('--mz-ink', N.ink); root.style.setProperty('--mz-rim', O.rim);
  const land = to === 'landscapes';
  const scene = el('div', 'mz-scene'), melt = el('div', 'mz-melt'), sig = el('div', 'mz-sig', 'MIZEL');
  const parts = {};
  if (land) {
    for (const k of ['sky', 'sun', 'far', 'mid', 'near', 'water']) scene.appendChild(parts[k] = el('div', 'mz-' + k));
    for (let i = 0; i < 7; i++) { const s = el('i'); s.style.left = rnd(8, 70) + '%'; s.style.top = (8 + i * 12 + rnd(-3, 3)) + '%'; s.style.width = rnd(8, 26) + '%'; parts.water.appendChild(s); }
  }
  // The old screen, cut into columns that drip and slide off the bottom one after another.
  const VW = window.innerWidth || 390, n = Math.max(12, Math.min(48, Math.round((window.innerWidth || 390) / 26))), cols = [];
  for (let i = 0; i < n; i++) {
    const c = el('div', 'mz-col'), x0 = Math.floor(i * VW / n), x1 = Math.ceil((i + 1) * VW / n);
    c.style.left = (x0 - 1) + 'px'; c.style.width = (x1 - x0 + 2) + 'px'; c.style.background = O.fill;
    const d = el('b'), w = rnd(38, 74); d.style.width = w + '%'; d.style.left = rnd(0, 100 - w) + '%'; d.style.height = `${rnd(3, 14).toFixed(1)}vh`; c.appendChild(d);
    melt.appendChild(c); cols.push(c);
  }
  root.append(scene, melt, sig);
  document.body.appendChild(root);

  const anims = [], fill = 'both';
  const run = (node, frames, opts) => { const a = node.animate(frames, { fill, ...opts }); anims.push(a); return a; };
  let finished = false, resolveDone;
  const done = new Promise(r => { resolveDone = r; });

  // 1. Melt: each column sags, stretches and falls away like warm wax, with a little sideways wobble.
  const order = cols.map((_, i) => i).sort(() => Math.random() - .5), drips = [];
  order.forEach((ci, k) => {
    const delay = 40 + k * ((land ? 300 : 520) / n) + rnd(0, land ? 80 : 120), dur = land ? rnd(650, 820) : rnd(900, 1150), sway = rnd(-5, 5);
    drips.push(run(cols[ci], [
      { transform: 'translate(0,0) scaleY(1)', transformOrigin: '50% 0' },
      { transform: `translate(${(sway * .3).toFixed(1)}px,14vh) scaleY(1.08)`, transformOrigin: '50% 0', offset: .3 },
      { transform: `translate(${sway.toFixed(1)}px,120vh) scaleY(1.25)`, transformOrigin: '50% 0' },
    ], { delay, duration: dur, easing: 'cubic-bezier(.45,.05,.75,.5)' }));
  });
  try { navigator.vibrate?.([10, 240, 8]); } catch (_) {}

  // 2. The new skin arrives under the melt.
  const dev = document.getElementById('device') || document.body;
  let last;
  if (land) {
    const rise = (node, delay, from) => run(node, [{ transform: `translateY(${from})`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1, offset: .55 }, { transform: 'translateY(0)', opacity: 1 }], { delay, duration: 900, easing: 'cubic-bezier(.2,.9,.25,1)' });
    run(parts.sky, [{ opacity: .7, filter: 'brightness(.45)' }, { opacity: 1, filter: 'brightness(1)' }], { duration: 1100, easing: 'ease-out' });
    run(parts.sun, [{ transform: 'translateY(26vh) scale(.8)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], { delay: 380, duration: 1300, easing: 'cubic-bezier(.2,.8,.3,1)' });
    rise(parts.far, 650, '34%');
    rise(parts.mid, 900, '42%');
    rise(parts.near, 1120, '50%');
    run(parts.water, [{ transform: 'translateY(30%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { delay: 1350, duration: 700, easing: 'cubic-bezier(.2,.9,.25,1)' });
    [...parts.water.children].forEach((s, i) => run(s, [{ transform: 'translateX(-14px) scaleX(.4)', opacity: 0 }, { transform: 'translateX(0) scaleX(1)', opacity: .8, offset: .4 }, { transform: 'translateX(12px) scaleX(.7)', opacity: .35 }], { delay: 1500 + i * 50, duration: 900, easing: 'ease-out' }));
    // the drawn landscape dissolves into the real wallpaper
    last = run(scene, [{ opacity: 1, filter: 'blur(0)', transform: 'scale(1)' }, { opacity: 0, filter: 'blur(10px)', transform: 'scale(1.06)' }], { delay: 1980, duration: 520, easing: 'cubic-bezier(.5,0,.6,1)' });
    dev.animate([{ filter: 'blur(10px) saturate(1.3)', scale: '1.04' }, { filter: 'blur(0) saturate(1)', scale: '1' }], { delay: 1980, duration: 600, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'backwards' });
  } else {
    // Dark / Light: the new screen comes into focus out of a soft blur while the old one drips away.
    dev.animate([{ filter: `blur(16px) brightness(${to === 'obsidian' ? 1.6 : .75})`, scale: '1.06' }, { filter: 'blur(0) brightness(1)', scale: '1' }], { delay: 120, duration: 1500, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'backwards' });
    last = run(scene, [{ opacity: 1 }, { opacity: 1 }], { duration: 2000 });
  }
  // 3. Signature, small and late.
  run(sig, [{ opacity: 0, letterSpacing: '.8em' }, { opacity: .72, letterSpacing: '.38em', offset: .35 }, { opacity: .72, offset: .75 }, { opacity: 0 }], { delay: 900, duration: 1700, easing: 'ease-out' });

  const cleanup = () => { if (finished) return; finished = true; anims.forEach(a => { try { a.cancel(); } catch (_) {} }); root.remove(); if (!document.querySelector('.mz-intro')) style.remove(); resolveDone(); };
  Promise.all([last.finished, ...drips.map(a => a.finished)])
    .then(() => run(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out' }).finished)
    .then(cleanup, cleanup);
  // No skip: taps on the overlay are swallowed so the transition always plays through.
  if (typeof listen === 'function') for (const type of ['pointerdown', 'touchstart', 'click']) listen(root, type, e => { e.stopPropagation(); }, { passive: true });
  return { stop: cleanup, done };
}
