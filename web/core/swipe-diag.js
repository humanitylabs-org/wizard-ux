/* TEST PORT ONLY: records gestures, desk changes and visibility around a swipe out, and beacons them to the
 * shell's access log (/wizard-os-home/__diag?…, a 404 that nginx logs). Never PR this. */
(() => {
  'use strict';
  const B = []; let last = 0;
  const t0 = Date.now(), now = () => Date.now() - t0;
  const desk = () => { try { return window.__wos?.idx; } catch (e) { return '?'; } };
  const tr = () => { try { const t = document.getElementById('track'); return (t.style.transform.match(/-?\d+%/) || [''])[0]; } catch (e) { return ''; } };
  const add = s => { B.push(`${now()}:${s}`); if (B.length > 60) B.shift(); };
  const flush = why => {
    if (Date.now() - last < 300 && why !== 'show') return; last = Date.now();
    const q = encodeURIComponent(`${why}|d${desk()}|${tr()}|` + B.slice(-40).join(','));
    try { navigator.sendBeacon('/wizard-os-home/__diag?' + q.slice(0, 7000)); } catch (e) { new Image().src = '/wizard-os-home/__diag?' + q.slice(0, 7000); }
  };
  for (const t of ['pointerdown', 'pointerup', 'pointercancel']) addEventListener(t, e => add(`${t.slice(7)}@${e.clientX | 0},${e.clientY | 0}${e.target?.id ? '#' + e.target.id : ''}.${String(e.target?.className || '').split(' ')[0].slice(0, 10)}|d${desk()}`), true);
  for (const t of ['touchstart', 'touchend', 'touchcancel']) addEventListener(t, e => { const p = e.changedTouches[0]; add(`${t}@${p ? (p.clientX | 0) + ',' + (p.clientY | 0) : ''}|d${desk()}`); }, { capture: true, passive: true });
  let lastIdx = null;
  setInterval(() => { const d = desk(); if (d !== lastIdx) { add(`DESK ${lastIdx}->${d} hid=${document.hidden}`); lastIdx = d; } }, 50);
  document.addEventListener('visibilitychange', () => { add(`vis ${document.hidden ? 'hidden' : 'shown'} d${desk()} ${tr()}`); flush(document.hidden ? 'hide' : 'show'); setTimeout(() => { add(`+1s d${desk()} ${tr()}`); flush('after'); }, 1000); });
  addEventListener('pagehide', () => { add('pagehide'); flush('pagehide'); });
  addEventListener('pageshow', e => { add('pageshow p=' + e.persisted); flush('show'); });
  addEventListener('blur', () => add('blur')); addEventListener('focus', () => add('focus'));
  add('load d' + desk()); setTimeout(() => flush('load'), 3000);
})();
