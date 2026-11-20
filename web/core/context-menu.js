/* Shared pointer/keyboard action menu. Shells call back() first in their Back stack.
 * open({ anchor, x?, y?, label?, items: [{ label, action }], onClose?, stay? })
 * Without x/y it sits under the anchor, or above it when there is no room below (a composer's +).
 * stay: follow the anchor on scroll/resize instead of closing (a phone keyboard going down).
 * onClose: called when it closes without a choice (outside tap, Back, Tab).
 * attach(input, anchor, opts): the Android app's Camera / Photo or video / File menu for a file input.
 * The selection/link menus own specialized selection/download gestures and are not
 * general action menus. Keep this primitive independent of desktop state. */
(() => {
  'use strict';
  let current = null;
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
      button.setAttribute('role', 'menuitem'); button.textContent = item.label;
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
  const nativeAndroid = () => { try { return !!window.WizardOSNative && /Android/i.test(navigator.userAgent || ''); } catch (e) { return false; } };
  function attach(input, anchor, { onCancel, label = 'Attach', multiple = true } = {}) {
    const pick = (accept, capture) => () => {
      input.accept = accept; input.multiple = multiple && !capture;
      if (capture) input.setAttribute('capture', 'environment'); else input.removeAttribute('capture');
      input.click();
    };
    if (!nativeAndroid() || !anchor) { pick('', false)(); return false; }
    open({ anchor, label, stay: true, onClose: onCancel, items: [
      { label: 'Camera', action: pick('image/*', true) },
      { label: 'Photo or video', action: pick('image/*,video/*', false) },
      { label: 'File', action: pick('', false) },
    ] });
    return true;
  }
  window.WosContextMenu = { open, attach, back: () => close(), get isOpen() { return !!current; } };
})();
