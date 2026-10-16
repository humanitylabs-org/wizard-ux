/* Declarative skin frame vocabulary. No CSS, URLs, selectors, scripts or app capabilities. */
(() => {
  'use strict';
  const foundations = Object.freeze({
    framed: Object.freeze({ foundation: 'framed' }),
    borderless: Object.freeze({ foundation: 'borderless', border: 0, radius: 0, gutter: 0, gap: 8 }),
  });
  const bounds = { border: [0, 2], radius: [0, 28], gutter: [0, 16], gap: [4, 16] };
  const object = (o, field) => { if (!o || typeof o !== 'object' || Array.isArray(o) || ![Object.prototype, null].includes(Object.getPrototypeOf(o))) throw new Error(`${field}: expected an object`); };
  function frame(value = {}) {
    object(value, 'frame');
    for (const key of Object.keys(value)) if (key !== 'foundation' && !Object.hasOwn(bounds, key)) throw new Error(`frame.${key}: unknown field`);
    const foundation = value.foundation ?? 'framed';
    if (!Object.hasOwn(foundations, foundation)) throw new Error('frame.foundation: use framed or borderless');
    const result = { ...foundations[foundation] };
    for (const [key, range] of Object.entries(bounds)) if (Object.hasOwn(value, key)) {
      const n = value[key];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < range[0] || n > range[1]) throw new Error(`frame.${key}: expected ${range[0]}–${range[1]}`);
      result[key] = n;
    }
    return result;
  }
  function composition(value, skins) {
    object(value, 'skin');
    for (const key of Object.keys(value)) if (!['version', 'extends', 'frame'].includes(key)) throw new Error(`${key}: unknown field`);
    if (value.version !== 1) throw new Error('version: expected 1');
    if (typeof value.extends !== 'string' || !skins.some(s => s.id === value.extends)) throw new Error('extends: unknown skin');
    const parent = skins.find(s => s.id === value.extends);
    return { version: 1, extends: value.extends, frame: frame(value.frame ?? parent.frame ?? {}) };
  }
  function apply(value) {
    const f = frame(value), root = document.documentElement;
    root.dataset.skinFrame = f.foundation;
    for (const key of Object.keys(bounds)) {
      if (Object.hasOwn(f, key)) root.style.setProperty(`--sf-${key}`, `${f[key]}px`);
      else root.style.removeProperty(`--sf-${key}`);
    }
    return f;
  }
  function choices(current) { return `<div class="sf-choices" role="group" aria-label="Window foundation">${[['framed', 'Standard'], ['borderless', 'Borderless']].map(([id, name]) => `<button type="button" data-skinfoundation="${id}" aria-pressed="${current === id}">${name}</button>`).join('')}</div>`; }
  // Enhance the original control nodes, never clone a window or its lifecycle actions.
  let expanded = null;
  function collapse(restoreFocus = false) {
    if (!expanded) return false;
    const bar = expanded; expanded = null;
    bar.classList.remove('sf-expanded');
    const toggle = bar.querySelector('[data-wact="frame-menu"]');
    toggle?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && toggle?.isConnected) toggle.focus();
    return true;
  }
  function back() {
    const review = document.querySelector('.sf-preview-bar[open]');
    if (review) { review.open = false; review.querySelector('summary')?.focus(); return true; }
    return collapse(true);
  }
  function enhance(bar) {
    if (bar.querySelector('[data-wact="frame-menu"]')) return;
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'sf-menu'; toggle.dataset.wact = 'frame-menu';
    toggle.textContent = '⋯'; toggle.setAttribute('aria-label', 'Window controls');
    toggle.setAttribute('aria-expanded', 'false'); toggle.title = 'Window controls · move controls if they cover an app action';
    const move = document.createElement('button');
    move.type = 'button'; move.className = 'sf-move'; move.dataset.wact = 'frame-move';
    move.textContent = '↔'; move.setAttribute('aria-label', 'Move controls to the other corner'); move.title = 'Move controls to the other corner';
    bar.append(toggle, move);
    bar.addEventListener('click', e => {
      const act = e.target.closest('[data-wact]')?.dataset.wact;
      if (act === 'frame-menu' || act === 'frame-move') {
        e.preventDefault(); e.stopPropagation();
        if (act === 'frame-move') {
          bar.dataset.sfSide = bar.dataset.sfSide === 'left' ? 'right' : 'left';
          collapse(true);
        } else if (expanded === bar) collapse(true);
        else { collapse(); expanded = bar; bar.classList.add('sf-expanded'); toggle.setAttribute('aria-expanded', 'true'); }
      }
    });
  }
  function mountControls() {
    const scan = root => {
      if (root.nodeType !== 1) return;
      if (root.matches('.win > .wbar')) enhance(root);
      root.querySelectorAll('.win > .wbar').forEach(enhance);
    };
    scan(document.body);
    new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerdown', e => { if (expanded && !expanded.contains(e.target)) collapse(); }, true);
    // Route/bound modules may stop clicks in document capture. Observe at window
    // capture, then fold only after their original dispatch has completed.
    addEventListener('click', e => {
      const button = e.target.closest?.('.wbar button');
      if (expanded && button && !['frame-menu', 'frame-move'].includes(button.dataset.wact)) {
        const owner = expanded;
        setTimeout(() => { if (expanded === owner) collapse(); }, 0);
      }
    }, true);
    addEventListener('blur', () => setTimeout(() => {
      if (document.activeElement?.tagName === 'IFRAME') collapse();
    }, 0));
    addEventListener('wos:skin-frame', () => collapse());
  }
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountControls, { once: true });
    else mountControls();
  }
  const api = Object.freeze({ foundations, frame, composition, apply, choices, back });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.WosSkinFrame = api;
})();
