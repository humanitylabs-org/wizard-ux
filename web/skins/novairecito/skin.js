// Novairecito (Noir) loading screen: a violet plasma orb that grows outward into space, then the shell opens.
// Plays on every cold open of the phone or desktop app while Noir is the chosen skin, and when Noir is picked.
// Tap to skip. Skin API only: no timers or raw listeners (web/skins/README.md).
const VIDEO = {
  portrait: new URL('./orb-portrait.mp4', import.meta.url).href,
  landscape: new URL('./orb-landscape.mp4', import.meta.url).href,
};
const POSTER = {
  portrait: new URL('./orb-portrait.jpg', import.meta.url).href,
  landscape: new URL('./orb-landscape.jpg', import.meta.url).href,
};
const SAFETY_MS = 6500;   // never hold the shell longer than this, even if the video cannot play

const CSS = `
.nv-boot{position:fixed;inset:0;z-index:2147483000;background:#020007;overflow:hidden;cursor:pointer;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}
.nv-boot video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#020007}
.nv-boot-mark{position:absolute;left:0;right:0;bottom:max(7vh,calc(env(safe-area-inset-bottom) + 34px));text-align:center;opacity:0;
  font:600 clamp(13px,1.5vw,16px)/1 'WOS Sora',var(--font-display,ui-sans-serif),system-ui,sans-serif;letter-spacing:.42em;padding-left:.42em;
  color:#f4f0ff;text-shadow:0 0 18px rgba(148,108,255,.9),0 0 42px rgba(148,108,255,.45)}
.nv-boot-mark b{font-weight:600;color:#a98bff}
`;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };

function playBoot(api) {
  if (typeof document === 'undefined' || !document.body) return { stop() {} };
  let style = document.getElementById('nv-boot-style');
  if (!style) { style = el('style'); style.id = 'nv-boot-style'; style.textContent = CSS; document.head.appendChild(style); }
  document.querySelectorAll('.nv-boot').forEach(n => n.remove());

  const shape = window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
  const root = el('div', 'nv-boot'); root.setAttribute('role', 'img'); root.setAttribute('aria-label', 'Novairecito is waking up');
  const video = el('video');
  video.muted = true; video.defaultMuted = true; video.playsInline = true; video.autoplay = true; video.preload = 'auto';
  video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.setAttribute('aria-hidden', 'true');
  video.poster = POSTER[shape]; video.src = VIDEO[shape];
  const mark = el('div', 'nv-boot-mark'); mark.append('NOVAIRECITO ', el('b', '', 'OS'));
  root.append(video, mark);
  document.body.appendChild(root);

  const anims = [];
  const run = (node, frames, opts) => { const a = node.animate(frames, { fill: 'both', ...opts }); anims.push(a); return a; };
  let finished = false, leaving = false;
  const cleanup = () => { if (finished) return; finished = true; anims.forEach(a => { try { a.cancel(); } catch (_) {} }); try { video.pause(); } catch (_) {} root.remove(); if (!document.querySelector('.nv-boot')) style.remove(); };
  const exit = () => {
    if (leaving || finished) return; leaving = true;
    // The orb swallows the screen, then the shell surfaces from the violet light.
    run(video, [{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.35)', filter: 'brightness(1.8) blur(6px)' }], { duration: 520, easing: 'cubic-bezier(.6,0,.9,.4)' });
    const out = run(root, [{ opacity: 1 }, { opacity: 0 }], { delay: 200, duration: 480, easing: 'ease-in' });
    const dev = document.getElementById('device') || document.body;
    try { dev.animate([{ filter: 'brightness(1.4) saturate(1.2)', transform: 'scale(1.03)' }, { filter: 'none', transform: 'none' }], { delay: 260, duration: 620, easing: 'cubic-bezier(.2,.9,.25,1)' }); } catch (_) {}
    out.finished.then(cleanup, cleanup);
  };

  run(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  run(mark, [{ opacity: 0, letterSpacing: '1.1em' }, { opacity: 1, letterSpacing: '.42em' }], { delay: 900, duration: 900, easing: 'cubic-bezier(.2,.9,.25,1)' });
  const safety = run(root, [{ opacity: 1 }, { opacity: 1 }], { duration: SAFETY_MS, fill: 'none' });
  safety.finished.then(exit, () => {});
  api.listen(video, 'ended', exit);
  api.listen(video, 'error', exit);
  for (const type of ['pointerdown', 'click']) api.listen(root, type, e => { e.stopPropagation(); exit(); });
  const p = video.play && video.play(); if (p && p.catch) p.catch(() => {});   // muted autoplay; the poster and safety still cover a refusal
  return { stop: cleanup };
}

export default function setup(api) {
  const boot = playBoot(api);
  return () => { boot.stop(); };
}
