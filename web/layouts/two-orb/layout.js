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
  orb.append(ring, face, name);

  const arc = doc.createElement('div'); arc.className = 'to-arc'; arc.hidden = true;
  arc.setAttribute('role', 'listbox'); arc.setAttribute('aria-label', 'Choose an agent for this message');
  api.mount(arc); api.mount(orb);

  let shownFor = '', chips = [], G = null;

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
    sigil(face, who.id);
    orb.dataset.state = take ? (v.state === 'paused' ? 'paused' : v.state === 'listen' ? 'rec' : 'busy') : busy ? 'other' : 'idle';
    orb.classList.toggle('private', !!who.private);
    const label = take ? (v.state === 'paused' ? 'Paused · tap to resume' : 'To ' + who.label + ' · tap to send')
      : here.why === 'app' ? here.label + ' · for ' + here.app : here.label;
    name.textContent = take ? 'To ' + who.label : here.main ? '' : who.label;
    orb.setAttribute('aria-label', take ? label : `Talk to ${label}. Hold to pick another agent.`);
    shownFor = who.id;
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
    orb.classList.add('press');
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
    const g = G; G = null; g.off?.(); orb.classList.remove('press');
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
  paint();

  return () => { closeArc(); };
}
