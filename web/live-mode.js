/* Wizard OS — Live Mode (preview slice), built on the shared Wizard Motion Kit (motion/wizard-motion.js).
 *
 * The orb is Live Mode's ears: in ambient listening, faint words drift up around it.
 * When speech carries an action, a "Wizard noticed" card rises from the orb; a quick tap or
 * a ~300 ms hold on the thumbprint (a UX mockup, no real fingerprint) signs it, it is sent to
 * Archimedes, and it becomes a moon (violet working, green done). Spreading two fingers on
 * Home shows today's ideas; spread again for detail.
 *
 * Seams (stable, for the Mizel live-mode thread to plug its real feed into):
 *   LiveMode.feed({ type: 'words', text })                        drifting speech
 *   LiveMode.feed({ type: 'action', title, said, detail, source }) rises a card
 *   LiveMode.addMoon({ title, sessionId?, source })                a moon that tracks a thread
 *   LiveMode.setAmbient(true|false)                                 orb ambient state
 * Until that feed exists, a simulated feed runs behind a visible "preview" label, and
 * preview actions never reach Archimedes.
 */
(function () {
  const W = window;
  const q = new URLSearchParams(location.search);
  // On in the isolated preview path, or with ?livemode=1; the live shell stays untouched.
  const ON = /\/wizard-os-home-preview\//.test(location.pathname) || q.get('livemode') === '1';
  // Simulated listening, the Live pill and coaching hints only run on an explicit ?demo=1.
  // Without it Live Mode is quiet: real feed events, the card, moons and spread-for-ideas only.
  const DEMO = q.get('demo') === '1';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wos = () => W.__wos;
  const M = W.WizardMotion;

  let words = null, hintUI = null;
  const LM = W.LiveMode = {
    on: ON, demo: DEMO, ambient: false, card: null, ideas: 0, moons: [], log: [], signing: false, signedVia: '',
    get words() { return words ? words.count : 0; }, get hint() { return hintUI ? hintUI.text : ''; },
  };
  if (!ON || !M) { LM.back = () => null; LM.feed = () => {}; LM.addMoon = () => {}; LM.setAmbient = () => {}; return; }

  /* ---------- DOM: word layer, card layer above the orb, moons, hint, ideas ---------- */
  const shell = $('#device') || document.body;
  shell.insertAdjacentHTML('beforeend', `
    <canvas id="lmWords" class="wm-words lm-words" aria-hidden="true"></canvas>
    ${DEMO ? '<button id="lmPill" class="wm-pill lm-pill" aria-label="Live Mode demo: listening. Tap to pause"><i></i><span>Live</span><small>demo · simulated</small></button>' : ''}
    <div id="lmLayer" class="wm-layer lm-layer" aria-live="polite">
      <div id="lmCard" class="wm-card" role="dialog" aria-label="Wizard noticed">
        <button class="lm-x" data-lm="dismiss" aria-label="Not now">✕</button>
        <div class="wm-k">Wizard noticed</div>
        <div class="wm-m" id="lmTitle"></div>
        <div class="wm-s" id="lmSaid"></div>
        <button id="lmPrint" aria-label="Touch the print to send">
          <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="rgba(185,168,255,.18)" stroke-width="3"/>
            <circle id="lmRing" cx="50" cy="50" r="46" fill="none" stroke="#b9a8ff" stroke-width="3" stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="289" transform="rotate(-90 50 50)"/>
            <g fill="none" stroke="#9d7bff" stroke-width="2.4" stroke-linecap="round"><path d="M36 62c0-12 5-22 14-22s14 10 14 22"/><path d="M42 66c0-10 2-18 8-18s8 8 8 18"/><path d="M50 56v14"/><path d="M30 56c1-16 9-26 20-26s19 10 20 26"/></g></svg>
        </button>
      </div>
    </div>
    <div id="lmHint" class="wm-hint lm-hint"></div>
    <section id="lmIdeas" class="wm-zoom lm-ideas" aria-label="Today's ideas"><div class="lm-ideas-top"><span class="k">Today</span><h2>Ideas</h2></div><div id="lmIdeasList"></div></section>`);
  shell.classList.add('lm-on');
  const ideasEl = $('#lmIdeas'), orbWrap = $('#orbWrap');
  const orbXY = () => { const r = orbWrap?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight - 90 }; };

  words = M.words($('#lmWords'), { anchor: orbXY, dim: () => wos()?.voice && wos().voice !== 'idle' });
  hintUI = M.hint($('#lmHint'));
  const orbFx = M.orb(orbWrap);
  const cardFx = M.card($('#lmCard'), $('#lmLayer'));
  const moonFx = orbWrap ? M.moons(orbWrap, { radius: Math.round((orbWrap.offsetWidth || 44) / 2 + 13) }) : { set() {} };
  moonFx.el && (moonFx.el.id = 'lmMoons');

  /* ---------- hints: one plain pulsing line for every step ---------- */
  function ambientHint() {
    if (LM.card) return hintUI.show('touch the print to send', 'card', 0, true);
    if (LM.ideas) return hintUI.show(LM.ideas === 1 ? 'spread again for detail · Back to return' : 'Back to return home', 'ideas');
    const w = wos(); if (!w) return;
    if (DEMO && w.idx === w.HOME && !w.desks[w.HOME].wins.length && !w.sheet) return hintUI.show('spread two fingers \u00b7 today\u2019s ideas', 'home');
    hintUI.clear();
  }

  /* ---------- ambient state on the orb ---------- */
  LM.setAmbient = on => {
    LM.ambient = !!on; orbFx.set(on ? 'live' : '');
    const pill = $('#lmPill'); if (pill) { pill.classList.toggle('paused', !on); pill.querySelector('span').textContent = on ? 'Live' : 'Paused'; }
    on && DEMO ? sim.start() : sim.stop(); ambientHint();
  };
  $('#lmPill')?.addEventListener('click', () => { LM.setAmbient(!LM.ambient); M.haptic('soft'); });

  /* ---------- the "Wizard noticed" card ---------- */
  function openCard(item) {
    LM.card = item; LM.log.push('card');
    $('#lmTitle').textContent = item.title; $('#lmSaid').textContent = item.said ? `\u201c${item.said}\u201d` : 'from what you just said';
    sign.reset(); $('#lmCard').dataset.src = item.source || 'feed';
    cardFx.rise(); M.chime('notice'); M.haptic('notice'); ambientHint();
  }
  function closeCard(sent) {
    if (!LM.card) return false;
    LM.card = null; LM.signing = false; sign.reset(); cardFx.sink(sent); ambientHint(); return true;
  }
  $('#lmCard').addEventListener('click', e => { if (e.target.closest('[data-lm="dismiss"]')) { closeCard(false); M.haptic('soft'); } });

  /* ---------- signing: a UX mockup thumbprint (James: no real fingerprint / WebAuthn) ----------
   * A quick tap or a ~300 ms hold fills the ring and signs. The whole print area is the target. */
  const sign = M.signRing($('#lmPrint'), $('#lmRing'), {
    holdMs: 300, enabled: () => !!LM.card,
    onSign: via => { LM.signing = false; LM.signedVia = via; signed(); },
  });
  $('#lmPrint').addEventListener('pointerdown', () => { if (LM.card) LM.signing = true; });

  async function signed() {
    const item = LM.card; if (!item) return;
    M.chime('sent');
    const moon = LM.addMoon({ title: item.title, source: item.source });
    closeCard(true); LM.log.push('sent');
    if (item.source === 'preview') { moon.state = 'working'; setTimeout(() => { moon.state = 'done'; renderMoons(); }, 6000); hintUI.show(`preview \u00b7 not sent to ${window.WizConfig.agent()} \u00b7 watch its moon`, 'sent', 3500); }
    else {
      try {
        const ctx = `Sent from Wizard OS Live Mode: ${window.WizConfig.owner() || 'The user'} signed this with the thumbprint after Wizard noticed it in live speech.${item.said ? ` They said: "${item.said}".` : ''}${item.detail ? ` Detail: ${item.detail}` : ''}`;
        const r = await wos().live.send(item.title, { instructions: ctx });
        moon.sessionId = r.sessionId; hintUI.show(`sent to ${window.WizConfig.agent()} \u00b7 watch its moon`, 'sent', 3500);
      } catch (err) { moon.state = 'failed'; moon.retry = item; hintUI.show('couldn\u2019t send \u00b7 it\u2019s kept as a moon', 'sent', 3500); M.haptic('error'); }
    }
    renderMoons(); setTimeout(ambientHint, 3600);
  }

  /* ---------- moons: sent actions orbit the orb ---------- */
  LM.addMoon = m => { const moon = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), state: 'working', ...m }; LM.moons.unshift(moon); LM.moons = LM.moons.slice(0, 6); renderMoons(); return moon; };
  function moonState(m) {
    if (!m.sessionId) return m.state;
    const s = wos()?.live?.session?.(m.sessionId); if (!s) return m.state;
    return ['running', 'queued', 'started', 'submitting', 'working'].includes(s.status) ? 'working' : 'done';
  }
  function renderMoons() { moonFx.set(LM.moons.map(m => { m.shown = moonState(m); return { id: m.id, title: m.title, state: m.shown }; })); }
  setInterval(renderMoons, 3000);

  /* ---------- spread on Home: today's ideas (one level deeper per spread) ---------- */
  // Plain sentence only: drop system/out-of-band markers and markdown noise.
  const clean = v => { let x = String(v || '').replace(/\[[A-Z][A-Z \-\u2014,;:'()]{6,}[^\]]*\]/g, ' ').replace(/[#*_`>]+/g, ' ').replace(/\s+/g, ' ').trim();
    return x.length > 150 ? x.slice(0, 147).replace(/\s\S*$/, '') + '\u2026' : x; };
  function todayIdeas() {
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const fromMoons = LM.moons.map(m => ({ t: m.title, d: m.source === 'preview' ? 'Noticed in Live Mode · preview' : `Noticed in Live Mode · sent to ${window.WizConfig.agent()}`, c: 'var(--violet-2)' }));
    const ss = (wos()?.live?.sessions || []).filter(s => Date.parse(s.lastUserAt || s.updatedAt) >= day.getTime())
      .slice(0, 12).map(s => { const at = new Date(Date.parse(s.lastUserAt || s.updatedAt)); const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
        const pv = clean(s.preview); // agent-to-agent notes are plumbing, not ideas
        return { t: s.title || 'Untitled', d: /^(cross-thread|kick-off from|\[|<)/i.test(pv) || !pv ? `Thread \u00b7 ${hm}` : `${hm} \u00b7 ${pv}`, c: 'var(--cyan)', id: s.id }; });
    const all = [...fromMoons, ...ss];
    return all.length ? all : [{ t: 'Nothing yet today', d: 'Talk with Live Mode on and ideas collect here.', c: 'var(--ink-3)' }];
  }
  function openIdeas(level) {
    LM.ideas = Math.min(2, level); LM.log.push('ideas' + LM.ideas);
    $('#lmIdeasList').innerHTML = todayIdeas().map(x => `<button class="wm-zi" ${x.id ? `data-thread="${esc(x.id)}"` : ''} style="--c:${x.c}"><span class="t">${esc(x.t)}</span><small>${esc(x.d)}</small></button>`).join('');
    ideasEl.classList.add('on'); ideasEl.classList.toggle('deep', LM.ideas >= 2); M.chime('open'); ambientHint();
  }
  function closeIdeas() { if (!LM.ideas) return false; if (LM.ideas === 2) { LM.ideas = 1; ideasEl.classList.remove('deep'); ambientHint(); return 'ideas-shallow'; } LM.ideas = 0; ideasEl.classList.remove('on', 'deep'); ambientHint(); return 'ideas'; }
  ideasEl.addEventListener('click', e => { const b = e.target.closest('[data-thread]'); if (b) { LM.ideas = 1; closeIdeas(); wos().openWizardThread(b.dataset.thread); } else if (LM.ideas === 1) openIdeas(2); });
  LM.openIdeas = openIdeas;
  const onHome = () => { const w = wos(); return w && w.idx === w.HOME && !w.desks[w.HOME].wins.length && !w.sheet && !LM.card; };
  M.spread(W, { enabled: () => onHome() || !!LM.ideas, onOut: () => openIdeas(LM.ideas + 1), onIn: () => { if (LM.ideas) closeIdeas(); } });

  /* ---------- Back: card → closed; deep ideas → shallow → Home ---------- */
  LM.back = () => { if (LM.card) { closeCard(false); return 'live-card'; } return closeIdeas() || null; };

  /* ---------- the feed ---------- */
  LM.feed = ev => {
    if (!ev) return;
    if (ev.type === 'words' && LM.ambient) words.add(ev.text);
    if (ev.type === 'action') {
      if (LM.card) return; // one card at a time
      words.hot(ev.said ? `\u2026${ev.said}\u2026` : ev.title);
      setTimeout(() => { words.gather(); orbFx.notice(); }, 1400);
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
  const boot = () => { if (!wos()) return setTimeout(boot, 200); setInterval(ambientHint, 1500); if (DEMO) { LM.setAmbient(true); LM._simT = setTimeout(() => LM.simulate(), 9000); } };
  boot();
})();
