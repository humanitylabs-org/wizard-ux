/* Temporary dictation probe (Novaire, 21 Oct 2026): Wispr Flow pastes into a plain textarea but not into Chats.
 * Off unless the URL has ?wisprdebug (remembered on this device until ?wisprdebug=0). Shows the last key/paste/
 * input/focus events on screen, including whether a WizardOS handler cancelled them. Records event shape and
 * text length only, never the dictated words. */
(() => {
  'use strict';
  const q = new URLSearchParams(location.search).get('wisprdebug');
  try { if (q === '0') localStorage.removeItem('wos.wisprdebug'); else if (q !== null) localStorage.setItem('wos.wisprdebug', '1'); } catch (_) {}
  let on = q !== null && q !== '0';
  try { on = on || localStorage.getItem('wos.wisprdebug') === '1'; } catch (_) {}
  if (!on) return;
  const lines = [], t0 = performance.now();
  let box = null;
  const who = el => {
    if (!el || !el.tagName) return String(el && el.nodeName || el);
    const ta = el.closest && el.closest('.ch-compose') ? 'composer:' : '';
    return ta + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
  };
  const show = () => {
    if (!box) {
      box = document.createElement('pre');
      box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:min(560px,94vw);max-height:46vh;overflow:auto;margin:0;padding:8px 10px;font:11px/1.35 ui-monospace,monospace;background:rgba(0,0,0,.88);color:#9f9;border:1px solid #3a3;border-radius:8px;pointer-events:none;white-space:pre-wrap';
      document.body.appendChild(box);
    }
    box.textContent = 'WISPR DEBUG · active: ' + who(document.activeElement) + '\n' + lines.slice(-28).join('\n');
  };
  let outq = [];
  const add = s => { const l = ((performance.now() - t0) / 1000).toFixed(2) + ' ' + s; lines.push(l); outq.push({ t: Date.now(), k: l }); if (lines.length > 200) lines.shift(); if (document.body) show(); };
  // Ship the log to the box (same origin, lengths only) so the owner never has to screenshot it.
  setInterval(() => { if (!outq.length) return; const b = outq; outq = []; fetch('wispr-log', { method: 'POST', body: JSON.stringify(b), keepalive: true }).catch(() => { outq = b.concat(outq); }); }, 1500);
  const mods = e => (e.metaKey ? '⌘' : '') + (e.ctrlKey ? '⌃' : '') + (e.altKey ? '⌥' : '') + (e.shiftKey ? '⇧' : '');
  const describe = e => {
    let s = e.type + ' ' + who(e.target);
    if (e.key !== undefined) s += ' ' + mods(e) + (e.key || '') + '/' + (e.code || '') + (e.isTrusted ? '' : ' untrusted');
    if (e.inputType) s += ' ' + e.inputType;
    if (e.clipboardData) { let n = -1; try { n = e.clipboardData.getData('text/plain').length; } catch (_) {} s += ' clip=' + n + ' types=' + [...e.clipboardData.types].join(','); }
    if (e.type === 'input' && 'value' in e.target) s += ' len=' + e.target.value.length;
    return s;
  };
  for (const type of ['keydown', 'keyup', 'paste', 'beforeinput', 'input', 'focusin', 'focusout']) {
    addEventListener(type, e => {
      if ((type === 'keydown' || type === 'keyup') && !(e.metaKey || e.ctrlKey || /^(Meta|Control|Alt|Fn)/.test(e.key || ''))) return;
      const s = describe(e);
      if (type === 'paste' && 'value' in e.target) { const el = e.target, n0 = el.value.length; setTimeout(() => add('  after paste: composer len ' + n0 + ' -> ' + el.value.length + (el.isConnected ? '' : ' (DETACHED)')), 120); }
      // Read cancellation after every WizardOS handler has run.
      setTimeout(() => add(s + (e.defaultPrevented ? '  ⛔ CANCELLED' : '')), 0);
    }, true);
  }
  addEventListener('blur', () => add('window blur'));
  addEventListener('focus', () => add('window focus'));
  document.addEventListener('visibilitychange', () => add('visibility ' + document.visibilityState));
  // A composer replaced while focused (a repaint) would orphan an external paste.
  new MutationObserver(ms => { for (const m of ms) for (const n of m.removedNodes) if (n.nodeType === 1 && (n.matches?.('.ch-compose textarea') || n.querySelector?.('.ch-compose textarea'))) add('composer REMOVED from page'); })
    .observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('DOMContentLoaded', () => add('loaded ' + location.pathname));
})();
