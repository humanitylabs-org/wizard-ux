/* Wizard Motion Kit v1 — the Live Mode feel, shared across Wizard.
 * Dependency-free. Load wizard-motion.css next to it. Exposes window.WizardMotion.
 * Stable URL: https://<machine>.<tailnet>.ts.net/wizard-os-home/motion/wizard-motion.js
 * API notes: README.md beside this file. Demo: ./index.html
 */
(function (W) {
  'use strict';
  if (W.WizardMotion) return;
  const reduced = () => { try { return W.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  /* ---------------- haptics ---------------- */
  const HAPTIC = { tick: 6, press: 12, notice: 30, sent: [20, 40, 60], soft: 8, error: [40, 60, 40] };
  function haptic(p) { try { const v = typeof p === 'string' ? HAPTIC[p] : p; if (v != null && navigator.vibrate) navigator.vibrate(v); } catch (e) {} }

  /* ---------------- soft tones (made on the first gesture) ---------------- */
  let A = null, master = null;
  function unlock() {
    if (A) return A;
    try { A = new (W.AudioContext || W.webkitAudioContext)(); master = A.createGain(); master.gain.value = .35; master.connect(A.destination); } catch (e) { A = null; }
    return A;
  }
  if (W.addEventListener) W.addEventListener('pointerdown', unlock, { once: true, capture: true });
  const TONES = { notice: [523, 2.2, .12], sent: [784, 2.6, .18], open: [440, 1.6, .08], tick: [880, .25, .05], soft: [660, 1.2, .08] };
  function chime(f = 660, d = 1.6, v = .16) {
    if (Array.isArray(f)) [f, d, v] = f; else if (typeof f === 'string') [f, d, v] = TONES[f] || TONES.soft;
    if (!A || sound.muted) return; if (A.state === 'suspended') A.resume().catch(() => {});
    const t = A.currentTime;
    [1, 1.5, 2].forEach((m, i) => {
      const o = A.createOscillator(), g = A.createGain(); o.type = 'sine'; o.frequency.value = f * m;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v / (i + 1), t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g).connect(master); o.start(t); o.stop(t + d);
    });
  }
  const sound = { unlock, chime, muted: false };

  /* ---------------- drifting words ----------------
   * words(canvas, { anchor: () => ({x, y}), lanes: [0.34..], max: 4, dim: () => bool })
   *   .add(text)     faint word in a free lane of the open band
   *   .hot(text)     bright word just above the anchor (the thing that was noticed)
   *   .gather()      the hot word(s) fall into the anchor (the orb)
   *   .clear() .destroy() .count
   */
  function words(canvas, opts = {}) {
    const X = canvas.getContext('2d');
    const anchor = opts.anchor || (() => ({ x: CW / 2, y: CH - 90 }));
    const lanes = opts.lanes || [.34, .39, .44, .49, .54], MAX = opts.max || 4;
    let list = [], DPR = 1, CW = 0, CH = 0, raf = 0, dead = false;
    const rs = () => {
      DPR = Math.min(W.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect(); CW = r.width || W.innerWidth; CH = r.height || W.innerHeight;
      canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR); X.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    rs(); W.addEventListener('resize', rs);
    function add(text) {
      const used = list.filter(f => !f.hot).map(f => f.y / CH);
      const lane = lanes.map(l => [l, Math.min(1, ...used.map(u => Math.abs(u - l)))]).sort((a, b) => b[1] - a[1])[0][0];
      const side = Math.random() < .5 ? -1 : 1;
      list.push({ w: text, x: CW * (.3 + Math.random() * .4), y: CH * lane, vx: side * (.08 + Math.random() * .08), vy: -.08, life: 0, hot: false });
      const calm = list.filter(f => !f.hot); if (calm.length > MAX) list.splice(list.indexOf(calm[0]), 1);
    }
    function hot(text) { const o = anchor(); const f = { w: text, x: o.x, y: o.y - 120, vx: 0, vy: -.15, life: 20, hot: true }; list.push(f); return f; }
    function gather() { list.forEach(f => { if (f.hot) f.gather = true; }); }
    function draw() {
      if (dead) return;
      // Android can drop and restore a 2D canvas, resetting its transform: reapply every frame.
      if (canvas.width !== Math.round(CW * DPR)) rs(); else X.setTransform(DPR, 0, 0, DPR, 0, 0);
      X.clearRect(0, 0, CW, CH); X.textAlign = 'center';
      const dim = opts.dim && opts.dim() ? .25 : 1, o = anchor(), still = reduced();
      list = list.filter(f => {
        f.life++; if (!still) { f.x += f.vx; f.y += f.vy; }
        if (f.gather) { f.x += (o.x - f.x) * .08; f.y += (o.y - f.y) * .08; }
        const a = Math.min(1, f.life / 40) * Math.max(0, 1 - (f.life - 300) / 120) * dim;
        X.font = f.hot ? '500 16px system-ui, sans-serif' : '300 14px system-ui, sans-serif';
        X.fillStyle = f.hot ? `rgba(233,226,255,${a})` : `rgba(170,158,215,${a * .5})`;
        const hw = X.measureText(f.w).width / 2 + 12;
        X.fillText(f.w, Math.max(hw, Math.min(CW - hw, f.x)), f.y);
        return f.life < 420 && f.y > -20 && !(f.gather && Math.hypot(o.x - f.x, o.y - f.y) < 12);
      });
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return { add, hot, gather, clear() { list = []; }, get count() { return list.length; },
      destroy() { dead = true; cancelAnimationFrame(raf); W.removeEventListener('resize', rs); X.clearRect(0, 0, CW, CH); } };
  }

  /* ---------------- orb ambient state ----------------
   * orb(el).set('live' | 'noticed' | '')  breathing ring while listening; one shockwave when something is noticed. */
  function orb(el) {
    return {
      set(state) { if (!el) return; if (state === 'noticed') { el.classList.remove('wm-noticed'); void el.offsetWidth; el.classList.add('wm-noticed'); setTimeout(() => el.classList.remove('wm-noticed'), 1200); return; } el.dataset.wmAmbient = state || ''; },
      notice() { this.set('noticed'); },
    };
  }

  /* ---------------- card rise / sink / send ----------------
   * card(el) with class "wm-card" (optionally inside a "wm-layer" scrim):
   *   .rise()  springs up from below (from the orb)
   *   .sink()  dismissed: drops back
   *   .send()  signed: shrinks down into the orb
   */
  function card(el, layer) {
    const L = layer || el.closest('.wm-layer');
    return {
      get open() { return el.classList.contains('on'); },
      rise() { el.classList.remove('gone', 'sent'); if (L) L.classList.add('open'); requestAnimationFrame(() => el.classList.add('on')); },
      sink(sent) {
        el.classList.remove('on'); el.classList.add(sent ? 'sent' : 'gone');
        setTimeout(() => { if (!el.classList.contains('on')) { if (L) L.classList.remove('open'); el.classList.remove('gone', 'sent'); } }, 900);
      },
      send() { this.sink(true); },
    };
  }

  /* ---------------- tap-or-hold sign ring ----------------
   * signRing(button, ringCircle, { holdMs: 300, onSign(via), enabled: () => bool })
   * A quick tap or a ~300 ms hold fills the ring and signs. The whole button is the target.
   * ringCircle: an SVG <circle> with r=46 (circumference ≈ 289) and stroke-dasharray 289.
   */
  function signRing(btn, ring, opts = {}) {
    const HOLD = opts.holdMs || 300, C = opts.circumference || 289;
    let raf = 0, t0 = 0, down = false, busy = false;
    const set = p => { if (ring) ring.style.strokeDashoffset = C * (1 - p); };
    const fill = (from, ms, via) => {
      const s = performance.now();
      const step = () => {
        const p = Math.min(1, from + (performance.now() - s) / ms * (1 - from)); set(p);
        if (p < 1) raf = requestAnimationFrame(step); else { busy = false; haptic('sent'); opts.onSign && opts.onSign(via); }
      };
      cancelAnimationFrame(raf); raf = requestAnimationFrame(step);
    };
    const ok = () => !busy && (!opts.enabled || opts.enabled());
    const onDown = e => { e.stopPropagation(); e.preventDefault(); if (!ok()) return; down = true; busy = true; t0 = performance.now(); haptic('press'); btn.classList.add('pressing'); fill(0, HOLD, 'hold'); };
    const onUp = () => { if (!down) return; down = false; btn.classList.remove('pressing'); if (busy && performance.now() - t0 < HOLD) fill(Math.min(1, (performance.now() - t0) / HOLD), 140, 'tap'); };
    const onKey = e => { if ((e.key === 'Enter' || e.key === ' ') && ok()) { e.preventDefault(); busy = true; fill(0, 160, 'tap'); } };
    const stop = e => e.stopPropagation();
    btn.addEventListener('pointerdown', onDown); btn.addEventListener('pointerup', onUp); btn.addEventListener('pointercancel', onUp);
    btn.addEventListener('keydown', onKey); btn.addEventListener('click', stop);
    btn.classList.add('wm-sign');
    return {
      reset() { cancelAnimationFrame(raf); busy = false; down = false; btn.classList.remove('pressing'); set(0); },
      get busy() { return busy; },
      destroy() { this.reset(); btn.removeEventListener('pointerdown', onDown); btn.removeEventListener('pointerup', onUp); btn.removeEventListener('pointercancel', onUp); btn.removeEventListener('keydown', onKey); btn.removeEventListener('click', stop); },
    };
  }

  /* ---------------- spread / pinch ----------------
   * spread(target, { onOut, onIn, enabled: () => bool, threshold: 50 })
   * Two fingers apart → onOut (go deeper / open), together → onIn (go shallower / close).
   */
  function spread(target, opts = {}) {
    const T = opts.threshold || 50; let d0 = 0;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const s = e => { if (e.touches.length === 2 && (!opts.enabled || opts.enabled())) d0 = dist(e.touches); };
    const m = e => { if (!d0 || e.touches.length !== 2) return; const dd = dist(e.touches) - d0;
      if (dd > T) { d0 = 0; haptic('soft'); opts.onOut && opts.onOut(); } else if (dd < -T) { d0 = 0; haptic('soft'); opts.onIn && opts.onIn(); } };
    const u = () => { d0 = 0; };
    const o = { passive: true, capture: true };
    target.addEventListener('touchstart', s, o); target.addEventListener('touchmove', m, o); target.addEventListener('touchend', u, { capture: true });
    return { destroy() { target.removeEventListener('touchstart', s, o); target.removeEventListener('touchmove', m, o); target.removeEventListener('touchend', u, { capture: true }); } };
  }

  /* ---------------- moons ----------------
   * moons(hostEl, { radius: 50 }).set([{ id, state: 'working'|'done'|'failed'|'needs', title }])
   * Small lights orbiting the orb: violet working, green done, red failed, amber needs you.
   */
  function moons(host, opts = {}) {
    const el = document.createElement('div'); el.className = 'wm-moons'; host.appendChild(el);
    const R = opts.radius || Math.round((host.offsetWidth || 84) / 2 + 10);
    const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return {
      el,
      set(list) {
        el.innerHTML = (list || []).slice(0, 8).map((m, k, a) => { const ang = (k / Math.max(a.length, 1)) * Math.PI * 2 + Math.PI / 4;
          return `<i class="wm-moon ${m.state || 'working'}" data-moon="${esc(m.id)}" title="${esc(m.title)}" style="transform:translate(${(Math.cos(ang) * R).toFixed(1)}px,${(Math.sin(ang) * R).toFixed(1)}px)"></i>`; }).join('');
      },
    };
  }

  /* ---------------- hint: one plain pulsing line per step ---------------- */
  function hint(el) {
    let key = '', until = 0;
    return {
      show(text, k = '', holdMs = 0, force = false) { if (Date.now() < until && !force) return; key = k; until = holdMs ? Date.now() + holdMs : 0; el.textContent = text || ''; el.classList.toggle('on', !!text); el.dataset.k = k; },
      clear() { if (Date.now() < until) return; key = ''; el.textContent = ''; el.classList.remove('on'); },
      get key() { return key; }, get text() { return el.textContent; },
    };
  }

  W.WizardMotion = { version: '1.0.0', haptic, HAPTIC, sound, chime, words, orb, card, signRing, spread, moons, hint, reduced };
})(window);
