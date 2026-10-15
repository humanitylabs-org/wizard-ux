/* Wizard UX core: the link sheet, an in-app browser for links tapped inside Wizard.
 *
 * Spec (Archimedes + Claude Fable, 9 Oct 2026):
 *   - Same-origin links (our private apps and previews) open in ONE sheet over the current desk.
 *     Every other origin goes straight to the system browser: no card, no limbo.
 *   - Phone: a sheet at full height (above the dock, orb usable); ⤡ shrinks it to ~3/4. Drag the top bar down
 *     to dismiss. Desktop: a right-half pane.
 *   - One top bar: ‹ (page back; hidden at depth 1), title over domain, Keep, ↗ (not in the Android
 *     app, where it would load over the shell), ✕.
 *   - Back pops the sheet's own page stack, then dismisses. It never exits.
 *   - Same-origin image links (.png/.jpg/…) open in the media viewer, never as a raw page: fit to width,
 *     pinch to zoom, swipe between the page's images, Back closes only the viewer.
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

  // A preview of this shell on a sibling host (desks.wizard001.com) treats links to the canonical private
  // origin as its own, so a thread's private.wizard001.com/… link opens inside the preview it was tapped in.
  const CANON = 'private.wizard001.com', SIBLING = location.hostname !== CANON && (/\.wizard001\.com$/.test(location.hostname) || location.hostname === '127.0.0.1');
  function abs(href, base) { try { const u = new URL(href, base || location.href); if (SIBLING && u.hostname === CANON && u.protocol === 'https:') return new URL(u.pathname + u.search + u.hash, location.origin); return u; } catch (e) { return null; } }
  function inApp(u) { return !!u && (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === ORIGIN; }
  function external(u) {
    // Android app: a main-frame navigation to another origin is handed to the system browser natively.
    // Browser / PWA: a new tab.
    try { window.open(u.href, '_blank', 'noopener'); } catch (e) { location.href = u.href; }
  }
  // Images never load as a raw page (Android shows them at full pixel size, wider than the screen, no zoom).
  // They open in the shared media viewer: fit to the screen width, pinch to zoom, Back closes only the viewer.
  const IMG = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
  const isImage = u => !!u && IMG.test(u.pathname);
  function viewImage(u, doc) {
    const V = window.WosChat && window.WosChat.viewer; if (!V || !u) return false;
    const rel = x => x.origin === ORIGIN ? x.pathname + x.search : x.href;
    const item = x => ({ url: rel(x), name: decodeURIComponent(x.pathname.split('/').pop() || 'Image'), kind: 'image', mime: '' });
    // Swipe between every image linked from the same page, starting at the tapped one.
    const seen = new Set(), list = [];
    if (doc) for (const a of doc.querySelectorAll('a[href]')) { const x = abs(a.getAttribute('href'), doc.baseURI); if (x && isImage(x) && !seen.has(x.href)) { seen.add(x.href); list.push(x); } }
    if (!seen.has(u.href)) list.unshift(u);
    return V.open(list.map(item), Math.max(0, list.findIndex(x => x.href === u.href)));
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
        <button class="ls-full" data-ls="full" aria-label="Smaller" title="Smaller">⤡</button>
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
      if (!open) return false; open = false; el.classList.remove('peek'); { const fb = el.querySelector('[data-ls="full"]'); if (fb) { fb.textContent = '⤡'; fb.setAttribute('aria-label', 'Smaller'); fb.title = 'Smaller'; } }
      el.classList.remove('open'); panel.style.transform = '';
      hideT = setTimeout(() => { if (!open) { el.hidden = true; stack = []; try { frame.contentWindow.location.replace('about:blank'); } catch (e) {} } }, 260);
      onChange && onChange(false);
      return true;
    }
    function go(href, base, doc) {
      const u = abs(href, base); if (!u) return false;
      if (inApp(u) && isImage(u) && viewImage(u, doc)) return true;
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
      // A bare image reached the frame anyway (redirect, no file extension): show it in the viewer instead.
      if (/^image\//.test(doc.contentType || '') && window.WosChat && window.WosChat.viewer) {
        const img = abs(doc.location.href);
        if (cur() && cur().url === img.href) { if (stack.length > 1) { stack.pop(); popping = true; paint(); load(cur().url); } else close(); }
        viewImage(img); return;
      }
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
        e.preventDefault(); go(u.href, null, doc);
      }, true);
      // Keyboard inside the page: Esc steps back / closes; ⌘/Ctrl+Enter keeps; ⌘/Ctrl+⇧+Enter opens in the browser.
      doc.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const V = window.WosChat && window.WosChat.viewer; if (V && V.isOpen()) V.close(); else back(); return; }
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
      if (k === 'full') { const peek = !el.classList.contains('peek'); el.classList.toggle('peek', peek); b.textContent = peek ? '⤢' : '⤡'; b.setAttribute('aria-label', peek ? 'Full screen' : 'Smaller'); b.title = b.getAttribute('aria-label'); return; }
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
      // Chat-kit links that already open in place: @session threads, Wizard Files, inline media.
      if (a.hasAttribute('data-session') || a.hasAttribute('data-mlink') || a.closest('[data-mi]')) return;
      const u = abs(a.getAttribute('href')); if (!u || !/^https?:$/.test(u.protocol)) return;
      // A thread link to this app inside a Chats thread is left to chats.js, which opens it in place and
      // remembers the thread it came from (Done/Back step back to it).
      const DL0 = window.WizCore && window.WizCore.deeplink, d0 = DL0 && DL0.isOwn(u) ? DL0.parse(u.href) : null;
      if (d0 && d0.session && !d0.video && a.closest('[data-chats]')) { e.preventDefault(); return; }
      e.preventDefault(); e.stopPropagation();
      if (inApp(u) && isImage(u) && viewImage(u, a.ownerDocument)) return;
      // A link to this app itself (…/wizard-os-home/?session=…, ?view=…) opens in place, not in a sheet.
      const DL = window.WizCore && window.WizCore.deeplink;
      if (DL && DL.route(u.href, a)) return;
      // The phone shell can claim a link (sheet.route) to open it on a desk of its own instead of the sheet.
      if (sheet.route && sheet.route(u.href, a)) return;
      sheet.open(u.href);
    }, true);
  }

  /* Hosted (same-origin) app frames: a link that would leave the app (another app, target=_blank/_top,
   * window.open) must never replace Wizard. On Android the WebView loads such links in the MAIN frame
   * (multiple windows are off), which is what made a tapped link take over the whole screen and need
   * several Backs. Links that stay inside the app's own path keep working as normal in-app navigation. */
  function guardFrame(win, base, sheet) {
    let doc; try { doc = win.document; } catch (e) { return; }
    if (!doc || doc.__wizLinkGuard) return; doc.__wizLinkGuard = true;
    const home = String(base || '').split(/[?#]/)[0].replace(/[^/]*$/, '') || '/';
    const leaves = (u, tgt) => u.origin !== ORIGIN || /^_(blank|top|parent)$/i.test(tgt || '') || (home !== '/' && !u.pathname.startsWith(home));
    const go = u => {
      if (u.origin !== ORIGIN) return external(u);
      let fe = null; try { fe = win.frameElement; } catch (e) {}
      // Hosted apps use the same canonical thread/app navigation as chat links.
      // Otherwise a Manager result opens a second Wizard inside the link viewer.
      const DL = window.WizCore && window.WizCore.deeplink;
      if (DL && DL.route(u.href, fe)) return;
      if (sheet.route && sheet.route(u.href, fe)) return;
      sheet.open(u.href);
    };
    doc.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
      // Verified app-owned thread action saves its draft before native navigation.
      if (window.WizAppServices?.ownsThreadLink(win, a)) return;
      const u = abs(a.getAttribute('href'), win.location.href); if (!u || !/^https?:$/.test(u.protocol)) return;
      if (u.origin === ORIGIN && isImage(u)) { if (viewImage(u, doc)) { e.preventDefault(); e.stopPropagation(); } return; }
      if (!leaves(u, a.getAttribute('target'))) return;
      e.preventDefault(); e.stopPropagation(); go(u);
    }, true);
    try {
      const orig = win.open;
      win.open = function (href, tgt, feat) {
        const u = abs(href, win.location.href);
        if (u && /^https?:$/.test(u.protocol) && (tgt == null || tgt === '' || /^_(blank|top|parent)$/i.test(tgt))) { go(u); return null; }
        return orig.call(win, href, tgt, feat);
      };
    } catch (e) {}
  }

  window.WizLinks = { mount, intercept, guardFrame, viewImage: href => viewImage(abs(href)), inApp: href => inApp(abs(href)) };
})();
