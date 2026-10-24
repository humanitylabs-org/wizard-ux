/* Wizard OS first run: a two-beat tour on the live shell with the real microphone, plus the Help sheet.
 * James, 11 Oct 2026: practise the real thing. The tour never fakes what the user said; it tells them what
 * to do, the real shell does it, and the tour watches the shell's events (app.js tourEv) to move on.
 *
 *   1 Talk     tap the orb, say hello, tap again: a real message to the Wizard (a real first thread)
 *   2 Hide     swipe the orb down: the bars hide (distraction-free); swipe up from the bottom brings them back
 *   3 Done     "Everything you see is customizable. Try asking your Wizard for one change." (+ "say help" line)
 *
 * Miguel, 24 Oct 2026: the old beat 2 (hold the orb and say "Open Calendar") is gone: it didn't work reliably and
 * a first run doesn't need it. Commands stay in the Help sheet. Each beat has "Skip this step" (moves to the next
 * beat) beside the top-right "Skip tour" (ends the whole tour), so skipping is no longer all or nothing.
 *
 * No mic (denied, or none here): the shell's own "tap a line" chips appear and count. Two empty takes in a row:
 * a "Type instead" path appears (beat 1: a text box that sends for real). Wrong gesture (a hold, swipe up, desk
 * swipe): the shell's result is undone and the tour nudges. Back steps back (at beat 1 it skips the tour).
 * Re-entry: say "help", or Settings → Gestures & help → Practice again.
 * Spec settled with Claude Fable: context/sources/projects/wizard-os/claude-transcripts/2026-10-11-tour-v2-*.
 */
(() => {
  'use strict';
  const KEY = 'wos.tour.v1';
  let H = null, el = null, step = 0, helpEl = null, timers = [];
  let misses = 0, typed = false, inbox = false, busy = false;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const done = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'false'); } catch (e) { return false; } };
  const mark = () => { try { localStorage.setItem(KEY, 'true'); localStorage.setItem('wos.coached', 'true'); } catch (e) {} };
  const log = s => { window.__tourLog = (window.__tourLog || []).concat(s).slice(-40); };
  const cmd = () => (H && H.cmdExample ? H.cmdExample() : 'Open Calendar');

  const BEATS = [
    null,
    { title: 'Talk', copy: () => typed ? 'Type “hello” and send it to your Wizard.' : 'Tap the orb and say hello. Tap again to send.' },
    { title: 'Hide', copy: () => 'Swipe the orb down to hide everything but your screen.' },
    { title: 'Done', copy: () => 'Need this again? Hold the orb and say “help”.' },
  ];
  const DONE = BEATS.length - 1; // the end card; every beat before it can be skipped on its own

  function build() {
    el = document.createElement('div'); el.id = 'tour'; el.className = 'tour'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Learn Wizard OS');
    el.innerHTML = `<div class="tr-spot"></div>
      <button type="button" class="tr-skip" data-tskip>Skip tour</button>
      <div class="tr-steps" aria-hidden="true">${'<i></i>'.repeat(DONE - 1)}</div>
      <div class="tr-stage"></div>
      <div class="tr-copy" aria-live="polite"><small></small><b></b><span class="tr-alt"></span><span class="tr-nx"></span></div>`;
    el.addEventListener('click', e => {
      if (e.target.closest('[data-tskip]')) return finish('skip');
      if (e.target.closest('[data-tnext]')) return skipStep();
      if (e.target.closest('[data-ttype]')) { typed = true; return go(step); }
      const say = e.target.closest('[data-tsay]'); if (say) { busy = true; H.say(say.dataset.tsay, say.dataset.tkind || 'auto'); return; }
      if (step === DONE) return finish('done');
    });
    el.addEventListener('submit', e => {
      e.preventDefault(); const inp = e.target.querySelector('input'); const t = (inp?.value || '').trim(); if (!t) return;
      busy = true; inp.blur(); H.say(t, 'auto');
    });
    H.device.appendChild(el);
  }
  function setCopy(text, sub, alt) {
    const c = $('.tr-copy', el); c.classList.remove('in'); void c.offsetWidth;
    $('b', c).textContent = text; $('small', c).textContent = sub || ''; $('.tr-alt', c).innerHTML = alt || '';
    $('.tr-nx', c).innerHTML = step > 0 && step < DONE ? '<button type="button" class="tr-link tr-next" data-tnext>Skip this step</button>' : '';
    c.classList.add('in');
  }
  const sub = n => n < DONE ? `${n} of ${DONE - 1} · ${BEATS[n].title}` : '';
  /* The spotlight hole: around the orb while a beat waits on it; wide open while the shell is showing a result. */
  function spot(mode) {
    const s = $('.tr-spot', el); if (!s) return;
    if (mode === 'open') { s.style.cssText = 'left:0;top:0;width:100%;height:100%;border-radius:0'; el.classList.add('tr-open'); return; }
    el.classList.remove('tr-open');
    const dev = H.device.getBoundingClientRect(), o = H.orbWrap.getBoundingClientRect();
    if (mode === 'closed') { s.style.cssText = `left:${o.left - dev.left + o.width / 2}px;top:${o.top - dev.top + o.height / 2}px;width:0;height:0;border-radius:999px`; return; }
    const pad = 12; s.style.cssText = `left:${o.left - dev.left - pad}px;top:${o.top - dev.top - pad}px;width:${o.width + pad * 2}px;height:${o.height + pad * 2}px;border-radius:999px`;
  }
  function fallback(n) {
    if (n === 1 && typed) return `<form class="tr-type"><input type="text" placeholder="hello" enterkeyhint="send" aria-label="Message to your Wizard" autocomplete="off"><button type="submit">Send</button></form>`;
    if (n === 1 && misses >= 2) return `<button type="button" class="tr-link" data-ttype>Type instead</button>`;
    if (n === DONE) return '<span class="tr-note">Need this again? Hold the orb and say “help”.</span>';
    return '';
  }
  function go(n) {
    clearTimers(); step = n; busy = false; inbox = false; log('beat:' + n);
    if (n !== 1) misses = 0;
    el.dataset.step = String(n);
    [...el.querySelectorAll('.tr-steps i')].forEach((d, i) => d.classList.toggle('on', i < n));
    H.orbWrap.classList.toggle('tr-pulse', n < DONE && !typed);
    if (n < DONE) H.goHome();
    setCopy(BEATS[n].copy(), sub(n), fallback(n));
    $('.tr-stage', el).innerHTML = '';
    if (n < DONE) requestAnimationFrame(() => { if (step === n) spot('orb'); });
    if (n === DONE) {
      H.goHome(); spot('closed');
      $('.tr-stage', el).innerHTML = `<div class="tr-glyphs">${glyph('tap', 'Tap', 'talk')}${glyph('down', 'Swipe ↓', 'hide')}</div>
        ${typed ? '<div class="tr-mic">Turn on the microphone in your phone’s settings to talk instead of type.</div>' : ''}<div class="tr-tapon">Tap anywhere to start</div>`;
    }
    if (n === 1 && typed) later(() => el.querySelector('.tr-type input')?.focus(), 120);
  }
  const glyph = (k, a, b) => `<div class="tr-g ${k}"><span class="tr-gi ${k}"><i></i></span><b>${a}</b><small>${b}</small></div>`;
  function nudge(t, ms = 2200) { if (!active()) return; const n = step; setCopy(t, sub(n), fallback(n)); H.vib(6); later(() => { if (active() && step === n && !busy && !inbox) setCopy(BEATS[n].copy(), sub(n), fallback(n)); }, ms); }

  /* ---- the shell tells the tour what really happened (app.js tourEv) ---- */
  function event(type, d = {}) {
    if (!active()) return;
    log('ev:' + type + (d.which ? ':' + d.which : ''));
    if (type === 'voice') { el.classList.toggle('tr-live', d.state !== 'idle'); return; }
    // Settings opened mid-tour (a deeplink, a notification, a voice command): the owner went somewhere on purpose.
    // Step aside; the tour's tap guard would otherwise swallow every tap in Settings under its scrim.
    if (type === 'sheet' && d.which === 'settings') return finish('handoff');
    if (type === 'nomic') { if (!typed) { typed = true; log('typed'); later(() => { if (!active()) return; H.prepare(); el.classList.remove('tr-live'); go(step); }, 700); } return; }
    if (step === 1) {
      // Only a real message moves Talk on. A hold is a wrong gesture (below), whether or not it ran as a command.
      if (type === 'sent') {
        busy = true; misses = 0; spot('open');
        setCopy('Sent. Your Wizard is working on it.', sub(1));
        return later(() => go(2), 2200);
      }
      if (type === 'nospeech') { misses++; busy = false; return nudge('Didn’t hear anything. Tap, speak, then tap again.', 3200); }
    }
    if (step === 2) {
      if (type === 'zen' && d.on) { inbox = true; spot('closed'); setCopy('Nothing in the way. Swipe up from the bottom edge to bring it back.', sub(2)); return; }
      if (type === 'zen' && !d.on && inbox) { inbox = false; return later(() => go(DONE), 250); }
    }
    // Wrong gesture: undo what the shell did and steer back to the beat.
    // A hold (the tour no longer teaches commands): drop the take, close whatever a command opened, back to Home.
    if ((type === 'command' || type === 'nomatch') && step < DONE) {
      busy = false; H.dismissVoice(); H.closeSheets(); H.goHome();
      return nudge(step === 1 ? 'That was a hold. For this one, just tap.' : 'That was a hold. Swipe the orb down instead.');
    }
    if (type === 'sheet' && d.which === 'launcher') { H.closeSheets(); return nudge(step === 2 ? 'Down, not up.' : 'That’s every app. We’ll come back to it.'); }
    if (type === 'desk' && step < DONE && !busy && !d.home) { H.goHome(); return nudge('That moves between desks. Try the beat above.'); }
  }

  const active = () => !!(el && step > 0);
  // While the tour runs, only the orb, the voice controls and the tour itself take taps.
  const allowed = t => !!(t.closest && t.closest('.tour, #orbWrap, #voice, .arc, #txChips, .help-sheet, #dock, #inbox, #zenEdge'));
  window.addEventListener('pointerdown', e => { if (active() && !allowed(e.target)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  window.addEventListener('click', e => { if (active() && !allowed(e.target)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

  function start(why) {
    if (!H) return false;
    closeHelp(); H.prepare();
    if (!el) build();
    typed = !!(H.noMic && H.noMic()); misses = 0;
    el.hidden = false; el.classList.add('on'); H.device.classList.add('touring'); log('start:' + (why || ''));
    go(1); return true;
  }
  function finish(how) {
    if (!el) return;
    clearTimers(); log('finish:' + how);
    step = 0; inbox = false; busy = false; mark();
    H.orbWrap.classList.remove('tr-pulse');
    el.classList.remove('on'); H.device.classList.remove('touring');
    const e0 = el; el = null; setTimeout(() => e0.remove(), 300);
    if (how === 'skip') H.toast('?', 'Say “help” any time to see the gestures', 2600);
  }
  /* Skip this step: leave the current beat (stopping a take in progress, bringing hidden bars back) and show the next. */
  function skipStep() {
    if (!active() || step >= DONE) return false;
    const n = step + 1; log('skip-step:' + step);
    if (inbox) { inbox = false; H.setZen?.(false); }
    H.prepare(); el.classList.remove('tr-live', 'tr-open');
    go(n); return true;
  }
  /* Back: one step back. In beat 2 with the bars hidden, Back brings them back: that is the success. */
  function back() {
    if (helpEl) { closeHelp(); return 'help'; }
    if (!active()) return '';
    if (el.classList.contains('tr-live')) return ''; // recording: Back navigates as always, the tour stays
    if (step === 1) { finish('skip'); return 'tour-skip'; }
    if (step === 2) { if (inbox) { H.setZen?.(false); return 'tour-step'; } go(1); return 'tour-step'; }
    finish('done'); return 'tour-done';
  }

  /* ---------------- Help sheet (re-entry) ---------------- */
  const HELP = [
    { k: 'tap', a: 'Tap the orb', b: 'Talk to your Wizard. Tap again to send.', say: ['What did we ship this week?'] },
    { k: 'hold', a: 'Hold the orb', b: 'A command for the phone. It opens on the desk next door.', say: () => [cmd(), 'Show me last week', 'Next desk'] },
    { k: 'down', a: 'Swipe the orb', b: '↓ hide the bars (swipe up from the bottom to bring them back) · ↑ every app · ← → between desks.' },
    { k: 'filter', a: 'In Chats', b: 'Tap the filter button in search, or hold the orb and say “filter by unread” or “search budget”.' },
    { k: 'dots', a: 'Dots under the orb', b: 'Tap to jump to a desk. Long-press to see them all.' },
    { k: 'back', a: 'Back', b: 'Always one step back. It never closes Wizard.' },
  ];
  function openHelp() {
    if (!H || helpEl) return;
    H.prepare();
    helpEl = document.createElement('div'); helpEl.className = 'help-sheet'; helpEl.setAttribute('role', 'dialog'); helpEl.setAttribute('aria-label', 'Gestures and help');
    helpEl.innerHTML = `<div class="hs-card"><div class="hs-h"><b>How Wizard works</b><button type="button" class="hs-x" data-hsx aria-label="Close">✕</button></div>
      ${HELP.map(r => { const say = typeof r.say === 'function' ? r.say() : r.say; return `<div class="hs-row"><span class="tr-gi ${r.k}"><i></i></span><span class="hs-tx"><b>${r.a}</b><small>${r.b}</small>${say ? `<span class="hs-say">${say.map(s => `<button type="button" data-hsay="${esc(s)}" data-hkind="${r.k === 'hold' ? 'command' : 'auto'}">${esc(s)}</button>`).join('')}</span>` : ''}</span></div>`; }).join('')}
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
    start, finish, back, event, skipStep, openHelp, closeHelp, _go: n => active() && go(n),
    beats: BEATS.slice(1).map(b => b.title), DONE,
    isHelp: t => HELP_RE.test(String(t || '').trim()),
    get active() { return active(); }, get step() { return step; }, get helpOpen() { return !!helpEl; }, get typed() { return typed; },
    done, mark,
  };
})();
