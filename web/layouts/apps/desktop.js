/* Apps view on the desktop (Miguel, 1 Nov 2026): the phone's Apps idea as a launchpad. Worn by the same
 * miguel/apps-home tweak as the phone (layout.js hands the desktop shell here), picked with Desks | Orb | Apps in the
 * middle of the bar.
 *
 *   - Home = a launchpad grid over the desktop's own wallpaper: ONE icon per open app / desk (each desk is one app),
 *     in desk order, with its real logo (else its glyph in its colour), its name and its live count; Chats first with
 *     its Ready count; a + tile last: the sheet of every app not open yet (chrome.js, the same as the phone's), whose
 *     pick opens on a desk of its own and then shows here as its own icon.
 *   - A tap opens that app's desk: the stock desktop window, the full desk, as in Desks.
 *   - Back to the grid: a drag up on the orb (the phone's home swipe) or the shell's own Home key ⌥` (it already
 *     toggles Home and back; no new binding, so the desktop's key map is unchanged). No Back button (round 6).
 *   - The orb floats at the bottom centre on every screen, as on the phone (the shell's own orb drawing, orb.js): click
 *     talks (again = send), hold = a local command (release runs it), a drag up = Home; a sideways drag does nothing
 *     (no desk steps). Windows end above its row, so it never covers a window's own buttons.
 *   - The bar keeps the switch and the AI fuel gauge in its centre and the gear (Settings) on the right; the desk
 *     numbers step aside (the grid is the desks).
 *
 * No timers of its own beyond the hold (api.after), no storage, no innerHTML. Colours are the wearing tweak's tokens
 * (--ap-*). Everything through the layout API. */
import { viewChrome, CHATS } from './chrome.js';
import { glyphOf, colourOf } from '../orb/shared.js';
import { HOLD_MS } from '../orb/keys.js';

export default function desktop(api) {
  const doc = document, root = doc.documentElement;
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };
  const desks = () => api.desks.list();

  /* ---------- nodes: the launchpad (Home only) and the bottom row (the orb) on the stage ---------- */
  const scene = el('div', 'apd');
  const pad = el('section', 'apd-home', { 'aria-label': 'Apps' });
  const grid = el('nav', 'apd-grid', { 'aria-label': 'Your open apps' });
  pad.append(grid);
  const row = el('div', 'apd-row');
  const orbBox = el('div', 'apd-orb');
  const cv = el('canvas', 'apd-orbc', { width: '128', height: '128', 'aria-hidden': 'true' });
  const fb = el('img', 'apd-orbfb', { alt: '', src: 'robert-thread-orb.png', draggable: 'false' }); fb.hidden = true;
  const orbBtn = el('button', 'apd-orbbtn', { type: 'button', 'aria-label': 'Wizard orb. Click to talk, hold for a command, drag up for Home.' });
  orbBox.append(cv, fb, orbBtn);
  const chrome = viewChrome(api, { openIds: () => desks().map(d => d.id) });
  row.append(orbBox);
  scene.append(pad, row);
  api.mount(scene);
  root.dataset.appsDesk = 'home';

  /* ---------- the grid: Chats, one icon per desk, + ---------- */
  // Chats first, then every app with a badge, then the rest, each in desk order (Miguel, 2 Nov 2026: the same order as
  // the Orb's ring). A newly opened app grows into its place (chrome.css .vc-born) instead of just appearing.
  const litFirst = out => [out[0], ...out.slice(1).filter(i => (badgeMap[i.id] || 0) > 0), ...out.slice(1).filter(i => !((badgeMap[i.id] || 0) > 0))];
  const bornIf = (on, x) => { if (on && x?.b) { x.b.classList.add('vc-born'); api.after(800, () => x.b.classList.remove('vc-born')); } return x; };
  let badgeMap = api.apps.badges(m => { badgeMap = m; paint(); });   // a badge can reorder the grid (badged apps first)
  let sig = '', icons = [];
  const plus = chrome.plus('apd-icon apd-plus', 'Add an app', (b, ico) => { b.setAttribute('data-app', '+add'); const t = el('span', 'apd-tile', { 'aria-hidden': 'true' }); t.append(ico); b.append(t, el('span', 'apd-label', { text: 'Add' })); });
  function icon(item, meta) {
    const b = el('button', 'apd-icon', { type: 'button', 'data-app': item.id, ...(item.desk != null ? { 'data-desk': String(item.desk) } : {}) });
    const tile = el('span', 'apd-tile', { 'aria-hidden': 'true' });
    const c = item.id === CHATS ? 'var(--wz-accent)' : colourOf(meta || {});
    b.style.setProperty('--c', c);
    tile.append(el('i', `sgi sg-${item.id === CHATS ? 'chats' : glyphOf(meta || { id: item.id, name: item.name })}`, { 'aria-hidden': 'true' }));
    const count = el('b', 'apd-badge', { 'aria-hidden': 'true' }); count.hidden = true;
    b.append(tile, count, el('span', 'apd-label', { text: item.name }));
    const go = () => {
      if (item.id === CHATS) { if (item.desk != null) api.nav.goDesk(item.desk); else api.apps.openDesk(CHATS); }
      else if (item.desk != null) api.nav.goDesk(item.desk);
    };
    api.listen(b, 'click', go);
    chrome.menuOn(b, item, { onOpen: go, onClosed: () => api.after(60, paint) });   // right-click: Open · Close (stays installed)
    if (item.id !== CHATS) api.apps.logo(item.id).then(url => {
      if (!url || !b.isConnected) return;
      const im = el('img', 'apd-logo', { alt: '', src: url, draggable: 'false' });
      im.decode().then(() => { tile.replaceChildren(im); b.classList.add('is-logo'); }, () => {});
    });
    return { b, count, item };
  }
  function items() {
    const all = desks(), chatsDesk = all.find(d => d.id === CHATS);
    const out = [{ id: CHATS, name: 'Chats', desk: chatsDesk ? chatsDesk.desk : null }];
    for (const d of all) if (d.id && d.id !== CHATS) out.push({ id: d.id, name: d.name || d.id, desk: d.desk });
    return litFirst(out);
  }
  function paintCounts() {
    for (const { b, count, item } of icons) {
      const n = badgeMap[item.id] || 0;
      count.textContent = n ? (api.apps.badgeText?.(item.id) || (n > 99 ? '99+' : String(n))) : ''; count.hidden = !n;
      b.setAttribute('aria-label', item.id === CHATS ? (n ? `Chats, ${n} ready` : 'Chats') : `${item.name}${n ? `, ${n} new` : ''}`);
      b.title = item.name;
    }
  }
  function paint() {
    const list = items(), next = list.map(i => `${i.id}@${i.desk}:${i.name}`).join('|');
    if (next !== sig) {
      sig = next;
      const meta = new Map(api.apps.list().map(a => [a.id, a]));
      const was = new Map(icons.map(x => [`${x.item.id}@${x.item.desk}:${x.item.name}`, x]));
      const first = !icons.length;
      icons = list.map(i => was.get(`${i.id}@${i.desk}:${i.name}`) || bornIf(!first, icon(i, meta.get(i.id))));
      grid.replaceChildren(...icons.map(x => x.b), plus);
    }
    paintCounts();
    const home = !!api.route().home;
    root.dataset.appsDesk = home ? 'home' : 'desk';
    pad.hidden = !home;
    if (!home && !chrome.closing) chrome.close();
  }
  api.on('route', paint); api.on('render', paint); api.on('home', paint);
  paint();

  /* ---------- the orb: the shell's own drawing; click talks, hold commands, a drag up goes Home ---------- */
  let eng = null;
  api.orb.ready().then(ok => { if (!ok || !scene.isConnected) return; eng = api.orb.create(cv, fb, { R: .64 }); eng?.setRestingMotion?.(false); mode(api.voice.state()); });
  const MODES = ['idle', 'listen', 'command', 'think', 'paused', 'done', 'agent', 'typing'];
  function mode(v) {
    const m = !v || v.state === 'idle' ? (v?.command ? 'command' : 'idle') : v.command ? 'command' : MODES.includes(v.state) ? v.state : 'listen';
    orbBox.dataset.mode = m; eng?.setMode?.(m);
  }
  api.on('voice', mode);
  api.orb.onLevel(v => eng?.setLevel?.(+v || 0));
  let press = null;
  api.listen(orbBtn, 'pointerdown', e => {
    if (e.button) return;
    const p = { held: false, started: null, cancel: null, x: e.clientX, y: e.clientY, moved: false }; press = p;
    try { orbBtn.setPointerCapture(e.pointerId); } catch (_) {}
    orbBox.classList.add('is-pressed'); eng?.press?.(true);
    p.cancel = api.after(HOLD_MS, () => { if (press !== p || p.moved || (api.voice.state()?.state || 'idle') !== 'idle') return; p.held = true; p.started = Promise.resolve(api.voice.command()); });
  });
  api.listen(orbBtn, 'pointermove', e => {
    const p = press; if (!p || p.held || p.moved) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.hypot(dx, dy) < 48) return;
    // a drag is never a click; up = Home (the phone's home swipe), sideways / down = nothing (no desk steps)
    p.moved = true; p.cancel?.();
    if (dy < 0 && -dy > Math.abs(dx) && !api.route().home) api.desk.home();
  });
  const release = run => {
    const p = press; press = null; if (!p) return; p.cancel?.(); orbBox.classList.remove('is-pressed'); eng?.press?.(false);
    if (!run || p.moved) return;
    if (p.held) p.started.then(r => { if (r === 'voice') api.voice.command(); });
    else api.voice.talk();
  };
  api.listen(orbBtn, 'pointerup', () => release(true));
  api.listen(orbBtn, 'pointercancel', () => release(false));
  api.listen(orbBtn, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) api.voice.talk(); } });
  api.listen(orbBtn, 'contextmenu', e => e.preventDefault());

  return () => { chrome.dispose(); scene.remove(); delete root.dataset.appsDesk; };
}
