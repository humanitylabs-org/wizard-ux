/* Wizard OS — Live Mode (preview slice).
 *
 * The orb is Live Mode's ears: in ambient listening, faint words drift up around it.
 * When speech carries an action, a "Wizard noticed" card rises from the orb; the
 * thumb signs it through the phone's own fingerprint sheet (WebAuthn platform
 * authenticator), it is sent to Archimedes, and it becomes a moon (violet working,
 * green done). Spreading two fingers on Home shows today's ideas; spread again for detail.
 *
 * Seams (stable, for the Mizel live-mode thread to plug its real feed into):
 *   LiveMode.feed({ type: 'words', text })                     drifting speech
 *   LiveMode.feed({ type: 'action', title, said, detail, source }) rises a card
 *   LiveMode.addMoon({ title, sessionId?, source })             a moon that tracks a thread
 *   LiveMode.setAmbient(true|false)                              orb ambient state
 * Until that feed exists, a simulated feed runs behind a visible "preview" label, and
 * preview actions never reach Archimedes (the fingerprint sheet is real; the send is not).
 */
(function () {
  const W = window;
  const q = new URLSearchParams(location.search);
  // On in the isolated preview path, or with ?livemode=1; the live shell stays untouched.
  const ON = /\/wizard-os-home-preview\//.test(location.pathname) || q.get('livemode') === '1';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vib = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const wos = () => W.__wos;

  let raf = 0;
  const LM = W.LiveMode = {
    on: ON, ambient: false, card: null, ideas: 0, moons: [], log: [], signing: false,
    signedVia: '',
    get words() { try { return floaters.length; } catch (e) { return 0; } }, get hint() { try { return hintEl.textContent; } catch (e) { return ''; } },
  };
  if (!ON) { LM.back = () => null; LM.feed = () => {}; LM.addMoon = () => {}; LM.setAmbient = () => {}; return; }

  /* ---------- DOM: word layer, card layer above the orb, moons, hint, ideas ---------- */
  const shell = $('#device') || document.body;
  shell.insertAdjacentHTML('beforeend', `
    <canvas id="lmWords" class="lm-words" aria-hidden="true"></canvas>
    <button id="lmPill" class="lm-pill" aria-label="Live Mode: listening. Tap to pause"><i></i><span>Live</span><small>preview · simulated listening</small></button>
    <div id="lmLayer" class="lm-layer" aria-live="polite">
      <div id="lmCard" class="lm-card" role="dialog" aria-label="Wizard noticed">
        <button class="lm-x" data-lm="dismiss" aria-label="Not now">✕</button>
        <div class="k">Wizard noticed</div>
        <div class="m" id="lmTitle"></div>
        <div class="s" id="lmSaid"></div>
        <button id="lmPrint" class="lm-print" aria-label="Touch the print to send">
          <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="rgba(185,168,255,.18)" stroke-width="3"/>
            <circle id="lmRing" cx="50" cy="50" r="46" fill="none" stroke="#b9a8ff" stroke-width="3" stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="289" transform="rotate(-90 50 50)"/>
            <g fill="none" stroke="#9d7bff" stroke-width="2.4" stroke-linecap="round"><path d="M36 62c0-12 5-22 14-22s14 10 14 22"/><path d="M42 66c0-10 2-18 8-18s8 8 8 18"/><path d="M50 56v14"/><path d="M30 56c1-16 9-26 20-26s19 10 20 26"/></g></svg>
        </button>
      </div>
    </div>
    <div id="lmHint" class="lm-hint"></div>
    <section id="lmIdeas" class="lm-ideas" aria-label="Today's ideas"><div class="lm-ideas-top"><span class="k">Today</span><h2>Ideas</h2></div><div id="lmIdeasList" class="lm-ideas-list"></div></section>`);
  $('#orbWrap')?.insertAdjacentHTML('beforeend', '<div id="lmMoons" class="lm-moons"></div>');
  shell.classList.add('lm-on');
  const C = $('#lmWords'), X = C.getContext('2d'), card = $('#lmCard'), hintEl = $('#lmHint'), ring = $('#lmRing'), ideasEl = $('#lmIdeas');

  /* ---------- sound (prototype chimes), made on first gesture ---------- */
  let A = null, master = null;
  const audio = () => { if (A) return; try { A = new (W.AudioContext || W.webkitAudioContext)(); master = A.createGain(); master.gain.value = .35; master.connect(A.destination); } catch (e) {} };
  addEventListener('pointerdown', audio, { once: true, capture: true });
  function chime(f = 660, d = 1.6, v = .16) {
    if (!A) return; const t = A.currentTime;
    [1, 1.5, 2].forEach((m, i) => { const o = A.createOscillator(), g = A.createGain(); o.type = 'sine'; o.frequency.value = f * m;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v / (i + 1), t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g).connect(master); o.start(t); o.stop(t + d); });
  }

  /* ---------- hints: one plain pulsing line for every step ---------- */
  let hintKey = '', holdUntil = 0;
  function hint(key, text) { hintKey = key; if (key === 'sent') holdUntil = Date.now() + 3500; hintEl.textContent = text || ''; hintEl.classList.toggle('on', !!text); hintEl.dataset.k = key; }
  function ambientHint() {
    if (Date.now() < holdUntil && !LM.card) return;
    if (LM.card) return hint('card', 'touch the print to send');
    if (LM.ideas) return hint('ideas', LM.ideas === 1 ? 'spread again for detail · Back to return' : 'Back to return home');
    const w = wos(); if (!w) return;
    if (w.idx === w.HOME && !w.desks[w.HOME].wins.length && !w.sheet) return hint('home', 'spread two fingers \u00b7 today\u2019s ideas');
    hint('', '');
  }

  /* ---------- drifting words around the orb ---------- */
  let floaters = [], DPR = 1, CW = 0, CH = 0;
  const rs = () => { DPR = Math.min(W.devicePixelRatio || 1, 2); CW = innerWidth; CH = innerHeight; C.width = Math.round(CW * DPR); C.height = Math.round(CH * DPR); X.setTransform(DPR, 0, 0, DPR, 0, 0); };
  rs(); addEventListener('resize', rs);
  function orbXY() { const r = $('#orbWrap')?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: CW / 2, y: CH - 90 }; }
  function spawnWord(text, hot) {
    const o = orbXY(), side = Math.random() < .5 ? -1 : 1;
    if (hot) floaters.push({ w: text, x: o.x, y: o.y - 120, vx: 0, vy: -.15, life: 20, hot: true });
    else {
      // Few and spaced: pick the free lane in the open wallpaper band, furthest from words already showing.
      const lanes = [.34, .39, .44, .49, .54], used = floaters.filter(f => !f.hot).map(f => f.y / CH);
      const lane = lanes.map(l => [l, Math.min(1, ...used.map(u => Math.abs(u - l)))]).sort((a, b) => b[1] - a[1])[0][0];
      floaters.push({ w: text, x: CW * (.3 + Math.random() * .4), y: CH * lane, vx: side * (.08 + Math.random() * .08), vy: -.08, life: 0, hot: false });
    }
    const calm = floaters.filter(f => !f.hot); if (calm.length > 4) floaters.splice(floaters.indexOf(calm[0]), 1);
  }
  function draw() {
    // Android Chrome can drop and restore a 2D canvas (memory pressure), which resets its transform: reapply every frame.
    if (C.width !== Math.round(CW * DPR)) rs(); else X.setTransform(DPR, 0, 0, DPR, 0, 0);
    X.clearRect(0, 0, CW, CH);
    const busy = wos()?.voice && wos().voice !== 'idle';
    X.textAlign = 'center';
    floaters = floaters.filter(f => {
      f.life++; f.x += f.vx; f.y += f.vy;
      const o = orbXY();
      if (f.gather) { f.x += (o.x - f.x) * .08; f.y += (o.y - f.y) * .08; }
      const a = Math.min(1, f.life / 40) * Math.max(0, 1 - (f.life - 300) / 120) * (busy ? .25 : 1);
      X.font = f.hot ? '500 16px system-ui, sans-serif' : '300 14px system-ui, sans-serif';
      X.fillStyle = f.hot ? `rgba(233,226,255,${a})` : `rgba(170,158,215,${a * .5})`;
      X.fillText(f.w, Math.max(X.measureText(f.w).width / 2 + 12, Math.min(CW - X.measureText(f.w).width / 2 - 12, f.x)), f.y);
      return f.life < 420 && f.y > -20 && !(f.gather && Math.hypot(o.x - f.x, o.y - f.y) < 12);
    });
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  /* ---------- ambient state on the orb ---------- */
  LM.setAmbient = on => {
    LM.ambient = !!on; const ow = $('#orbWrap'); if (ow) ow.dataset.ambient = on ? 'live' : '';
    $('#lmPill').classList.toggle('paused', !on); $('#lmPill span').textContent = on ? 'Live' : 'Paused';
    on ? sim.start() : sim.stop(); ambientHint();
  };
  $('#lmPill').addEventListener('click', () => { LM.setAmbient(!LM.ambient); vib(8); });

  /* ---------- the "Wizard noticed" card ---------- */
  function openCard(item) {
    LM.card = item; LM.log.push('card');
    $('#lmTitle').textContent = item.title; $('#lmSaid').textContent = item.said ? `\u201c${item.said}\u201d` : 'from what you just said';
    ring.style.strokeDashoffset = 289; card.classList.remove('gone', 'sent'); card.dataset.src = item.source || 'feed';
    const o = orbXY(); $('#lmLayer').style.setProperty('--oy', `${o.y}px`);
    requestAnimationFrame(() => { $('#lmLayer').classList.add('open'); card.classList.add('on'); });
    chime(523, 2.2, .12); vib(30); ambientHint();
  }
  function closeCard(sent) {
    if (!LM.card) return false;
    LM.card = null; LM.signing = false; cancelAnimationFrame(raf); card.classList.remove('on'); card.classList.add(sent ? 'sent' : 'gone');
    setTimeout(() => { $('#lmLayer').classList.remove('open'); card.classList.remove('gone', 'sent'); }, 900);
    ambientHint(); return true;
  }
  card.addEventListener('click', e => { if (e.target.closest('[data-lm="dismiss"]')) { closeCard(false); vib(8); } });

  /* ---------- signing: a UX mockup thumbprint (James: no real fingerprint / WebAuthn) ----------
   * A quick tap or a ~300 ms hold fills the ring and signs. The whole print area is the target. */
  const print = $('#lmPrint');
  const HOLD_MS = 300;
  let hs = 0, down = false;
  const setRing = p => { ring.style.strokeDashoffset = 289 * (1 - p); };
  const fill = (from, ms, via) => {
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, from + (performance.now() - t0) / ms * (1 - from)); setRing(p);
      if (p < 1) raf = requestAnimationFrame(step); else { LM.signing = false; LM.signedVia = via; signed(); }
    };
    cancelAnimationFrame(raf); raf = requestAnimationFrame(step);
  };
  print.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    if (!LM.card || LM.signing) return;
    down = true; hs = performance.now(); vib(12); print.classList.add('pressing');
    LM.signing = true; fill(0, HOLD_MS, 'hold');
  });
  const up = () => {
    if (!down) return; down = false; print.classList.remove('pressing');
    // Released early: it was a tap. Finish the fill quickly and sign anyway.
    if (LM.signing && performance.now() - hs < HOLD_MS) { const p = Math.min(1, (performance.now() - hs) / HOLD_MS); fill(p, 140, 'tap'); }
  };
  ['pointerup', 'pointercancel'].forEach(ev => print.addEventListener(ev, up));
  print.addEventListener('click', e => e.stopPropagation());
  print.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && LM.card && !LM.signing) { e.preventDefault(); LM.signing = true; fill(0, 160, 'tap'); } });

  async function signed() {
    const item = LM.card; if (!item) return;
    ring.style.strokeDashoffset = 0; chime(784, 2.6, .18); vib([20, 40, 60]);
    const moon = LM.addMoon({ title: item.title, source: item.source });
    closeCard(true); LM.log.push('sent');
    if (item.source === 'preview') { moon.state = 'working'; setTimeout(() => { moon.state = 'done'; renderMoons(); }, 6000); hint('sent', 'preview \u00b7 not sent to Archimedes \u00b7 watch its moon'); }
    else {
      try {
        const ctx = `Sent from Wizard OS Live Mode: James signed this with the thumbprint after Wizard noticed it in live speech.${item.said ? ` He said: "${item.said}".` : ''}${item.detail ? ` Detail: ${item.detail}` : ''}`;
        const r = await wos().live.send(item.title, { instructions: ctx });
        moon.sessionId = r.sessionId; hint('sent', 'sent to Archimedes \u00b7 watch its moon');
      } catch (err) { moon.state = 'failed'; hint('sent', 'couldn\u2019t send \u00b7 it\u2019s kept as a moon, tap to retry'); moon.retry = item; }
    }
    renderMoons(); setTimeout(ambientHint, 3200);
  }

  /* ---------- moons: sent actions orbit the orb ---------- */
  LM.addMoon = m => { const moon = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), state: 'working', ...m }; LM.moons.unshift(moon); LM.moons = LM.moons.slice(0, 6); renderMoons(); return moon; };
  function moonState(m) {
    if (!m.sessionId) return m.state;
    const s = wos()?.live?.session?.(m.sessionId); if (!s) return m.state;
    return ['running', 'queued', 'started', 'submitting', 'working'].includes(s.status) ? 'working' : 'done';
  }
  function renderMoons() {
    const el = $('#lmMoons'); if (!el) return;
    el.innerHTML = LM.moons.map((m, k) => { const st = moonState(m); m.shown = st; const a = (k / Math.max(LM.moons.length, 1)) * Math.PI * 2 + Math.PI / 4, r = 50;
      return `<i class="lm-moon ${st}" data-moon="${m.id}" title="${esc(m.title)}" style="transform:translate(${(Math.cos(a) * r).toFixed(1)}px,${(Math.sin(a) * r).toFixed(1)}px)"></i>`; }).join('');
  }
  setInterval(renderMoons, 3000);

  /* ---------- spread on Home: today's ideas (one level deeper per spread) ---------- */
  // Plain sentence only: drop system/out-of-band markers and markdown noise.
  const clean = v => { let x = String(v || '').replace(/\[[A-Z][A-Z \-\u2014,;:'()]{6,}[^\]]*\]/g, ' ').replace(/[#*_`>]+/g, ' ').replace(/\s+/g, ' ').trim();
    return x.length > 150 ? x.slice(0, 147).replace(/\s\S*$/, '') + '\u2026' : x; };
  function todayIdeas() {
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const fromMoons = LM.moons.map(m => ({ t: m.title, d: m.source === 'preview' ? 'Noticed in Live Mode · preview' : 'Noticed in Live Mode · sent to Archimedes', c: 'var(--violet-2)' }));
    const ss = (wos()?.live?.sessions || []).filter(s => Date.parse(s.lastUserAt || s.updatedAt) >= day.getTime())
      .slice(0, 12).map(s => { const at = new Date(Date.parse(s.lastUserAt || s.updatedAt)); const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
        const pv = clean(s.preview); // agent-to-agent notes are plumbing, not ideas
        return { t: s.title || 'Untitled', d: /^(cross-thread|kick-off from|\[|<)/i.test(pv) || !pv ? `Thread \u00b7 ${hm}` : `${hm} \u00b7 ${pv}`, c: 'var(--cyan)', id: s.id }; });
    const all = [...fromMoons, ...ss];
    return all.length ? all : [{ t: 'Nothing yet today', d: 'Talk with Live Mode on and ideas collect here.', c: 'var(--ink-3)' }];
  }
  function openIdeas(level) {
    LM.ideas = Math.min(2, level); LM.log.push('ideas' + LM.ideas);
    $('#lmIdeasList').innerHTML = todayIdeas().map(x => `<button class="zi" ${x.id ? `data-thread="${esc(x.id)}"` : ''} style="--c:${x.c}"><span class="t">${esc(x.t)}</span><small>${esc(x.d)}</small></button>`).join('');
    ideasEl.classList.add('on'); ideasEl.classList.toggle('deep', LM.ideas >= 2); chime(440, 1.6, .08); vib(10); ambientHint();
  }
  function closeIdeas() { if (!LM.ideas) return false; if (LM.ideas === 2) { LM.ideas = 1; ideasEl.classList.remove('deep'); ambientHint(); return 'ideas-shallow'; } LM.ideas = 0; ideasEl.classList.remove('on', 'deep'); ambientHint(); return 'ideas'; }
  ideasEl.addEventListener('click', e => { const b = e.target.closest('[data-thread]'); if (b) { LM.ideas = 1; closeIdeas(); wos().openWizardThread(b.dataset.thread); } else if (LM.ideas === 1) openIdeas(2); });
  LM.openIdeas = openIdeas;
  let d0 = 0;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onHome = () => { const w = wos(); return w && w.idx === w.HOME && !w.desks[w.HOME].wins.length && !w.sheet && !LM.card; };
  addEventListener('touchstart', e => { if (e.touches.length === 2 && (onHome() || LM.ideas)) d0 = dist(e.touches); }, { passive: true, capture: true });
  addEventListener('touchmove', e => { if (!d0 || e.touches.length !== 2) return; const dd = dist(e.touches) - d0;
    if (dd > 50) { d0 = 0; openIdeas(LM.ideas + 1); } else if (dd < -50 && LM.ideas) { d0 = 0; closeIdeas(); } }, { passive: true, capture: true });
  addEventListener('touchend', () => { d0 = 0; }, { capture: true });

  /* ---------- Back: card → closed; deep ideas → shallow → Home ---------- */
  LM.back = () => { if (LM.card) { closeCard(false); return 'live-card'; } return closeIdeas() || null; };

  /* ---------- the feed ---------- */
  LM.feed = ev => {
    if (!ev) return;
    if (ev.type === 'words' && LM.ambient) spawnWord(ev.text);
    if (ev.type === 'action') {
      if (LM.card) return; // one card at a time
      const hot = { w: ev.said ? `\u2026${ev.said}\u2026` : ev.title, gather: false };
      spawnWord(hot.w, true); const f = floaters[floaters.length - 1];
      setTimeout(() => { if (f) f.gather = true; $('#orbWrap')?.classList.add('lm-noticed'); setTimeout(() => $('#orbWrap')?.classList.remove('lm-noticed'), 1200); }, 1400);
      setTimeout(() => openCard({ title: ev.title, said: ev.said, detail: ev.detail, source: ev.source || 'feed' }), 2400);
    }
  };
  /* Simulated listening until the Mizel live-mode feed exists (clearly labelled preview). */
  const WORDS = ['\u2026so Miguel switched to Opus\u2026', '\u2026the sigils\u2026', '\u2026movement, not a company\u2026', '\u2026Beelink could build one\u2026',
    '\u2026pinch to zoom\u2026', '\u2026the rectangle\u2026', '\u2026meet you wherever you are\u2026', '\u2026desk dots\u2026', '\u2026topics on the left\u2026'];
  const ACTIONS = [{ title: 'Send the sigil board \u2192 Miguel', said: 'send Miguel the sigil board' }, { title: 'Pin Topics to desk 4', said: 'put Topics on the left desk' }];
  const sim = {
    t: null, a: null, n: 0,
    start() { this.stop(); this.t = setInterval(() => { if (!document.hidden) LM.feed({ type: 'words', text: WORDS[Math.floor(Math.random() * WORDS.length)] }); }, 2300);
      this.a = setInterval(() => { if (!document.hidden && !LM.card && !LM.ideas && LM.ambient && !(wos()?.voice !== 'idle') && !wos()?.sheet) LM.feed({ type: 'action', source: 'preview', ...ACTIONS[this.n++ % ACTIONS.length] }); }, 26000); },
    stop() { clearInterval(this.t); clearInterval(this.a); },
  };
  LM.pauseSim = () => { sim.stop(); clearTimeout(LM._simT); };
  LM.simulate = () => LM.feed({ type: 'action', source: 'preview', ...ACTIONS[sim.n++ % ACTIONS.length] });

  // Start once the shell is up.
  const boot = () => { if (!wos()) return setTimeout(boot, 200); LM.setAmbient(true); setInterval(ambientHint, 1500); LM._simT = setTimeout(() => LM.simulate(), 9000); };
  boot();
})();
