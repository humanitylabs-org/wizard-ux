/* Browser owner boundary, shell side (wizard-os#133). Off unless the box turned it on.
 *
 * With `wam browser-boundary on`, the shell's nginx writes a shell-only token into the top-level shell page
 * (index.html / desktop.html, a real page load only: never a fetch, a frame or a worker) as
 * <meta name="wizard-shell-token">. This script runs first, takes the token out of the page and keeps it in this
 * closure, then adds it as `X-Wizard-Shell-Token` to the shell's own owner calls: the Agent Service and the App
 * Manager Store/Settings listener on this origin. App paths (/notes/, /troubleshoot/, …) never get it, so no app
 * backend can learn it. Off (no token in the page, the default): the meta is empty and nothing is wrapped.
 *
 * The shell's own pages that run in a frame (Store, Agents, Setup, and Settings › Connections) load this script too: the top-level shell arms
 * their fetch/XHR the same way (armFrame), because a frame load never carries the token. Store, Agents and Setup also
 * ship the `off` meta, so opened as a top-level tab they get the token from nginx like the shell page and arm themselves. App frames are sandboxed
 * under the boundary (core/browser-boundary.js), so they can't reach armFrame. See docs/browser-boundary.md.
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
  // The shell's own pages that run in a frame (Store, Agents, Setup, Settings › Connections). They get no token from nginx (a frame load
  // never does); the top-level shell arms them instead (armFrame below). Same list as core/browser-boundary.js.
  const SHELL_PAGE = /^\/(?:wizard-os-home|wizard-ux)\/(?:store|agents|setup|store-install\/_connections)\/(?:index\.html)?$/;
  let framed = true;
  try { framed = window.top !== window; } catch (_) { framed = true; }
  // The Android app keeps its native bridges out of app frames while the box has the boundary on (NativeGate,
  // issue 1430). Only the top-level shell page tells it; a frame's `off` or empty value says nothing about the box.
  const tellNative = on => { if (framed) return; try { window.WizardOSNative?.browserBoundary?.(on); } catch (_) {} };
  if (token === 'off') { remember(false); tellNative(false); return; }
  if (framed) {
    // A shell page in a frame: ask the top-level shell (same origin, so it is reachable) to send this page's owner
    // calls with the token. A sandboxed (opaque) frame cannot reach `top` at all, so an app page never gets here.
    try { window.top.WizShellBoundary?.armFrame?.(window); } catch (_) {}
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  remember(true);
  tellNative(true);
  const HEADER = 'X-Wizard-Shell-Token';
  // Owner routes on this origin: the Agent Service (everything it serves that is not a static shell file) and the
  // App Manager listener mounted beside the shell.
  const OWNER = /^\/(?:wizard\/|api\/|v1\/|wizard-os-home\/(?:api|store-install)\/|wizard-ux\/(?:api|store-install)\/)/;
  const owner = (url, base) => {
    try {
      const u = new URL(String(url), base);
      return u.origin === location.origin && OWNER.test(u.pathname) && !u.pathname.includes('//');
    } catch (_) { return false; }
  };
  // Wraps fetch and XMLHttpRequest of one window: this shell page, or one of its own pages in a frame.
  const armed = new WeakSet();
  function wrap(win) {
    if (armed.has(win)) return;
    armed.add(win);
    const base = () => { try { return win.location.href; } catch (_) { return location.href; } };
    const native = win.fetch;
    if (typeof native === 'function') {
      const W = win.Headers || Headers, R = win.Request || (typeof Request === 'function' ? Request : null);
      const wrapped = function fetch(input, init) {
        try {
          const isRequest = !!R && input instanceof R;
          if (owner(isRequest ? input.url : input, base())) {
            const headers = new W((init && init.headers) || (isRequest ? input.headers : undefined));
            if (!headers.has(HEADER)) {
              headers.set(HEADER, token);
              const next = { ...(init || {}), headers };
              return isRequest ? native.call(this, new R(input, next)) : native.call(this, input, next);
            }
          }
        } catch (_) { /* fall through: the call goes out unchanged and the server refuses it */ }
        return native.call(this, input, init);
      };
      win.fetch = wrapped;
    }
    const XHR = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
    if (XHR && typeof XHR.open === 'function' && typeof XHR.send === 'function') {
      const open = XHR.open, send = XHR.send, marked = new WeakSet();
      XHR.open = function (method, url, ...rest) {
        if (owner(url, base())) marked.add(this); else marked.delete(this);
        return open.call(this, method, url, ...rest);
      };
      XHR.send = function (...args) {
        if (marked.has(this)) { try { this.setRequestHeader(HEADER, token); } catch (_) {} }
        return send.apply(this, args);
      };
    }
  }
  wrap(window);
  // One of the shell's own pages (SHELL_PAGE) in a frame below this shell asks to be armed. Only a same-origin frame
  // can reach this function, and a same-origin frame can already call this page's own fetch, so this gives nothing
  // new to a frame that could call it; app frames are sandboxed (opaque) under the boundary and never reach it.
  function armFrame(win) {
    try {
      if (!win || win === window || win.top !== window) return false;
      if (win.location.origin !== location.origin || !SHELL_PAGE.test(win.location.pathname)) return false;
      wrap(win);
      return true;
    } catch (_) { return false; }
  }
  window.WizShellBoundary = Object.freeze({ on: true, header: HEADER, armFrame });
})();
