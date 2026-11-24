/* Wizard UX AI apps view (desktop) › a slow app's placeholder, the apps column on the right and the orb's place. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { CHATS, viewChrome } from '../apps/chrome.js';
import { svgIcon } from './parts.js';
export function columnPart({ api, desks, doc, el, feedBox, icon, shade, side, top }) {
  // a slow app: its placeholder in the panel's place from the first frame
  const pLoad = el('div', 'aad-pload', { 'aria-live': 'polite' }); pLoad.hidden = true;
  const pLoadT = el('span', 'aad-pload-t'); pLoad.append(el('span', 'aad-pload-i'), el('i', 'aad-pload-s', { 'aria-hidden': 'true' }), pLoadT);

  /* ---------- the apps, all in one place on the right (round 15: Arc / Chrome's vertical tabs; round 16: one place) ----------
   * The pinned apps on top, every one of them, open or not, no ✕ (they never auto-close; a click on one not open
   * opens it), a hairline, then the other open apps (one per desk, Home's own Chats desk aside), badged first, then
   * desk order, each with its ✕; All apps last (⌥T). A click shows the app as the panel docked left of the column; the
   * tab in front again (or Esc) hides it; ✕ closes the desk (the stock close). Folds to a 52 px icon column (kept),
   * resizable. At its foot: Tidy (auto-close apps not used for a while: Off · 12 h · 24 h · 1 week). */
  const vt = el('nav', 'aad-vt', { 'aria-label': 'Apps' });
  const vtHead = el('div', 'aad-vth');
  const vtTog = el('button', 'aad-ib aad-vtog', { type: 'button', 'aria-controls': 'aad-vt' }); vtTog.append(icon('side'));
  const vtTitle = el('span', 'aad-vtt', { text: 'Apps' });
  vtHead.append(vtTitle, vtTog);
  const vtList = el('div', 'aad-vtl', { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Apps' });
  const vtFoot = el('div', 'aad-vtf');
  // All apps: the list's last row, kept in view under it (the grid as a sheet, ⌥T)
  // round 16 item 7: + at the column's end (in place of All apps): the picker of installed apps neither pinned nor open
  const vtAll = el('button', 'aad-vall', { type: 'button', 'aria-label': 'Open another app: search all installed apps, including open and pinned apps', title: 'Open another app (Left ⌥Space · ⌥A)' });
  const vtAllI = el('span', 'aad-vti'); vtAllI.append(icon('plus', 'aad-ico aad-vall-i'));
  // (the app bar's own word for it, ONE: "All apps", the phone's)
  vtAll.append(vtAllI, el('span', 'aad-vtn', { text: 'Add an app' }), el('span', 'aad-vtn aad-vtn-bar', { text: 'All apps', 'aria-hidden': 'true' }));
  const tidyBtn = el('button', 'aad-tidy', { type: 'button', 'aria-expanded': 'false' });
  const tidyW = el('span', 'aad-tidy-w');
  tidyBtn.append(icon('snooze', 'aad-ico aad-tidy-i'), tidyW);
  vtFoot.append(vtAll, tidyBtn);
  /* Narrower window (ONE): this column is the app bar (desktop.css, html[data-aad-dock-edge]) and Chats is its first
   * item, the one way back to the chats there (the left sidebar is gone); hidden while the window is wide (outside the
   * list: the rows' drag and their numbering never see it). Its badge: the chats waiting (Ready's count). */
  const vOne = el('div', 'aad-vone'); vOne.hidden = true;
  const vChats = el('div', 'aad-vchats', { role: 'button', tabindex: '0', 'data-app': CHATS, title: 'Chats', 'aria-label': 'Chats' });
  const vChatsN = el('b', 'aad-vtb', { 'aria-hidden': 'true' }); vChatsN.hidden = true;
  { const ic = el('span', 'aad-vti'), t0 = el('span', 'aad-tile is-vt', { 'aria-hidden': 'true' }); t0.style.setProperty('--c', 'var(--wz-accent)'); t0.append(el('i', 'sgi sg-chats', { 'aria-hidden': 'true' })); ic.append(t0); vChats.append(ic, el('span', 'aad-vtn', { text: 'Chats' }), vChatsN); }
  vOne.append(vChats, el('hr', 'aad-vtsep', { 'aria-hidden': 'true' }));
  // the app bar's gap for the orb (between its two halves; the orb moves into it, as into the composer's slot)
  const vtOrb = el('i', 'aad-vtorb', { 'aria-hidden': 'true' });
  vt.id = 'aad-vt'; vt.append(vtHead, vtList, vtFoot, vtOrb);
  vt.insertBefore(vOne, vtList);
  const toast = el('div', 'aad-toast', { role: 'status' }); toast.hidden = true;
  const toastW = el('span', 'aad-toast-w'), toastU = el('button', 'aad-toast-u', { type: 'button', text: 'Undo' });
  toast.append(toastW, toastU);

  /* ---------- the orb: bottom centre of the main area, always (Home, a chat, an app): the one way to talk ---------- */
  const orbBox = el('div', 'aad-orb');
  const cv = el('canvas', 'aad-orbc', { width: '128', height: '128', 'aria-hidden': 'true' });
  const fb = el('img', 'aad-orbfb', { alt: '', src: 'robert-thread-orb.png', draggable: 'false' }); fb.hidden = true;
  const orbBtn = el('button', 'aad-orbbtn', { type: 'button', 'aria-label': 'Wizard orb (the microphone). Click to talk, hold for a command, drag up for a new chat to type in.' });
  // round 6: the orb IS the microphone, so it wears a small one (in the composer, where the mic was, and on its own spot)
  const micG = el('span', 'aad-mic', { 'aria-hidden': 'true' }); micG.append(svgIcon(doc, 'mic', 'aad-mic-i'));
  const micMarkup = micG.innerHTML; let orbIdentityHtml = micMarkup;
  function paintOrbIdentity(appId) {
    const a = appId && api.apps.list().find(a => a.id === appId), S = doc.defaultView?.WizSigil;
    const html = a && S ? (a.sgh || S.html(a.sigil || a)) : micMarkup;
    if (html === orbIdentityHtml) return;
    orbIdentityHtml = html; micG.innerHTML = html;
    if (a && S) { S.orb(micG); for (const glyph of micG.children) { glyph.style.width = '40%'; glyph.style.height = '40%'; } }
  }
  orbBox.append(cv, fb, micG, orbBtn);


  // round 21: ⌥H Home hides both sides; this one quiet ◫ at the top left (where the sidebar was) puts everything back (⌥H)
  const hBack = el('button', 'aad-ib aad-hback', { type: 'button', 'aria-label': 'Everything back as it was (⌥H)', title: 'Back as it was (⌥H)' }); hBack.append(icon('side'));
  // (app keys round: the empty middle of Home, where ⌥H's keycap sits while ⌥ is held; nothing drawn, never clickable)
  const hMid = el('div', 'aad-hmid', { 'aria-hidden': 'true' });
  const scene = el('div', 'aad');
  scene.append(shade, side, top, pLoad, vt, toast, orbBox, hBack, hMid);
  api.mount(scene);
  api.mount(feedBox);   // (moved into the docked chat column while a channel's feed shows there)

  // the + sheet in three levels and room under hosted apps for the floating orb, from the shared view chrome; the orb's
  // spot (its centre, its size) lets an app's own bottom tabs go either side of it
  const orbSpot = () => { const r = orbBox.getBoundingClientRect?.(); return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2, d: orbBox.offsetWidth || r.width } : null; };
  const chrome = viewChrome(api, { openIds: () => desks().map(d => d.id), orb: orbSpot });
  const near = (a, b) => a === b || (!!a && !!b && Math.abs(a.x - b.x) < .5 && Math.abs(a.y - b.y) < .5 && Math.abs(a.d - b.d) < .5);
  const orbAt = { done: false, slot: null, home: null };   // where placeOrb last put the orb (round 11)
  return { chrome, cv, fb, hBack, hMid, near, orbAt, orbBox, orbBtn, paintOrbIdentity, pLoad, pLoadT, scene, tidyBtn, tidyW, toast, toastU, toastW, vChats, vChatsN, vOne, vtAll, vtFoot, vtList, vtTog };
}
