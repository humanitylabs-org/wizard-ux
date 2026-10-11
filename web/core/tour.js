/* Wizard OS first run: a four-beat practice tour on the live shell, plus the Help sheet (James, 11 Oct 2026;
 * spec settled with Claude Fable, transcripts in context/sources/projects/wizard-os/claude-transcripts/).
 *
 *   1 Talk     tap the orb, tap again: a scripted "Hello, Wizard" folds into a pill that flies to Working
 *   2 Command  hold the orb, slide right: "Open Day in review" types itself, the real desk opens next door
 *   3 Answer   swipe the orb down: a practice reply drops in; press Back to land on Home
 *   4 Done     "Need this again? Hold the orb, say help."
 *
 * Practice only: the tour owns every orb gesture while it runs (capture-phase listeners), so no mic is
 * opened, nothing is sent and no thread is created. The one real thing it leaves is the Day in review desk.
 * Skip is always there; Back steps back (at beat 1 it skips). Re-entry: say "help" (tap or hold), or
 * Settings → Gestures & help, which opens the Help sheet with "Practice again".
 *
 * The shell hands in what it needs with WosTour.attach(host); see app.js.
 */
(() => {
  'use strict';
  const KEY = 'wos.tour.v1';
  const HOLD_MS = 380, SWIPE = 70, SWIPE_V = .55, AIM = 40; // the shell's own thresholds (app.js orb gestures)
  let H = null, el = null, step = 0, G = null, helpEl = null, timers = [];
  const $ = (s, r = document) => r.querySelector(s);
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const done = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'false'); } catch (e) { return false; } };
  const mark = () => { try { localStorage.setItem(KEY, 'true'); localStorage.setItem('wos.coached', 'true'); } catch (e) {} };
  const log = s => { window.__tourLog = (window.__tourLog || []).concat(s).slice(-40); };

  const BEATS = [
    null,
    { title: 'Talk', copy: 'Tap the orb. Tap again to send.' },
    { title: 'Command', copy: 'Hold the orb. Slide right to aim.' },
    { title: 'Answer', copy: 'Your Wizard answered. Swipe the orb down.' },
    { title: 'Done', copy: 'Need this again? Hold the orb, say “help”.' },
  ];

  function build() {
    el = document.createElement('div'); el.id = 'tour'; el.className = 'tour'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Learn Wizard OS');
    el.innerHTML = `<div class="tr-spot"></div>
      <button type="button" class="tr-skip" data-tskip>Skip</button>
      <div class="tr-steps" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="tr-stage"></div>
      <div class="tr-copy" aria-live="polite"><small></small><b></b></div>`;
    el.addEventListener('click', e => {
      if (e.target.closest('[data-tskip]')) return finish('skip');
      if (step === 4) return finish('done');
    });
    H.device.appendChild(el);
  }
  function setCopy(text, sub) {
    const c = $('.tr-copy', el); c.classList.remove('in'); void c.offsetWidth;
    $('b', c).textContent = text; $('small', c).textContent = sub || ''; c.classList.add('in');
  }
  /* The spotlight hole: around the orb by default, onto a card when the beat is about it, closed at the end. */
  function spot(target, pad = 14) {
    const s = $('.tr-spot', el); if (!s) return;
    const dev = H.device.getBoundingClientRect();
    if (!target) { const o = H.orbWrap.getBoundingClientRect(); s.style.cssText = `left:${o.left - dev.left + o.width / 2}px;top:${o.top - dev.top + o.height / 2}px;width:0;height:0;border-radius:999px`; return; }
    const r = target.getBoundingClientRect(), round = target === H.orbWrap;
    s.style.cssText = `left:${r.left - dev.left - pad}px;top:${r.top - dev.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;border-radius:${round ? '999px' : '22px'}`;
  }
  function stage(html) { $('.tr-stage', el).innerHTML = html || ''; }
  function go(n) {
    clearTimers(); step = n; log('beat:' + n);
    el.dataset.step = String(n);
    [...el.querySelectorAll('.tr-steps i')].forEach((d, i) => d.classList.toggle('on', i < n));
    H.orbWrap.classList.toggle('tr-pulse', n < 4);
    H.setMode('idle');
    const b = BEATS[n]; setCopy(b.copy, n < 4 ? `${n} of 3 · ${b.title}` : '');
    if (n === 1) { H.goHome(); stage(''); }
    if (n === 3) stage('');
    if (n < 4) requestAnimationFrame(() => { if (step === n) spot(H.orbWrap, 12); });
    if (n === 4) {
      H.goHome(); spot(null);
      stage(`<div class="tr-glyphs">${glyph('tap', 'Tap', 'talk')}${glyph('hold', 'Hold', 'command')}${glyph('down', 'Swipe ↓', 'inbox')}</div><div class="tr-tapon">Tap anywhere to start</div>`);
    }
  }
  const glyph = (k, a, b) => `<div class="tr-g ${k}"><span class="tr-gi"><i></i></span><b>${a}</b><small>${b}</small></div>`;

  /* ---- typed bubble above the orb (the tour's stand-in for the transcript) ---- */
  function bubble(text, kind, cb) {
    stage(`<div class="tr-bubble ${kind || ''}"><span class="tr-wave"><i></i><i></i><i></i><i></i><i></i></span><span class="tr-said"></span></div>`);
    const s = $('.tr-said', el); let k = 0;
    const tick = () => { if (!s.isConnected) return; k++; s.textContent = text.slice(0, k); if (k < text.length) later(tick, 45); else cb && cb(); };
    later(tick, 260);
  }

  /* ---- beat 1: tap, tap ---- */
  let b1 = 0;
  function beat1Tap() {
    if (b1 === 0) { b1 = 1; H.setMode('listen'); H.shock(); H.vib(10); setCopy('Say anything. Tap again to send.', '1 of 3 · Talk'); bubble('Hello, Wizard', 'listen'); return; }
    b1 = 0; H.shock(); H.vib(14); H.setMode('agent');
    const from = $('.tr-bubble', el)?.getBoundingClientRect(), card = H.workingCard(), dev = H.device.getBoundingClientRect();
    stage('');
    if (from && card) {
      const to = card.getBoundingClientRect();
      const pill = document.createElement('div'); pill.className = 'tr-pill'; pill.textContent = 'Hello, Wizard';
      pill.style.left = `${from.left - dev.left + from.width / 2}px`; pill.style.top = `${from.top - dev.top + from.height / 2}px`;
      $('.tr-stage', el).appendChild(pill); void pill.offsetWidth;
      pill.style.transform = `translate(${to.left + to.width / 2 - from.left - from.width / 2}px, ${to.top + to.height / 2 - from.top - from.height / 2}px) translate(-50%, -50%) scale(.4)`; pill.style.opacity = '0';
      later(() => spot(card, 8), 120);
      later(() => { card.classList.add('tr-lit'); const n = card.querySelector('.n'); if (n) { card.dataset.trn = n.textContent; n.textContent = String((+n.textContent || 0) + 1); } }, 520);
    }
    setCopy('Sent. Your Wizard is working on it.', '1 of 3 · Talk');
    later(() => { H.setMode('idle'); go(2); }, 2000);
  }
  function restoreCard() { const c = H.workingCard(); if (!c) return; c.classList.remove('tr-lit'); const n = c.querySelector('.n'); if (n && c.dataset.trn != null) n.textContent = c.dataset.trn; delete c.dataset.trn; }

  /* ---- beat 2: hold, slide, release ---- */
  function beat2Hold() {
    H.setMode('command'); H.vib(18);
    setCopy('Now slide right, and let go.', '2 of 3 · Command');
    bubble('Open Day in review', 'cmd');
    $('.tr-stage', el).insertAdjacentHTML('beforeend', '<div class="tr-ghost"><span>Day in review</span></div>');
  }
  function beat2Move(dx) { const g = $('.tr-ghost', el); if (!g) return; const k = Math.max(0, Math.min(1, dx / 120)); g.style.setProperty('--k', k.toFixed(3)); g.classList.toggle('aimed', dx > AIM); }
  function beat2Release(dx) {
    H.setMode('idle'); H.shock(); H.vib(22);
    const g = $('.tr-ghost', el); if (g) g.classList.add('land');
    later(() => {
      stage(''); H.openDayReview();
      const s0 = $('.tr-spot', el); if (s0) s0.style.cssText = 'left:0;top:0;width:100%;height:100%;border-radius:0';
      setCopy(dx > AIM ? 'It opened right where you aimed.' : 'Opened next door. Slide to aim next time.', '2 of 3 · Command');
      later(() => { restoreCard(); go(3); }, 2100);
    }, 260);
  }

  /* ---- beat 3: swipe down, then Back ---- */
  let panel = false;
  function beat3Down() {
    panel = true; H.vib(10);
    stage(`<div class="tr-inbox"><div class="tr-ih">Inbox</div><div class="tr-card"><span class="tr-av">✦</span><span class="tr-ct"><b>Your Wizard</b><span>Hi. Reply here whenever you want me. Back always takes you home.</span></span><i class="tr-tag">FYI</i></div></div>`);
    requestAnimationFrame(() => { if (step === 3 && panel) spot($('.tr-inbox', el), 4); });
    setCopy('Now press Back.', '3 of 3 · Answer');
    later(() => { if (panel && step === 3) setCopy('Swipe in from the edge, or press Back.', '3 of 3 · Answer'); }, 5000);
  }
  function beat3Back() { panel = false; const p = $('.tr-inbox', el); if (p) p.classList.add('out'); later(() => go(4), 320); }

  /* ---- gestures: the tour owns the orb while it runs ---- */
  const onOrb = e => !!(e.target.closest && e.target.closest('#orbWrap'));
  function down(e) {
    if (!active() || !onOrb(e)) return;
    e.stopImmediatePropagation(); e.preventDefault();
    try { H.orbWrap.setPointerCapture(e.pointerId); } catch (x) {}
    G = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, dy: 0, mode: 'pending' };
    if (step === 2) G.hold = setTimeout(() => { if (G && G.mode === 'pending') { G.mode = 'hold'; beat2Hold(); } }, HOLD_MS);
    if (step === 4) finish('done');
  }
  function move(e) {
    if (!active() || !G) return;
    e.stopImmediatePropagation();
    G.dx = e.clientX - G.x; G.dy = e.clientY - G.y;
    if (G.mode === 'pending' && Math.hypot(G.dx, G.dy) > 14) { clearTimeout(G.hold); G.mode = Math.abs(G.dy) > Math.abs(G.dx) ? 'v' : 'h'; }
    if (G.mode === 'hold') beat2Move(G.dx);
  }
  function up(e, cancelled) {
    if (!active() || !G) return;
    e.stopImmediatePropagation();
    const g = G; G = null; clearTimeout(g.hold);
    if (cancelled) return;
    const vy = g.dy / ((performance.now() - g.t) || 1);
    if (step === 1) { if (g.mode === 'pending') beat1Tap(); else nudge('Just tap the orb.'); }
    else if (step === 2) { if (g.mode === 'hold') beat2Release(g.dx); else nudge(g.mode === 'pending' ? 'Hold it a moment longer.' : 'Nearly. Hold, don’t swipe.'); }
    else if (step === 3 && !panel) { if (g.mode === 'v' && (g.dy > SWIPE || vy > SWIPE_V)) beat3Down(); else nudge(g.mode === 'v' && g.dy < 0 ? 'Down, not up.' : 'Swipe the orb down.'); }
  }
  function nudge(t) { const b = BEATS[step]; setCopy(t, `${step} of 3 · ${b.title}`); H.vib(6); later(() => { if (active()) setCopy(b.copy, `${step} of 3 · ${b.title}`); }, 1800); }
  const block = e => { if (active() && !e.target.closest('.tour, #orbWrap, .help-sheet')) { e.stopImmediatePropagation(); e.preventDefault(); } };
  for (const t of ['pointerdown']) window.addEventListener(t, e => { block(e); down(e); }, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', e => up(e, false), true);
  window.addEventListener('pointercancel', e => up(e, true), true);
  window.addEventListener('click', e => { if (active() && !e.target.closest('.tour, .help-sheet')) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  window.addEventListener('keydown', e => { if (active() && (e.key === 'Enter' || e.key === ' ') && document.activeElement === H?.orbWrap) { e.stopImmediatePropagation(); e.preventDefault(); if (step === 1) beat1Tap(); } }, true);

  const active = () => !!(el && step > 0);
  function start(why) {
    if (!H) return false;
    closeHelp(); H.prepare();
    if (!el) build();
    el.hidden = false; el.classList.add('on'); H.device.classList.add('touring'); log('start:' + (why || ''));
    b1 = 0; panel = false; go(1); return true;
  }
  function finish(how) {
    if (!el) return;
    clearTimers(); restoreCard(); log('finish:' + how);
    step = 0; G = null; panel = false; mark();
    H.orbWrap.classList.remove('tr-pulse'); H.setMode('idle');
    el.classList.remove('on'); H.device.classList.remove('touring');
    const e0 = el; el = null; setTimeout(() => e0.remove(), 300);
    if (how === 'skip') H.toast('?', 'Say “help” any time to see the gestures', 2600);
  }
  /* Back: one step back. Beat 1 skips; beat 3's panel open → that is the success. */
  function back() {
    if (helpEl) { closeHelp(); return 'help'; }
    if (!active()) return '';
    if (step === 1) { if (b1) { b1 = 0; H.setMode('idle'); stage(''); setCopy(BEATS[1].copy, '1 of 3 · Talk'); return 'tour-step'; } finish('skip'); return 'tour-skip'; }
    if (step === 2) { go(1); return 'tour-step'; }
    if (step === 3) { if (panel) { beat3Back(); H.goHome(); return 'tour-step'; } go(2); return 'tour-step'; }
    finish('done'); return 'tour-done';
  }

  /* ---------------- Help sheet (re-entry) ---------------- */
  const HELP = [
    { k: 'tap', a: 'Tap the orb', b: 'Talk to your Wizard. Tap again to send.', say: ['What did we ship this week?'] },
    { k: 'hold', a: 'Hold the orb', b: 'A command for the phone. Slide sideways to aim at a desk.', say: ['Open Chats', 'Show me last week', 'Open Day in review'] },
    { k: 'down', a: 'Swipe the orb', b: '↓ Inbox · ↑ every app · ← → between desks.' },
    { k: 'dots', a: 'Dots under the orb', b: 'Tap to jump to a desk. Long-press to see them all.' },
    { k: 'back', a: 'Back', b: 'Always one step back. It never closes Wizard.' },
  ];
  function openHelp() {
    if (!H || helpEl) return;
    H.prepare();
    helpEl = document.createElement('div'); helpEl.className = 'help-sheet'; helpEl.setAttribute('role', 'dialog'); helpEl.setAttribute('aria-label', 'Gestures and help');
    helpEl.innerHTML = `<div class="hs-card"><div class="hs-h"><b>How Wizard works</b><button type="button" class="hs-x" data-hsx aria-label="Close">✕</button></div>
      ${HELP.map(r => `<div class="hs-row"><span class="tr-gi ${r.k}"><i></i></span><span class="hs-tx"><b>${r.a}</b><small>${r.b}</small>${r.say ? `<span class="hs-say">${r.say.map(s => `<button type="button" data-hsay="${s}" data-hkind="${r.k === 'hold' ? 'command' : 'auto'}">${s}</button>`).join('')}</span>` : ''}</span></div>`).join('')}
      <button type="button" class="hs-go" data-hsgo>Practice again</button></div>`;
    helpEl.addEventListener('click', e => {
      if (e.target.closest('[data-hsx]') || e.target === helpEl) return closeHelp();
      if (e.target.closest('[data-hsgo]')) { closeHelp(); return start('help'); }
      const s = e.target.closest('[data-hsay]'); if (s) { closeHelp(); H.say(s.dataset.hsay, s.dataset.hkind); }
    });
    H.device.appendChild(helpEl); void helpEl.offsetWidth; helpEl.classList.add('open'); log('help:open');
  }
  function closeHelp() { if (!helpEl) return false; const h = helpEl; helpEl = null; h.classList.remove('open'); setTimeout(() => h.remove(), 260); log('help:close'); return true; }
  const HELP_RE = /^(help|help me|show (me )?(the )?help|gestures|show (me )?(the )?gestures|how does (this|wizard) work|how do i use (this|wizard)|tutorial|show (me )?the tutorial|practice again)[.!?]*$/i;

  window.WosTour = {
    attach(host) { H = host; },
    start, finish, back, openHelp, closeHelp, _go: n => active() && go(n),
    isHelp: t => HELP_RE.test(String(t || '').trim()),
    get active() { return active(); }, get step() { return step; }, get helpOpen() { return !!helpEl; },
    done, mark,
  };
})();
