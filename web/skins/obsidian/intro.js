// Skin-switch transition for Miguel's skins (Dark, Light, Landscapes). Plays once when someone picks one of them.
// The screen they were on slides down and away as one soft-edged sheet. It smears and blurs as it goes, and a fainter
// trailing copy follows it. Dark and Light come into focus underneath out of a blur. Landscapes shows the real
// wallpaper frosted and sharpens it band by band from the sky down to the water. MIZEL is a small corner signature.
// ~2.3 s. Plays in full for everyone: no skip, no reduced-motion variant (Miguel's call). Only transform, opacity and
// filter are animated (Web Animations; no timers or raw listeners), so it stays inside the skin-package lint.

const LOOK = {
  obsidian: { name: 'Dark', fill: '#000000', ink: '#ffffff' },
  'obsidian-light': { name: 'Light', fill: '#ffffff', ink: '#0b0b0f' },
  landscapes: { name: 'Landscapes', fill: 'linear-gradient(180deg,#1b2747 0%,#3c4670 40%,#7d6478 70%,#1e2a40 100%)', ink: '#ffffff' },
};
// Dark, Light and Landscapes import this one module (same URL), so it remembers which of them was worn last.
let wearing = null;
export function noteSkin(id) { wearing = id || (typeof document !== 'undefined' && document.documentElement.dataset.skin) || null; }

const CSS = `
.mz-intro{position:fixed;inset:0;z-index:2147483000;overflow:hidden;pointer-events:auto;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}
.mz-old{position:absolute;left:-4%;right:-4%;top:0;height:170vh;will-change:transform,filter,opacity;
  -webkit-mask:linear-gradient(180deg,transparent 0,#000 36%);mask:linear-gradient(180deg,transparent 0,#000 36%)}
.mz-frost{position:absolute;left:0;right:0;will-change:opacity;
  -webkit-backdrop-filter:blur(22px) saturate(1.35) brightness(.9);backdrop-filter:blur(22px) saturate(1.35) brightness(.9);
  -webkit-mask:linear-gradient(180deg,transparent 0,#000 18%,#000 82%,transparent 100%);mask:linear-gradient(180deg,transparent 0,#000 18%,#000 82%,transparent 100%)}
.mz-sig{position:absolute;right:calc(env(safe-area-inset-right) + 20px);bottom:calc(var(--pill-top, 82px) + 14px);opacity:0;
  font:600 10px/1 'WOS Sora',var(--font-display,ui-sans-serif),system-ui,sans-serif;letter-spacing:.38em;color:var(--mz-ink);
  text-shadow:0 1px 6px rgba(0,0,0,.25)}
`;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };

// After a skin is picked, Settings (or anything stacked on it) closes under the transition, so the owner lands on Home.
export function toHome(api) {
  const open = () => [...document.querySelectorAll('[data-settings-root], #settings, .st-root')].some(n => !n.hidden && n.getClientRects().length);
  for (let i = 0; i < 6 && open(); i++) if (!api.nav.back()) break;
  if (api.env.shell !== 'desktop' && api.nav.deskCount() > 0) api.nav.goDesk(0);
}

export function playIntro({ id, listen } = {}) {
  if (typeof document === 'undefined' || !document.body) return { stop() {}, done: Promise.resolve() };
  const to = id || document.documentElement.dataset.skin || 'obsidian';
  const N = LOOK[to] || LOOK.obsidian;
  // The old screen: the skin worn before, or (coming from a skin outside this family) a neutral that still contrasts.
  const fromId = wearing && wearing !== to && LOOK[wearing] ? wearing : null;
  const O = fromId ? LOOK[fromId] : { fill: to === 'obsidian' ? '#d9d9de' : '#121118' };
  wearing = to;

  let style = document.getElementById('mz-intro-style');
  if (!style) { style = el('style'); style.id = 'mz-intro-style'; style.textContent = CSS; document.head.appendChild(style); }
  document.querySelectorAll('.mz-intro').forEach(n => n.remove());

  const land = to === 'landscapes';
  const root = el('div', 'mz-intro'); root.setAttribute('role', 'img'); root.setAttribute('aria-label', `Switching to ${N.name}`);
  root.style.setProperty('--mz-ink', N.ink);
  // Landscapes: frosted bands over the real wallpaper, cleared from the sky down.
  const bands = [];
  if (land) {
    const B = 5;
    for (let i = 0; i < B; i++) { const f = el('div', 'mz-frost'); f.style.top = `${(i * 100 / B - 6).toFixed(2)}%`; f.style.height = `${(100 / B + 12).toFixed(2)}%`; root.appendChild(f); bands.push(f); }
  }
  const ghost = el('div', 'mz-old'), old = el('div', 'mz-old'), sig = el('div', 'mz-sig', 'MIZEL');
  ghost.style.background = O.fill; old.style.background = O.fill;
  root.append(ghost, old, sig);
  document.body.appendChild(root);

  const anims = [], fill = 'both';
  const run = (node, frames, opts) => { const a = node.animate(frames, { fill, ...opts }); anims.push(a); return a; };
  let finished = false, resolveDone;
  const done = new Promise(r => { resolveDone = r; });

  // 1. The old screen slides down and away as one soft-edged sheet. It stretches and blurs, like wet paint running off glass.
  const dur = land ? 1050 : 1250;
  const sheet = [
    { transform: 'translateY(-61.2vh) scaleY(1)', filter: 'blur(0px)', transformOrigin: '50% 0' },
    { transform: 'translateY(-30vh) scaleY(1.06)', filter: 'blur(2px)', transformOrigin: '50% 0', offset: .35 },
    { transform: 'translateY(104vh) scaleY(1.22)', filter: 'blur(9px)', transformOrigin: '50% 0' },
  ];
  const a1 = run(old, sheet, { delay: 0, duration: dur, easing: 'cubic-bezier(.42,0,.22,1)' });
  const a2 = run(ghost, sheet.map((k, i) => ({ ...k, opacity: i === 2 ? 0 : .45, filter: `blur(${[6, 10, 18][i]}px)` })), { delay: 110, duration: dur + 120, easing: 'cubic-bezier(.42,0,.22,1)' });
  try { navigator.vibrate?.(8); } catch (_) {}

  // 2. The new skin comes into focus underneath.
  const dev = document.getElementById('device') || document.body;
  let last;
  if (land) {
    // the wallpaper sharpens band by band, sky first, then the mountains, then the water
    bands.forEach((b, i) => run(b, [{ opacity: 1 }, { opacity: 0 }], { delay: 520 + i * 190, duration: 640, easing: 'cubic-bezier(.4,0,.2,1)' }));
    if (!document.documentElement.classList.contains('wos-doc-scroll')) dev.animate([{ scale: '1.035' }, { scale: '1' }], { delay: 60, duration: 1900, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'backwards' });
    last = anims[anims.length - 1];
  } else {
    if (!document.documentElement.classList.contains('wos-doc-scroll')) dev.animate([{ filter: `blur(14px) brightness(${to === 'obsidian' ? 1.35 : .85})`, scale: '1.035' }, { filter: 'blur(0) brightness(1)', scale: '1' }], { delay: 140, duration: 1450, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'backwards' });
    last = run(sig, [{ opacity: 0 }, { opacity: 0 }], { duration: 1700 });
  }
  // 3. Signature, small and late.
  run(sig, [{ opacity: 0, letterSpacing: '.7em' }, { opacity: .7, letterSpacing: '.38em', offset: .35 }, { opacity: .7, offset: .75 }, { opacity: 0 }], { delay: 650, duration: 1600, easing: 'ease-out', composite: 'replace' });

  const cleanup = () => { if (finished) return; finished = true; anims.forEach(a => { try { a.cancel(); } catch (_) {} }); root.remove(); if (!document.querySelector('.mz-intro')) style.remove(); resolveDone(); };
  Promise.all([a1.finished, a2.finished, last.finished])
    .then(() => run(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out' }).finished)
    .then(cleanup, cleanup);
  // No skip: taps on the overlay are swallowed so the transition always plays through.
  if (typeof listen === 'function') for (const type of ['pointerdown', 'touchstart', 'click']) listen(root, type, e => { e.stopPropagation(); }, { passive: true });
  return { stop: cleanup, done };
}
