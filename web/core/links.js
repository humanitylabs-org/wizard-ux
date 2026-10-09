/* Wizard UX core: the link sheet, an in-app browser for links tapped inside Wizard.
 *
 * Spec (Archimedes + Claude Fable, 9 Oct 2026):
 *   - Same-origin links (our private apps and previews) open in ONE sheet over the current desk.
 *     Every other origin goes straight to the system browser: no card, no limbo.
 *   - Phone: a sheet at ~92% height, with drag-down on the top bar to dismiss. Desktop: a right-half pane.
 *   - One top bar: ‹ (page back; hidden at depth 1), title over domain, Keep, ↗ (not in the Android
 *     app, where it would load over the shell), ✕.
 *   - Back pops the sheet's own page stack, then dismisses. It never exits.
 *   - Keep turns the current page into a normal window on the current desk (through the shell's window
 *     manager), then dismisses. It never creates a desk.
 *   - A second link while the sheet is open pushes onto the same stack.
 *   - Frames are same-origin, so after every load the sheet patches the page: target=_top/_parent/_blank
 *     anchors and forms, plus window.open, load inside the sheet; pushState keeps the title current.
 *     A page can never replace the Wizard shell.
 *
 * Use: const L = WizLinks.mount({ parent, mode: 'sheet' | 'pane', onKeep(url, title), onChange(open) });
 *      L.open(url) · L.back() → bool · L.close() · L.isOpen() · L.state()
 *      WizLinks.intercept(root, L) wires every http(s) link inside `root` (chat bubbles) to the sheet.
 */
(() => {
  'use strict';
  const ORIGIN = location.origin;
  const NATIVE = !!window.WizardOSNative || /WizardOS-Android\//.test(navigator.userAgent || '');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function abs(href, base) { try { return new URL(href, base || location.href); } catch (e) { return null; } }
  function inApp(u) { return !!u && (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === ORIGIN; }
  function external(u) {
    // Android app: a main-frame navigation to another origin is handed to the system browser natively.
    // Browser / PWA: a new tab.
    try { window.open(u.href, '_blank', 'noopener'); } catch (e) { location.href = u.href; }
  }
  function nice(u) {
    const p = decodeURIComponent(u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || u.hostname);
    return p.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function mount({ parent, mode = 'sheet', onKeep, onChange } = {}) {
    const el = document.createElement('section');
    el.className = `linksheet ${mode}`; el.setAttribute('aria-label', 'Link'); el.hidden = true;
    el.innerHTML = `<div class="ls-scrim" data-ls="close"></div><div class="ls-panel"><header class="ls-bar">
        <span class="ls-grip" aria-hidden="true"></span>
        <button class="ls-back" data-ls="back" aria-label="Back" hidden>‹</button>
        <span class="ls-title"><b></b><small></small></span>
        <button class="ls-keep" data-ls="keep" title="Keep as a window on this desk">Keep</button>
        ${NATIVE ? '' : '<button class="ls-out" data-ls="out" aria-label="Open in browser" title="Open in browser">↗</button>'}
        <button class="ls-x" data-ls="close" aria-label="Close">✕</button>
      </header>
      <div class="ls-body"><i class="ls-load"></i><iframe class="ls-frame" title="Link" allow="microphone; clipboard-read; clipboard-write; fullscreen" referrerpolicy="same-origin"></iframe></div></div>`;
    (parent || document.body).appendChild(el);
    const frame = el.querySelector('iframe'), bar = el.querySelector('.ls-bar'), panel = el.querySelector('.ls-panel');
    let stack = [], open = false, popping = false, hideT = 0;

    const cur = () => stack[stack.length - 1] || null;
    function paint() {
      const c = cur(); if (!c) return;
      const u = abs(c.url);
      el.querySelector('.ls-title b').textContent = c.title || (u ? nice(u) : 'Link');
      el.querySelector('.ls-title small').textContent = u ? u.host + u.pathname : '';
      el.querySelector('.ls-back').hidden = stack.length < 2;
    }
    function load(url) {
      el.classList.add('loading');
      try { frame.contentWindow.location.replace(url); } catch (e) { frame.src = url; }
    }
    function show() {
      if (open) return; open = true; clearTimeout(hideT);
      el.hidden = false; panel.style.transform = ''; void el.offsetWidth; el.classList.add('open');
      onChange && onChange(true);
    }
    function close() {
      if (!open) return false; open = false;
      el.classList.remove('open'); panel.style.transform = '';
      hideT = setTimeout(() => { if (!open) { el.hidden = true; stack = []; try { frame.contentWindow.location.replace('about:blank'); } catch (e) {} } }, 260);
      onChange && onChange(false);
      return true;
    }
    function go(href, base) {
      const u = abs(href, base); if (!u) return false;
      if (!inApp(u)) { external(u); return true; }
      if (cur() && cur().url === u.href) { show(); return true; }
      stack.push({ url: u.href, title: '' }); paint(); show(); load(u.href);
      return true;
    }
    function back() {
      if (!open) return false;
      if (stack.length > 1) { stack.pop(); popping = true; paint(); load(cur().url); return true; }
      return close();
    }

    // Every load: record where the page really is, and keep it inside the sheet.
    frame.addEventListener('load', () => {
      el.classList.remove('loading');
      let win, doc; try { win = frame.contentWindow; doc = frame.contentDocument; } catch (e) { return; }
      if (!doc || doc.location.href === 'about:blank') return;
      const here = doc.location.href, c = cur();
      if (c && c.url !== here) {
        // The page moved by itself (redirect, or a plain link click that we let through).
        if (popping) c.url = here; else stack.push({ url: here, title: '' });
      }
      popping = false;
      if (cur()) cur().title = (doc.title || '').trim();
      paint();
      patch(win, doc);
    });
    function patch(win, doc) {
      if (doc.__wizLinks) return; doc.__wizLinks = true;
      doc.addEventListener('click', e => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
        const u = abs(a.getAttribute('href'), doc.baseURI); if (!u || a.hasAttribute('download')) return;
        if (!/^https?:$/.test(u.protocol)) return; // mailto:, tel:, intent:, the page's own handling
        const t = (a.getAttribute('target') || '').toLowerCase();
        if (!inApp(u)) { e.preventDefault(); external(u); return; }
        if (!t || t === '_self') { const h = doc.location; if (u.pathname === h.pathname && u.search === h.search && u.hash) return; } // in-page anchor
        // Every step is a replace-load driven by the sheet, so browser history never fills with frame entries
        // and Back always means "the sheet's previous page".
        e.preventDefault(); go(u.href);
      }, true);
      // Keyboard inside the page: Esc steps back / closes; ⌘/Ctrl+Enter keeps; ⌘/Ctrl+⇧+Enter opens in the browser.
      doc.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back(); return; }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); el.querySelector(e.shiftKey ? '[data-ls="out"]' : '[data-ls="keep"]')?.click(); }
      }, true);
      doc.addEventListener('submit', e => {
        const f = e.target; const t = (f.getAttribute && f.getAttribute('target') || '').toLowerCase();
        if (t && t !== '_self') f.setAttribute('target', '_self');
      }, true);
      try {
        win.open = (href) => { const u = abs(href, doc.baseURI); if (u) go(u.href); return null; };
        const h = win.history, rep = h.replaceState.bind(h), push = h.pushState.bind(h);
        const sync = () => { const c = cur(); if (c) { try { c.url = win.location.href; c.title = (doc.title || '').trim() || c.title; } catch (e) {} paint(); } };
        // Single-page navigation updates the current entry; it never pads the shell's Back stack.
        h.pushState = function (s, t, u) { const r = rep(s, t, u); sync(); return r; };
        h.replaceState = function (s, t, u) { const r = rep(s, t, u); sync(); return r; };
        void push;
        new win.MutationObserver(() => { const c = cur(); if (c && doc.title && c.title !== doc.title.trim()) { c.title = doc.title.trim(); paint(); } })
          .observe(doc.querySelector('title') || doc.head || doc.documentElement, { childList: true, subtree: true, characterData: true });
      } catch (e) {}
    }

    el.addEventListener('click', e => {
      const b = e.target.closest('[data-ls]'); if (!b) return;
      const k = b.dataset.ls, c = cur();
      if (k === 'close') close();
      else if (k === 'back') back();
      else if (k === 'out' && c) external(abs(c.url));
      else if (k === 'keep' && c) {
        let url = c.url; try { url = frame.contentWindow.location.href; } catch (e) {}
        const u = abs(url), title = c.title || (u ? nice(u) : 'Page');
        close(); onKeep && onKeep(u ? u.pathname + u.search + u.hash : url, title);
      }
    });
    // Long-press the title: reload (expert gesture).
    let lpT = 0;
    el.querySelector('.ls-title').addEventListener('pointerdown', () => { lpT = setTimeout(() => { const c = cur(); if (c) load(c.url); }, 600); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.querySelector('.ls-title').addEventListener(t, () => clearTimeout(lpT)));

    // Phone: drag the top bar down to dismiss. Only the bar drags; the page keeps its own scroll.
    if (mode === 'sheet') {
      let y0 = null, dy = 0, t0 = 0;
      bar.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; y0 = e.clientY; dy = 0; t0 = performance.now(); el.classList.add('dragging'); try { bar.setPointerCapture(e.pointerId); } catch (x) {} });
      bar.addEventListener('pointermove', e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = `translateY(${dy}px)`; });
      const end = () => {
        if (y0 == null) return; y0 = null; el.classList.remove('dragging');
        const v = dy / ((performance.now() - t0) || 1);
        if (dy > 120 || v > .6) close(); else panel.style.transform = '';
      };
      bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
    }

    return {
      el, open: go, back, close,
      isOpen: () => open,
      state: () => ({ open, depth: stack.length, url: cur()?.url || '', title: cur()?.title || '' }),
    };
  }

  // Chat bubbles: every http(s) link goes through the sheet (same origin) or the system browser.
  function intercept(root, sheet, scope = '.bub, .note-line, .steps') {
    root.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]'); if (!a || !a.closest(scope)) return;
      const u = abs(a.getAttribute('href')); if (!u || !/^https?:$/.test(u.protocol)) return;
      e.preventDefault(); e.stopPropagation();
      sheet.open(u.href);
    }, true);
  }

  window.WizLinks = { mount, intercept, inApp: href => inApp(abs(href)) };
})();
