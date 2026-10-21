// MIZEL brand intro for Miguel's skins (Dark, Light, Landscapes). Plays once when someone picks one of them:
// a warp-in, the five letters slam down, the screen shakes on impact, a shockwave rings out, then the overlay
// irises closed onto the new skin. Same choreography for all three; only the palette follows the skin.
// Plays in full for everyone: no skip, no reduced-motion variant (Miguel's call).
// Web Animations only (no timers or raw listeners), so it stays inside the skin-package lint.

const PALETTE = {
  obsidian: { name: 'Dark', bg: '#000', ink: '#ffffff', soft: 'rgba(255,255,255,.58)', glow: 'rgba(255,255,255,.85)', sheen: '#9aa0b4', flash: '#ffffff' },
  'obsidian-light': { name: 'Light', bg: '#fbfbf8', ink: '#0b0b0f', soft: 'rgba(11,11,15,.56)', glow: 'rgba(11,11,15,.32)', sheen: '#8a8a99', flash: '#000000' },
  landscapes: { name: 'Landscapes', bg: 'radial-gradient(130% 95% at 50% 115%, #ff9a3c 0%, #b4436a 24%, #3a2560 46%, #0f1430 70%, #04050b 100%)', ink: '#fff6ea', soft: 'rgba(255,246,234,.66)', glow: 'rgba(255,168,92,.9)', sheen: '#ffc477', flash: '#ffe0b8' },
};

const CSS = `
.mz-intro{position:fixed;inset:0;z-index:2147483000;overflow:hidden;background:var(--mz-bg);color:var(--mz-ink);
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none;
  font-family:'WOS Sora',var(--font-display,ui-sans-serif),system-ui,-apple-system,"Segoe UI",sans-serif}
.mz-stage{position:absolute;inset:-28px;display:grid;place-items:center}
.mz-flash{position:absolute;inset:0;background:var(--mz-flash);opacity:0;pointer-events:none}
.mz-warp,.mz-burst{position:absolute;left:50%;top:50%;width:220vmax;height:220vmax;margin:-110vmax 0 0 -110vmax;opacity:0;pointer-events:none;
  background:repeating-conic-gradient(from 0deg,transparent 0 3.6deg,var(--mz-soft) 3.6deg 4deg);
  -webkit-mask:radial-gradient(circle,transparent 9%,#000 34%,transparent 62%);mask:radial-gradient(circle,transparent 9%,#000 34%,transparent 62%)}
.mz-ring{position:absolute;left:50%;top:50%;width:52vmin;height:52vmin;margin:-26vmin 0 0 -26vmin;border-radius:50%;opacity:0;pointer-events:none;
  border:2px solid var(--mz-glow);box-shadow:0 0 42px var(--mz-glow),inset 0 0 28px var(--mz-glow)}
.mz-core{position:relative;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center}
.mz-eyebrow{font-size:11px;font-weight:600;line-height:1;letter-spacing:.42em;padding-left:.42em;text-transform:uppercase;color:var(--mz-soft);opacity:0;white-space:nowrap}
.mz-word{display:flex;gap:.03em;font-size:clamp(68px,23vw,176px);font-weight:800;line-height:.88;letter-spacing:-.01em}
.mz-word span{display:inline-block;opacity:0;color:transparent;-webkit-background-clip:text;background-clip:text;background-size:320% 100%;background-position:100% 0;
  background-image:linear-gradient(100deg,var(--mz-ink) 0 42%,var(--mz-sheen) 50%,var(--mz-ink) 58% 100%)}
.mz-rule{width:min(58vw,340px);height:2px;background:linear-gradient(90deg,transparent,var(--mz-ink),transparent);transform:scaleX(0)}
.mz-skin{font-size:12px;font-weight:600;line-height:1;letter-spacing:.34em;padding-left:.34em;text-transform:uppercase;color:var(--mz-soft);opacity:0}
`;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };

export function playIntro({ id, listen } = {}) {
  if (typeof document === 'undefined' || !document.body) return { stop() {}, done: Promise.resolve() };
  const skin = id || document.documentElement.dataset.skin || 'obsidian';
  const P = PALETTE[skin] || PALETTE.obsidian;

  let style = document.getElementById('mz-intro-style');
  if (!style) { style = el('style'); style.id = 'mz-intro-style'; style.textContent = CSS; document.head.appendChild(style); }
  document.querySelectorAll('.mz-intro').forEach(n => n.remove());

  const root = el('div', 'mz-intro'); root.setAttribute('role', 'img'); root.setAttribute('aria-label', 'Experience produced by MIZEL');
  for (const [k, v] of Object.entries({ bg: P.bg, ink: P.ink, soft: P.soft, glow: P.glow, sheen: P.sheen, flash: P.flash })) root.style.setProperty(`--mz-${k}`, v);
  const stage = el('div', 'mz-stage'), warp = el('div', 'mz-warp'), burst = el('div', 'mz-burst'), r1 = el('div', 'mz-ring'), r2 = el('div', 'mz-ring');
  const core = el('div', 'mz-core'), eyebrow = el('div', 'mz-eyebrow', 'Experience produced by'), word = el('div', 'mz-word');
  const letters = [...'MIZEL'].map(c => el('span', '', c)); letters.forEach(s => word.appendChild(s));
  const rule = el('div', 'mz-rule'), name = el('div', 'mz-skin', P.name), flash = el('div', 'mz-flash');
  core.append(eyebrow, word, rule, name); stage.append(warp, burst, r1, r2, core); root.append(stage, flash);
  document.body.appendChild(root);

  const anims = [], fill = 'both';
  const run = (node, frames, opts) => { const a = node.animate(frames, { fill, ...opts }); anims.push(a); return a; };
  const glow = `drop-shadow(0 0 18px ${P.glow})`;
  let hold, finished = false, resolveDone;
  const done = new Promise(r => { resolveDone = r; });

  {
    const IMPACT = 780, HOLD = IMPACT + 1350;
    run(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    // warp in: rays rush toward the centre
    run(warp, [{ opacity: 0, transform: 'scale(2.6) rotate(-10deg)' }, { opacity: .6, offset: .45 }, { opacity: 0, transform: 'scale(.5) rotate(22deg)' }], { duration: IMPACT + 60, easing: 'cubic-bezier(.5,0,.9,.4)' });
    // the five letters slam down one after another
    letters.forEach((s, i) => run(s, [
      { opacity: 0, transform: 'scale(3.4) translateY(-10%)', filter: 'blur(18px)' },
      { opacity: 1, transform: 'scale(.9) translateY(0)', filter: `blur(0) ${glow}`, offset: .78 },
      { opacity: 1, transform: 'scale(1)', filter: `blur(0) ${glow}` },
    ], { delay: 180 + i * 70, duration: 320, easing: 'cubic-bezier(.6,0,.8,.35)' }));
    // impact: flash, shockwave rings, rays burst out, the whole screen shakes, the phone thumps
    run(flash, [{ opacity: 0 }, { opacity: .92, offset: .12 }, { opacity: 0 }], { delay: IMPACT, duration: 380, easing: 'ease-out' });
    run(r1, [{ opacity: 1, transform: 'scale(.15)' }, { opacity: 0, transform: 'scale(3.4)' }], { delay: IMPACT, duration: 900, easing: 'cubic-bezier(.1,.8,.3,1)' });
    run(r2, [{ opacity: .8, transform: 'scale(.1)' }, { opacity: 0, transform: 'scale(4.6)' }], { delay: IMPACT + 130, duration: 1150, easing: 'cubic-bezier(.1,.8,.3,1)' });
    run(burst, [{ opacity: .75, transform: 'scale(.55)' }, { opacity: 0, transform: 'scale(2.8) rotate(-14deg)' }], { delay: IMPACT, duration: 700, easing: 'cubic-bezier(.1,.7,.3,1)' });
    const sh = [[0, 0, 0], [-18, 9, -1.2], [16, -12, 1], [-13, -7, -.8], [11, 10, .7], [-8, 6, -.5], [7, -5, .4], [-4, 3, -.2], [3, -2, .1], [0, 0, 0]];
    run(stage, sh.map(([x, y, r]) => ({ transform: `translate(${x}px,${y}px) rotate(${r}deg)` })), { delay: IMPACT, duration: 620, easing: 'linear', fill: 'none' });
    run(eyebrow, [{ opacity: 0, letterSpacing: '1.3em' }, { opacity: 1, letterSpacing: '.42em' }], { delay: IMPACT + 60, duration: 620, easing: 'cubic-bezier(.2,.9,.25,1)' });
    run(rule, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { delay: IMPACT + 200, duration: 560, easing: 'cubic-bezier(.2,.9,.25,1)' });
    run(name, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { delay: IMPACT + 340, duration: 520, easing: 'ease-out' });
    letters.forEach((s, i) => run(s, [{ backgroundPosition: '100% 0' }, { backgroundPosition: '0% 0' }], { delay: IMPACT + 320 + i * 45, duration: 900, easing: 'ease-in-out' }));
    try { navigator.vibrate?.([14, IMPACT - 14, 80, 40, 36]); } catch (_) {}
    hold = run(root, [{ opacity: 1 }, { opacity: 1 }], { duration: HOLD });
  }

  const cleanup = () => { if (finished) return; finished = true; anims.forEach(a => { try { a.cancel(); } catch (_) {} }); root.remove(); if (!document.querySelector('.mz-intro')) style.remove(); resolveDone(); };
  let leaving = false;
  const exit = () => {
    if (leaving || finished) return; leaving = true;
    anims.forEach(a => { try { if (a !== hold) a.finish(); } catch (_) {} });
    const out = (run(core, [{ transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }, { transform: 'scale(2.7)', opacity: 0, filter: 'blur(10px)' }], { duration: 420, easing: 'cubic-bezier(.6,0,.9,.4)' }),
         run(root, [{ clipPath: 'circle(150% at 50% 50%)' }, { clipPath: 'circle(0% at 50% 50%)' }], { duration: 580, easing: 'cubic-bezier(.7,0,.84,0)' }));
    { const dev = document.getElementById('device'); if (dev) dev.animate([{ scale: '1.05', filter: 'brightness(1.35)' }, { scale: '1', filter: 'brightness(1)' }], { delay: 380, duration: 560, easing: 'cubic-bezier(.2,.9,.25,1)' }); }
    out.finished.then(cleanup, cleanup);
  };
  hold.finished.then(exit, () => {});
  // No skip: taps on the overlay are swallowed so the intro always plays through.
  if (typeof listen === 'function') for (const type of ['pointerdown', 'touchstart', 'click']) listen(root, type, e => { e.stopPropagation(); }, { passive: true });
  return { stop: cleanup, done };
}
