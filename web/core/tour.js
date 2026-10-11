/* Wizard OS first run: a three-beat tour on the live shell with the real microphone, plus the Help sheet.
 * James, 11 Oct 2026: practise the real thing. The tour never fakes what the user said; it tells them what
 * to do, the real shell does it, and the tour watches the shell's events (app.js tourEv) to move on.
 *
 *   1 Talk     tap the orb, say hello, tap again: a real message to the Wizard (a real first thread)
 *   2 Command  hold the orb, say "Open Calendar", let go: the app opens on the desk next door
 *   3 Inbox    swipe the orb down: the real inbox; Back closes it
 *   4 Done     "Need this again? Hold the orb, say help."
 *
 * No mic (denied, or none here): the shell's own "tap a line" chips appear and count. Two empty takes in a row:
 * a "Type instead" path appears (beat 1: a text box that sends for real; beat 2: the command as a button).
 * Wrong gesture (swipe up, desk swipe): the shell's result is undone and the tour nudges. Skip is always there;
 * Back steps back (at beat 1 it skips). Re-entry: say "help", or Settings → Gestures & help → Practice again.
 * Spec settled with Claude Fable: context/sources/projects/wizard-os/claude-transcripts/2026-10-11-tour-v2-*.
 */
(() => {
  'use strict';
  const KEY = 'wos.tour.v1';
  let H = null, el = null, step = 0, helpEl = null, timers = [];
  let misses = 0, typed = false, inbox = false, busy = false;
  let picking = false, picked = false; // beat 0: choose your skin (core/skins.js)
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
    { title: 'Command', copy: () => typed ? `Tap the orb’s command: “${cmd()}”.` : `Hold the orb and say “${cmd()}”. Let go when you’re done.` },
    { title: 'Inbox', copy: () => 'Swipe the orb down to see your inbox.' },
    { title: 'Done', copy: () => 'Need this again? Hold the orb and say “help”.' },
  ];

  function build() {
    el = document.createElement('div'); el.id = 'tour'; el.className = 'tour'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Learn Wizard OS');
    el.innerHTML = `<div class="tr-spot"></div>
      <button type="button" class="tr-skip" data-tskip>Skip</button>
      <div class="tr-steps" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="tr-stage"></div>
      <div class="tr-copy" aria-live="polite"><small></small><b></b><span class="tr-alt"></span></div>
      <div class="sk-pick"><div class="sk-flash"></div><div class="sk-panel"><div class="sk-eb">Choose your skin</div><div class="sk-name"></div><div class="sk-who"></div>
        <div class="sk-dots"></div><div class="sk-hint">Swipe to try them on</div><button type="button" class="sk-wear"><i></i><span></span></button></div></div>`;
    el.addEventListener('click', e => {
      if (e.target.closest('[data-tskip]')) return finish('skip');
      if (e.target.closest('[data-ttype]')) { typed = true; return go(step); }
      const say = e.target.closest('[data-tsay]'); if (say) { busy = true; H.say(say.dataset.tsay, say.dataset.tkind || 'auto'); return; }
      if (step === 4) return finish('done');
    });
    el.addEventListener('submit', e => {
      e.preventDefault(); const inp = e.target.querySelector('input'); const t = (inp?.value || '').trim(); if (!t) return;
      busy = true; inp.blur(); H.say(t, 'auto');
    });
    H.device.appendChild(el);
  }
  function setCopy(text, sub, alt) {
    const c = $('.tr-copy', el); c.classList.remove('in'); void c.offsetWidth;
    $('b', c).textContent = text; $('small', c).textContent = sub || ''; $('.tr-alt', c).innerHTML = alt || ''; c.classList.add('in');
  }
  const sub = n => n < 4 ? `${n} of 3 · ${BEATS[n].title}` : '';
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
    if (n === 2 && typed) return `<button type="button" class="tr-cmd" data-tsay="${esc(cmd())}" data-tkind="command">${esc(cmd())}</button>`;
    if ((n === 1 || n === 2) && misses >= 2) return `<button type="button" class="tr-link" data-ttype>Type instead</button>`;
    return '';
  }
  function go(n) {
    clearTimers(); step = n; busy = false; inbox = false; log('beat:' + n);
    if (picking) unpick();
    if (n !== 1 && n !== 2) misses = 0;
    el.dataset.step = String(n);
    [...el.querySelectorAll('.tr-steps i')].forEach((d, i) => d.classList.toggle('on', i < n));
    H.orbWrap.classList.toggle('tr-pulse', n < 4 && !typed);
    if (n <= 3) H.goHome();
    setCopy(BEATS[n].copy(), sub(n), fallback(n));
    $('.tr-stage', el).innerHTML = '';
    if (n < 4) requestAnimationFrame(() => { if (step === n) spot('orb'); });
    if (n === 4) {
      H.goHome(); spot('closed');
      $('.tr-stage', el).innerHTML = `<div class="tr-glyphs">${glyph('tap', 'Tap', 'talk')}${glyph('hold', 'Hold', 'command')}${glyph('down', 'Swipe ↓', 'inbox')}</div>
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
    if (type === 'nomic') { if (!typed) { typed = true; log('typed'); later(() => { if (!active()) return; H.prepare(); el.classList.remove('tr-live'); go(step); }, 700); } return; }
    if (step === 1) {
      if (type === 'sent' || (type === 'command' && d.ok)) {
        busy = true; misses = 0; spot('open');
        setCopy(type === 'sent' ? 'Sent. Your Wizard is working on it.' : 'That ran as a command. Nice.', sub(1));
        return later(() => go(2), 2200);
      }
      if (type === 'nospeech') { misses++; busy = false; return nudge('Didn’t hear anything. Tap, speak, then tap again.', 3200); }
      if (type === 'nomatch') { busy = false; H.dismissVoice(); return nudge('That was a hold. For this one, just tap.'); }
    }
    if (step === 2) {
      if (type === 'command' && d.ok) {
        busy = true; misses = 0; spot('open');
        setCopy('That’s a command. It opened on the desk next door.', sub(2));
        return later(() => go(3), 2600);
      }
      if (type === 'nomatch' || (type === 'command' && !d.ok)) { misses++; busy = false; H.dismissVoice(); return nudge(`Didn’t catch a command. Try “${cmd()}”.`, 3200); }
      if (type === 'nospeech') { misses++; busy = false; return nudge('Hold, speak, then let go.', 3200); }
      if (type === 'sent') { busy = false; return nudge(`That went to your Wizard as a message. Hold the orb for a command.`, 3200); }
    }
    if (step === 3) {
      if (type === 'sheet' && d.which === 'inbox') { inbox = true; spot('open'); setCopy('Replies land here. Now press Back.', sub(3)); return; }
      if (type === 'sheet-closed' && d.which === 'inbox' && inbox) { inbox = false; return later(() => go(4), 250); }
    }
    // Wrong gesture: undo what the shell did and steer back to the beat.
    if (type === 'sheet' && d.which === 'launcher') { H.closeSheets(); return nudge(step === 3 ? 'Down, not up.' : 'That’s every app. We’ll come back to it.'); }
    if (type === 'desk' && step <= 3 && !busy && !d.home) { H.goHome(); return nudge('That moves between desks. Try the beat above.'); }
  }


  /* ---------------- Beat 0: choose your skin ----------------
   * The real Home stays live underneath; swiping anywhere above the dock re-dresses it (WosSkin.preview blends
   * tokens, background and orb continuously). Hold "Wear …" to choose; the tour then continues in that skin. */
  let pk = null, pkBound = false;
  function pick() {
    clearTimers(); step = 0; picking = true; log('beat:skin');
    const S = window.WosSkin, L = S.list, N = L.length;
    el.classList.add('tr-pick'); el.dataset.step = '0'; H.goHome(); spot('open');
    H.orbWrap.classList.remove('tr-pulse');
    const root = $('.sk-pick', el), name = $('.sk-name', root), who = $('.sk-who', root), dots = $('.sk-dots', root), wear = $('.sk-wear', root), fill = $('i', wear), lbl = $('span', wear);
    dots.innerHTML = L.map((s, i) => `<b data-sk="${i}" aria-label="${esc(s.name)}"></b>`).join('');
    const start = S.chosen ? S.index(S.chosen) : Math.round(S.pos);
    pk = { pos: start, target: start, drag: null, raf: 0, shown: -1, held: 0, hold: null };
    const label = i => { if (pk.shown === i) return; pk.shown = i; name.textContent = L[i].name; who.textContent = L[i].who; lbl.textContent = `Hold to wear ${L[i].name}`; [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i)); };
    const W = () => H.device.getBoundingClientRect().width || 400;
    const tick = () => {
      pk.raf = 0; if (!picking) return;
      if (!pk.drag) { const d = pk.target - pk.pos; pk.pos += d * .2; if (Math.abs(d) < .001) pk.pos = pk.target; }
      S.preview(pk.pos); label(Math.max(0, Math.min(N - 1, Math.round(pk.pos))));
      if (pk.drag || pk.pos !== pk.target) pk.raf = requestAnimationFrame(tick);
    };
    const kick = () => { if (!pk.raf) pk.raf = requestAnimationFrame(tick); };
    pk.kick = kick; pk.go = i => { pk.target = Math.max(0, Math.min(N - 1, i)); kick(); };
    label(Math.round(start)); kick();
    pk.holdStart = holdStart; pk.holdEnd = holdEnd; pk.els = { wear, fill };
    if (!pkBound) {
      pkBound = true;
      root.addEventListener('pointerdown', e => {
        e.stopPropagation(); if (!picking) return;
        const d = e.target.closest('[data-sk]'); if (d) { pk.go(+d.dataset.sk); return; }
        if (e.target.closest('.sk-wear')) return pk.holdStart(e);
        pk.drag = { x0: e.clientX, p0: pk.pos, lx: e.clientX, lt: performance.now(), v: 0 }; root.setPointerCapture(e.pointerId); kick();
      });
      root.addEventListener('pointermove', e => {
        e.stopPropagation();
        // A sideways drag that starts on the Wear button is browsing, not wearing.
        if (pk && pk.hold && Math.abs(e.clientX - pk.hx) > 12) { cancelAnimationFrame(pk.hold); pk.hold = null; pk.els.wear.classList.remove('held'); pk.els.fill.style.transform = 'scaleX(0)'; pk.drag = { x0: e.clientX, p0: pk.pos, lx: e.clientX, lt: performance.now(), v: 0 }; kick(); }
        const g = pk && pk.drag; if (!g) return; const now = performance.now();
        g.v = (e.clientX - g.lx) / Math.max(1, now - g.lt) * .8 + g.v * .2; g.lx = e.clientX; g.lt = now;
        let raw = g.p0 - (e.clientX - g.x0) / W(); const n = window.WosSkin.list.length;
        if (raw < 0) raw *= .3; if (raw > n - 1) raw = n - 1 + (raw - n + 1) * .3;
        pk.pos = pk.target = raw; if (Math.abs(e.clientX - g.x0) > 14) $('.sk-hint', el).style.visibility = 'hidden';
      });
      const end = e => {
        e.stopPropagation(); if (pk && pk.hold) return pk.holdEnd();
        const g = pk && pk.drag; if (!g) return; pk.drag = null; const base = Math.round(g.p0), dx = e.clientX - g.x0;
        pk.go(Math.abs(g.v) > .35 && Math.abs(dx) > 20 ? base + (g.v < 0 ? 1 : -1) : Math.round(pk.pos));
      };
      root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
      root.addEventListener('click', e => e.stopPropagation());
    }
    function holdStart(e) {
      wear.setPointerCapture(e.pointerId); wear.classList.add('held'); const t0 = performance.now(); pk.hx = e.clientX; H.vib(6);
      const step_ = () => { const p = Math.min(1, (performance.now() - t0) / 700); fill.style.transform = `scaleX(${p})`; if (p >= 1) return choose(); pk.hold = requestAnimationFrame(step_); };
      pk.hold = requestAnimationFrame(step_); pk.t0 = t0;
    }
    function holdEnd() {
      cancelAnimationFrame(pk.hold); pk.hold = null; wear.classList.remove('held');
      if (performance.now() - pk.t0 < 280) nudgePick('Press and hold to wear it');
      fill.style.transition = 'transform .25s'; fill.style.transform = 'scaleX(0)'; setTimeout(() => { fill.style.transition = ''; }, 260);
    }
    function choose() {
      cancelAnimationFrame(pk.hold); pk.hold = null; wear.classList.remove('held');
      const id = S.commit(pk.pos); picked = true; H.vib(20); log('skin:' + id);
      const f = $('.sk-flash', el); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
      H.toast('✦', `Wearing ${L[S.index(id)].name}`, 1600);
      later(() => { fill.style.transform = 'scaleX(0)'; if (picking) go(1); }, 700);
    }
  }
  function nudgePick(t) { const h = $('.sk-hint', el); if (!h) return; h.style.visibility = ''; h.textContent = t; later(() => { if (picking) h.textContent = 'Swipe to try them on'; }, 1800); }
  /* Leaving the picker without choosing (skip / Back) puts back the skin that was on before. */
  function unpick(restore) {
    picking = false; if (el) el.classList.remove('tr-pick');
    if (pk) { cancelAnimationFrame(pk.raf); pk.raf = 0; pk.drag = null; }
    if (restore && window.WosSkin) { const c = window.WosSkin.chosen; window.WosSkin.preview(window.WosSkin.index(c || 'nebula')); }
  }

  const active = () => !!(el && (step > 0 || picking));
  // While the tour runs, only the orb, the voice controls and the tour itself take taps.
  const allowed = t => !!(t.closest && t.closest('.tour, #orbWrap, #voice, .arc, #txChips, .help-sheet, #dock, #inbox'));
  window.addEventListener('pointerdown', e => { if (active() && !allowed(e.target)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  window.addEventListener('click', e => { if (active() && !allowed(e.target)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

  function start(why) {
    if (!H) return false;
    closeHelp(); H.prepare();
    if (!el) build();
    typed = !!(H.noMic && H.noMic()); misses = 0;
    el.hidden = false; el.classList.add('on'); H.device.classList.add('touring'); log('start:' + (why || ''));
    picked = false;
    if (window.WosSkin && (why === 'skin' || ((why === 'first-run' || why === 'link') && !window.WosSkin.chosen))) pick(); else go(1);
    return true;
  }
  function finish(how) {
    if (!el) return;
    clearTimers(); log('finish:' + how);
    if (picking) unpick(true);
    step = 0; inbox = false; busy = false; mark();
    H.orbWrap.classList.remove('tr-pulse');
    el.classList.remove('on'); H.device.classList.remove('touring');
    const e0 = el; el = null; setTimeout(() => e0.remove(), 300);
    if (how === 'skip') H.toast('?', 'Say “help” any time to see the gestures', 2600);
  }
  /* Back: one step back. In beat 3 with the inbox open, Back closes it: that is the success. */
  function back() {
    if (helpEl) { closeHelp(); return 'help'; }
    if (!active()) return '';
    if (el.classList.contains('tr-live')) return ''; // recording: Back navigates as always, the tour stays
    if (picking) { finish('skip'); return 'tour-skip'; }
    if (step === 1) { if (picked) { pick(); return 'tour-step'; } finish('skip'); return 'tour-skip'; }
    if (step === 2) { go(1); return 'tour-step'; }
    if (step === 3) { if (inbox) { H.closeSheets(); return 'tour-step'; } go(2); return 'tour-step'; }
    finish('done'); return 'tour-done';
  }

  /* ---------------- Help sheet (re-entry) ---------------- */
  const HELP = [
    { k: 'tap', a: 'Tap the orb', b: 'Talk to your Wizard. Tap again to send.', say: ['What did we ship this week?'] },
    { k: 'hold', a: 'Hold the orb', b: 'A command for the phone. It opens on the desk next door.', say: () => [cmd(), 'Show me last week', 'Next desk'] },
    { k: 'down', a: 'Swipe the orb', b: '↓ Inbox · ↑ every app · ← → between desks.' },
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
      <button type="button" class="hs-go" data-hsgo>Practice again</button>${window.WosSkin ? '<button type="button" class="hs-go hs-skin" data-hsskin>Change skin</button>' : ''}</div>`;
    helpEl.addEventListener('click', e => {
      if (e.target.closest('[data-hsx]') || e.target === helpEl) return closeHelp();
      if (e.target.closest('[data-hsgo]')) { closeHelp(); return start('help'); }
      if (e.target.closest('[data-hsskin]')) { closeHelp(); return start('skin'); }
      const s = e.target.closest('[data-hsay]'); if (s) { closeHelp(); H.say(s.dataset.hsay, s.dataset.hkind); }
    });
    H.device.appendChild(helpEl); void helpEl.offsetWidth; helpEl.classList.add('open'); log('help:open');
  }
  function closeHelp() { if (!helpEl) return false; const h = helpEl; helpEl = null; h.classList.remove('open'); setTimeout(() => h.remove(), 260); log('help:close'); return true; }
  const HELP_RE = /^(help|help me|show (me )?(the )?help|gestures|show (me )?(the )?gestures|how does (this|wizard) work|how do i use (this|wizard)|tutorial|show (me )?the tutorial|practice again)[.!?]*$/i;

  window.WosTour = {
    attach(host) { H = host; },
    start, finish, back, event, openHelp, closeHelp, _go: n => active() && go(n),
    isHelp: t => HELP_RE.test(String(t || '').trim()),
    get active() { return active(); }, get step() { return step; }, get picking() { return picking; }, pick: () => active() && pick(), get helpOpen() { return !!helpEl; }, get typed() { return typed; },
    done, mark,
  };
})();
