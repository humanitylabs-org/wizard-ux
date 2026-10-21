/* Appearance v1 receiver for the Store (wizard-os spec/APPEARANCE.md). Hosted: the shell sends a skin context only after
 * we ask (wizard:appearance:ready); we apply its --wz-* tokens and acknowledge, so the window drops its opaque fill and the
 * Store paints on the skin's own material. Standalone: nothing is sent and the dark fallbacks in store.css apply.
 * Theme content only; the Store keeps its own Back hook (window.__wizardCloseOverlay). */
const TOKENS = ['canvas', 'base', 'chrome', 'overlay', 'surface', 'surface-raised', 'text', 'text-secondary', 'text-muted', 'border', 'accent', 'accent-soft', 'on-accent', 'reader-surface'];
const okToken = v => typeof v === 'string' && v.length > 0 && v.length < 96 && !/[;{}]|url\(/i.test(v) && (!window.CSS?.supports || CSS.supports('color', v));

export function adoptAppearance(name) {
  if (window.top === window) return;
  const root = document.documentElement, ORIGIN = location.origin;
  root.classList.add('wz-hosted');
  let revision = -1;
  addEventListener('message', e => {
    const d = e.data;
    if (e.source !== parent || e.origin !== ORIGIN || d?.type !== 'wizard:appearance') return;
    const a = d.appearance;
    if (!a || a.version !== 1 || !Number.isSafeInteger(a.revision) || a.revision < revision || !['light', 'dark'].includes(a.colorScheme)
      || !/^[a-z0-9-]{1,40}$/.test(a.skin || '') || !a.tokens || !TOKENS.every(k => okToken(a.tokens[k]))) return;
    revision = a.revision;
    for (const k of TOKENS) root.style.setProperty('--wz-' + k, a.tokens[k]);
    root.style.colorScheme = a.colorScheme; root.dataset.skin = a.skin; root.dataset.colorScheme = a.colorScheme;
    root.setAttribute('data-wz-hosted', '');
    parent.postMessage({ type: 'wizard:appearance:ack', version: 1, revision }, ORIGIN);
  });
  try { parent.postMessage({ type: 'wizard:appearance:ready', version: 1, app: String(name || '').slice(0, 96) }, ORIGIN); } catch (_) {}
}
