/* Two orbs layout (James, 22 Oct 2026). Opt-in in Settings › Look › Layout; Classic stays the default.
 *
 *   White orb (the dock's, bottom centre): the system. Tap types into the focused text field (dictation only);
 *     hold gives a system command; swipes still move desks and open apps.
 *   Agent orb (bottom right): talks to an agent. It wears the colour of whoever will receive the message:
 *     the agent whose Chats are in front, the agent a thread or app belongs to, else your main agent.
 *     Tap: record for that agent; tap again to send.
 *     Hold, slide onto another agent, let go: recording starts for that agent, for this one message only.
 *     Tap to send. The orb goes back to the screen's own agent afterwards.
 *
 * Everything here goes through the skin hook API (core/skin-host.js); no shell internals. */
export default function setup(api) {
  const HOLD_MS = 360, PICK_R = 46;
  const doc = document;

  const orb = doc.createElement('button');
  orb.type = 'button'; orb.className = 'to-orb'; orb.id = 'agentOrb';
  orb.setAttribute('aria-label', 'Agent orb');
  const face = doc.createElement('span'); face.className = 'to-face';
  const ring = doc.createElement('span'); ring.className = 'to-ring';
  const name = doc.createElement('span'); name.className = 'to-name';
  // The orb itself is the Wizard Everywhere floating orb: a second instance of the shell's orb.js, with Everywhere's
  // mask, size, take timer and processing ring (android/.../assist/everywhere.html), hue-shifted to the agent.
  const glass = doc.createElement('span'); glass.className = 'to-glass'; glass.setAttribute('aria-hidden', 'true');
  const cv = doc.createElement('canvas'); cv.width = 64; cv.height = 64;
  const fb = doc.createElement('img'); fb.alt = ''; fb.hidden = true; fb.src = 'robert-thread-orb.png';
  const proc = doc.createElement('span'); proc.className = 'to-proc';
  const timer = doc.createElement('span'); timer.className = 'to-timer'; timer.textContent = '0:00';
  glass.append(cv, fb, proc, timer);
  orb.append(glass, ring, face, name);

  const arc = doc.createElement('div'); arc.className = 'to-arc'; arc.hidden = true;
  arc.setAttribute('role', 'listbox'); arc.setAttribute('aria-label', 'Choose an agent for this message');
  api.mount(arc); api.mount(orb);
  const eng = api.orb.create(cv, fb, { R: .64 });
  if (eng) eng.setRestingMotion?.(false); else glass.classList.add('flat');
  const T = { mode: 'idle', ms: 0, t0: 0, paused: false };
  const fmt = ms => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const live = m => m === 'listen' || m === 'paused';
  const tick = () => { if (live(T.mode)) { timer.textContent = fmt(T.ms + (T.paused ? 0 : performance.now() - T.t0)); api.after(250, tick); } };
  function glassState(m) {
    if (m === T.mode) return;
    const was = T.mode;
    if (live(m) && !live(was)) { T.ms = 0; T.t0 = performance.now(); T.paused = false; timer.textContent = '0:00'; }
    if (m === 'paused' && !T.paused) { T.ms += performance.now() - T.t0; T.paused = true; }
    if (m === 'listen' && T.paused) { T.paused = false; T.t0 = performance.now(); }
    T.mode = m; glass.dataset.mode = m;
    eng?.setMode(m);
    if (live(m) && !live(was)) tick();
  }

  let shownFor = '', chips = [], G = null;
  // The agent orb hears the microphone during its own take, like the floating orb does.
  api.orb.onLevel(v => { if (doc.documentElement.dataset.toTake) eng?.setLevel(v); });
  /* Lift the agent orb (and everything gathered round it) above a message bar so it never covers Send. */
  function lift() {
    const dock = doc.getElementById('dock'), dev = doc.getElementById('device'); if (!dock || !dev) return;
    const base = dock.getBoundingClientRect().top - 16;
    let top = Infinity;
    for (const c of dev.querySelectorAll('.ch-compose')) {
      const r = c.getBoundingClientRect();
      if (r.height && r.width > 120 && r.bottom > base - 60 && c.offsetParent) top = Math.min(top, r.top);
    }
    const px = Number.isFinite(top) ? Math.max(0, Math.round(base - top + 10)) : 0;
    const v = px + 'px'; if (doc.documentElement.style.getPropertyValue('--to-lift') !== v) doc.documentElement.style.setProperty('--to-lift', v);
  }

  const sigil = (el, id) => {
    const html = api.agents.sigil(id) || '';
    if (el.dataset.sig !== id + '|' + html.length) { el.innerHTML = html; el.dataset.sig = id + '|' + html.length; }
  };
  function paint() {
    const v = api.voice.state();
    const busy = v.state && v.state !== 'idle';
    const here = api.agents.here();
    const list = api.agents.list();
    const take = busy && v.kind !== 'dictation' && v.kind !== 'command' ? list.find(a => a.id === v.agent) : null;
    const who = take || here;
    if (!who) { orb.hidden = true; return; }
    orb.hidden = false;
    orb.style.setProperty('--c', who.colour);
    const hue = /hsl\((\d+)/.exec(who.colour || ''); if (hue) orb.style.setProperty('--h', hue[1]);
    sigil(face, who.id);
    // The whole recording lives on this orb: the shell's controls and transcript gather around it (layout.css).
    const rootEl = doc.documentElement;
    if (take) rootEl.dataset.toTake = v.state; else delete rootEl.dataset.toTake;
    orb.dataset.state = take ? (v.state === 'paused' ? 'paused' : v.state === 'listen' ? 'rec' : 'busy') : busy ? 'other' : 'idle';
    orb.classList.toggle('private', !!who.private);
    const label = take ? (v.state === 'paused' ? 'Paused · tap to resume' : 'To ' + who.label + ' · tap to send')
      : here.why === 'app' ? here.label + ' · for ' + here.app : here.label;
    name.textContent = take ? 'To ' + who.label : here.main ? '' : who.label;
    orb.setAttribute('aria-label', take ? label : `Talk to ${label}. Hold to pick another agent.`);
    shownFor = who.id;
    const gm = take ? (v.state === 'paused' ? 'paused' : v.state === 'listen' ? 'listen' : 'think') : 'idle';
    glassState(gm);
    lift();
  }

  /* ---------- the agent arc ---------- */
  function openArc() {
    const list = api.agents.list().filter(a => a.status !== 'stopped');
    if (list.length < 2) { api.toast('Only one agent on this Wizard'); return false; }
    const here = api.agents.here();
    // Main agent first, then the rest in registry order: same place every time, so the thumb learns it.
    list.sort((a, b) => (b.main - a.main));
    arc.replaceChildren();
    const r = orb.getBoundingClientRect(), host = doc.getElementById('device').getBoundingClientRect();
    const cx = r.left + r.width / 2 - host.left, cy = r.top + r.height / 2 - host.top;
    // A column rising straight up from the orb: the thumb slides up, labels sit to the left, nothing overlaps.
    // Main agent nearest the orb, then the rest in registry order, so each agent keeps its place.
    const gap = list.length > 5 ? 56 : 64;
    chips = list.map((a, i) => {
      const x = cx, y = cy - 74 - i * gap;
      const c = doc.createElement('div'); c.className = 'to-chip'; c.setAttribute('role', 'option');
      c.style.setProperty('--c', a.colour); c.style.left = x + 'px'; c.style.top = y + 'px';
      c.style.transitionDelay = (i * 22) + 'ms';
      const s = doc.createElement('span'); s.className = 'to-chip-sig'; sigil(s, a.id);
      const l = doc.createElement('span'); l.className = 'to-chip-name'; l.textContent = a.label;
      c.append(s, l);
      if (a.id === here.id) c.classList.add('here');
      arc.append(c);
      return { el: c, a, x: x + host.left, y: y + host.top };
    });
    arc.hidden = false; orb.classList.add('picking');
    api.frame(() => arc.classList.add('on'));
    try { navigator.vibrate?.(14); } catch (_) {}
    return true;
  }
  function closeArc() { arc.classList.remove('on'); arc.hidden = true; arc.replaceChildren(); chips = []; orb.classList.remove('picking'); }
  function pickAt(x, y) {
    let best = null, d = Infinity;
    for (const c of chips) { const dd = Math.hypot(c.x - x, c.y - y); if (dd < d) { d = dd; best = c; } }
    const hit = best && d < PICK_R ? best : null;
    for (const c of chips) c.el.classList.toggle('sel', c === hit);
    if (hit && G && G.sel !== hit) { try { navigator.vibrate?.(6); } catch (_) {} }
    return hit;
  }

  /* ---------- gestures ---------- */
  api.listen(orb, 'contextmenu', e => e.preventDefault());
  api.listen(orb, 'pointerdown', e => {
    if (G || e.isPrimary === false) return;
    e.preventDefault(); e.stopPropagation();
    api.gesture.claim(e.pointerId);
    try { orb.setPointerCapture(e.pointerId); } catch (_) {}
    G = { id: e.pointerId, x: e.clientX, y: e.clientY, arc: false, sel: null };
    orb.classList.add('press'); eng?.press(true);
    const idle = api.voice.state().state === 'idle';
    if (idle) G.off = api.after(HOLD_MS, () => { if (G && !G.moved) G.arc = openArc(); });
  });
  api.listen(orb, 'pointermove', e => {
    if (!G || e.pointerId !== G.id) return;
    if (G.arc) { G.sel = pickAt(e.clientX, e.clientY); return; }
    if (Math.hypot(e.clientX - G.x, e.clientY - G.y) > 22) { G.moved = true; G.off?.(); }
  });
  function end(e, cancelled) {
    if (!G || (e && e.pointerId !== G.id)) return;
    const g = G; G = null; g.off?.(); orb.classList.remove('press'); eng?.press(false);
    if (g.arc) {
      const sel = g.sel; closeArc();
      // Let go on an agent: recording starts for that agent, for this message. Let go elsewhere: nothing.
      if (sel && !cancelled) api.voice.talk(sel.a.id);
      return;
    }
    if (cancelled || g.moved) return;
    api.voice.tap(); // idle: talk to the screen's agent; recording: send; paused: resume
  }
  api.listen(orb, 'pointerup', e => end(e, false));
  api.listen(orb, 'pointercancel', e => end(e, true));
  api.listen(orb, 'lostpointercapture', e => end(e, true));
  api.listen(orb, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); api.voice.tap(); } });

  /* White orb: a tap types into the focused field; a tap with nothing focused explains itself. In a full-screen
   * Chats or text field the white orb moves to the corner and keeps its classic tap there. */
  api.orb.onTap(() => {
    const dev = doc.getElementById('device');
    if (dev?.classList.contains('orb-corner')) return false;
    if (api.voice.dictate()) return true;
    api.toast('White orb types into a text field · tap a field first. Talk to an agent with the orb on the right.');
    return true;
  });

  api.on('route', paint);
  api.on('voice', paint);
  api.on('render', paint);
  // Agents and app bindings arrive after boot: repaint a few times, then on events only.
  [400, 1500, 4000].forEach(ms => api.after(ms, paint));
  api.listen(window, 'resize', lift);
  // A thread's message bar comes and goes with taps and the keyboard; keep the orb clear of it.
  let liftQueued = false;
  const mo = new MutationObserver(() => { if (!liftQueued) { liftQueued = true; api.frame(() => { liftQueued = false; lift(); }); } });
  mo.observe(doc.getElementById('device') || doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  paint();

  return () => {
    closeArc(); mo.disconnect(); delete doc.documentElement.dataset.toTake; doc.documentElement.style.removeProperty('--to-lift');
  };
}
