/* Shared pointer/keyboard action menu. Shells call back() first in their Back stack.
 * open({ anchor, x?, y?, label?, items: [{ label, action, icon? }], onClose?, stay? })
 * icon: a name from ICONS below ('picture', 'camera', 'file'); the row gets a round tile with that icon and a taller
 * touch target. Unknown names are ignored, so a row never shows a broken icon.
 * Without x/y it sits under the anchor, or above it when there is no room below (a composer's +).
 * stay: follow the anchor on scroll/resize instead of closing (a phone keyboard going down).
 * onClose: called when it closes without a choice (outside tap, Back, Tab).
 * attach(input, anchor, opts): the Android app's Photo or video / Camera / File menu for a file input.
 * The selection/link menus own specialized selection/download gestures and are not
 * general action menus. Keep this primitive independent of desktop state. */
(() => {
  'use strict';
  let current = null;
  // Built-in line icons (24-unit boxes, stroked with currentColor). Paths only, built through the DOM, never HTML.
  const ICONS = {
    picture: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M7 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'm21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21'],
    camera: ['M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z', 'M9 13a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
    file: ['m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6A4 4 0 1 1 18 8.8l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5'],
  };
  const iconTile = (doc, name) => {
    const d = Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : null;
    if (!d) return null;
    const NS = 'http://www.w3.org/2000/svg', tile = doc.createElement('span'), svg = doc.createElementNS(NS, 'svg');
    tile.className = 'wos-cm-tile'; tile.setAttribute('aria-hidden', 'true');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
    for (const one of d) { const path = doc.createElementNS(NS, 'path'); path.setAttribute('d', one); svg.appendChild(path); }
    tile.appendChild(svg); return tile;
  };
  function close(restoreFocus = true) {
    if (!current) return false;
    const { panel, anchor, abort, onClose } = current; current = null;
    abort.abort(); panel.remove();
    try { onClose?.(); } catch (e) {}
    // paintBar may replace the trigger while the menu is open.
    if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
    return true;
  }
  function open({ anchor, x, y, label = 'Actions', items, onClose, stay = false }) {
    close(false);
    const doc = anchor?.ownerDocument || document, win = doc.defaultView;
    const abort = new AbortController(), signal = abort.signal;
    const panel = doc.createElement('div'); panel.className = 'wos-context-menu';
    panel.setAttribute('role', 'menu'); panel.setAttribute('aria-label', label);
    for (const item of items) {
      const button = doc.createElement('button'); button.type = 'button';
      button.setAttribute('role', 'menuitem');
      const tile = item.icon ? iconTile(doc, item.icon) : null;
      if (tile) { const words = doc.createElement('span'); words.className = 'wos-cm-label'; words.textContent = item.label; button.append(tile, words); panel.classList.add('wos-cm-icons'); }
      else button.textContent = item.label;
      button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (current) current.onClose = null; close(false); item.action(); });
      panel.appendChild(button);
    }
    doc.body.appendChild(panel); current = { panel, anchor, abort, onClose };
    const fixed = Number.isFinite(x) && Number.isFinite(y);
    const place = () => {
      const a = anchor?.getBoundingClientRect(), r = panel.getBoundingClientRect();
      let px = x, py = y;
      if (!fixed) {
        px = a?.left || 8; py = (a?.bottom || 8) + 6;
        if (a && py + r.height > win.innerHeight - 8 && a.top - r.height - 6 >= 8) py = a.top - r.height - 6;
      }
      panel.style.left = Math.max(8, Math.min(px, win.innerWidth - r.width - 8)) + 'px';
      panel.style.top = Math.max(8, Math.min(py, win.innerHeight - r.height - 8)) + 'px';
    };
    place();
    const moved = () => { if (stay && anchor?.isConnected) place(); else close(false); };
    const buttons = [...panel.querySelectorAll('button')];
    panel.addEventListener('keydown', e => {
      // Escape belongs to the shell's existing Back stack, not a second handler.
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Tab') return close();
      const at = buttons.indexOf(doc.activeElement), n = buttons.length;
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (at + (e.key === 'ArrowUp' ? -1 : 1) + n) % n;
      buttons[next]?.focus({ preventScroll: true });
    }, { signal });
    doc.addEventListener('pointerdown', e => { if (!panel.contains(e.target)) close(false); }, { capture: true, signal });
    // A press inside a hosted frame blurs its parent window.
    win.addEventListener('blur', () => close(false), { signal });
    win.addEventListener('scroll', e => { if (!panel.contains(e.target)) moved(); }, { capture: true, signal });
    win.addEventListener('resize', moved, { signal });
    win.visualViewport?.addEventListener('resize', moved, { signal });
    win.addEventListener('pagehide', () => close(false), { signal });
    buttons[0]?.focus({ preventScroll: true });
  }
  // Android app (wizard-ux#1634): one empty-accept input made Android show its Camera/Files "Choose an action"
  // sheet. Offer the three plain choices instead, as Messenger does: Camera (camera at once), Photo or video (the
  // phone's photo grid at once) and File. Browsers and desktop keep their own file dialog.
  // Icons on the attach menu (wizard-ux issue 1639): James, 19 Nov 2026, "probably these would be more intuitive
  // with icons". On for everyone since 27 Nov 2026 (show-and-tell yes; switch wizard/attach-menu-icons removed).
  const ATTACH_ICONS = { Camera: 'camera', 'Photo or video': 'picture', File: 'file' };
  const nativeAndroid = () => { try { return !!window.WizardOSNative && /Android/i.test(navigator.userAgent || ''); } catch (e) { return false; } };
  function attach(input, anchor, { onCancel, label = 'Attach', multiple = true } = {}) {
    const pick = (accept, capture) => () => {
      input.accept = accept; input.multiple = multiple && !capture;
      if (capture) input.setAttribute('capture', 'environment'); else input.removeAttribute('capture');
      input.click();
    };
    if (!nativeAndroid() || !anchor) { pick('', false)(); return false; }
    // Photo or video first (James, 19 Nov). File asks for "*/*", not '': the app opens its file picker straight away
    // for "*/*" (Camera is its own item), while an empty accept still got the Camera/Files sheet.
    const items = [
      { label: 'Photo or video', action: pick('image/*,video/*', false) },
      { label: 'Camera', action: pick('image/*', true) },
      { label: 'File', action: pick('*/*', false) },
    ];
    for (const it of items) it.icon = ATTACH_ICONS[it.label];
    open({ anchor, label, stay: true, onClose: onCancel, items });
    return true;
  }
  window.WosContextMenu = { open, attach, back: () => close(), get isOpen() { return !!current; } };
})();
