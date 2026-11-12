/* Browser owner boundary, shell side (wizard-os#133). Off unless the box turned it on.
 *
 * With `wam browser-boundary on`, the shell's nginx writes a shell-only token into the top-level shell page
 * (index.html / desktop.html, a real page load only: never a fetch, a frame or a worker) as
 * <meta name="wizard-shell-token">. This script runs first, takes the token out of the page and keeps it in this
 * closure, then adds it as `X-Wizard-Shell-Token` to the shell's own owner calls: the Agent Service and the App
 * Manager Store/Settings listener on this origin. App paths (/notes/, /troubleshoot/, …) never get it, so no app
 * backend can learn it. Off (no token in the page, the default): the meta is empty and nothing is wrapped.
 *
 * The token only becomes a real boundary once app frames are sandboxed (next slice): until then a same-origin app
 * frame can still reach into the shell. Never turn the box switch on alone (wizard-app-manager docs/browser-boundary.md).
 */
(() => {
  'use strict';
  const MARK = 'wos.browser-boundary.v1';
  const meta = document.querySelector('meta[name="wizard-shell-token"]');
  const token = (meta && meta.getAttribute('content')) || '';
  // Out of the DOM either way, so nothing that reads the page later finds it.
  if (meta) meta.remove();
  // This device remembers that the box has the boundary on (never the token), so a shell or pinned app opened from
  // the offline copy, which has no token, still sandboxes app frames (core/browser-boundary.js). Only the box's own
  // answer changes it: `off` is the shipped value nginx leaves when the switch is off; an empty value (a frame, a
  // warm-up read, the offline copy on a box that is on) leaves it as it is.
  const remember = on => { try { if (on) localStorage.setItem(MARK, '1'); else localStorage.removeItem(MARK); } catch (_) {} };
  if (token === 'off') { remember(false); return; }
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  // Only the top-level shell document. A shell page loaded in a frame never gets a token from nginx anyway.
  try { if (window.top !== window) return; } catch (_) { return; }
  remember(true);
  const HEADER = 'X-Wizard-Shell-Token';
  // Owner routes on this origin: the Agent Service (everything it serves that is not a static shell file) and the
  // App Manager listener mounted beside the shell.
  const OWNER = /^\/(?:wizard\/|api\/|v1\/|wizard-os-home\/(?:api|store-install)\/|wizard-ux\/(?:api|store-install)\/)/;
  const owner = url => {
    try {
      const u = new URL(String(url), location.href);
      return u.origin === location.origin && OWNER.test(u.pathname) && !u.pathname.includes('//');
    } catch (_) { return false; }
  };
  const native = window.fetch;
  if (typeof native === 'function') {
    const wrapped = function fetch(input, init) {
      try {
        const isRequest = typeof Request === 'function' && input instanceof Request;
        if (owner(isRequest ? input.url : input)) {
          const headers = new Headers((init && init.headers) || (isRequest ? input.headers : undefined));
          if (!headers.has(HEADER)) {
            headers.set(HEADER, token);
            const next = { ...(init || {}), headers };
            return isRequest ? native.call(this, new Request(input, next)) : native.call(this, input, next);
          }
        }
      } catch (_) { /* fall through: the call goes out unchanged and the server refuses it */ }
      return native.call(this, input, init);
    };
    window.fetch = wrapped;
  }
  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR && typeof XHR.open === 'function' && typeof XHR.send === 'function') {
    const open = XHR.open, send = XHR.send, marked = new WeakSet();
    XHR.open = function (method, url, ...rest) {
      if (owner(url)) marked.add(this); else marked.delete(this);
      return open.call(this, method, url, ...rest);
    };
    XHR.send = function (...args) {
      if (marked.has(this)) { try { this.setRequestHeader(HEADER, token); } catch (_) {} }
      return send.apply(this, args);
    };
  }
  window.WizShellBoundary = Object.freeze({ on: true, header: HEADER });
})();
