/* Wizard UX skin host › the orb bar: how a full-screen app's bottom tab bar is laid out around the orb, and the
 * room the orb takes at the bottom of every app window. Moved verbatim out of core/skin-host.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The skin host (core/skin-host.js) calls
 * this once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names skin-host.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before core/skin-host.js. The body below keeps
 * skin-host.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.skinHostParts = window.WizCore.skinHostParts || {};
window.WizCore.skinHostParts.orbbar = function ({  }) {
  const insetHolders = new Map(), insetOrbs = new Map(), insetPlaces = new Map(), frameSpots = new WeakMap(), insetSheets = new WeakMap(), insetWatch = new WeakMap(), insetFonts = new WeakSet();
  /* The orb bar (Miguel, 2 Nov 2026; the Wizard standard for every full-screen app): the orb has ONE fixed spot, bottom
   * centre, and an app's own bottom tab bar is laid out around it, its tabs split evenly left and right of the orb (an
   * empty slot as wide as the orb in the middle), all on the orb's row; never under it, never covering it. Without an
   * orb over the frame's bottom centre (desktop), the bar is lifted clear of the orb instead, as before. */
  const ORB_BAR = 'html.wos-orb-bar [data-wos-inset-bar]{height:auto!important;min-height:0!important;padding-bottom:0!important;margin-bottom:0!important}'
    + 'html.wos-orb-bar [data-wos-tabs]{display:flex!important;flex-flow:row nowrap!important;align-items:center!important;justify-content:flex-start!important;gap:0!important;'
    + 'box-sizing:border-box!important;min-height:calc(2*var(--wos-orb-cy,40px))!important;height:auto!important;padding-top:0!important;padding-bottom:0!important;padding-left:0!important;padding-right:0!important;margin-bottom:0!important}'
    + 'html.wos-orb-bar [data-wos-tabs="inner"]{background:none!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important}'
    + 'html.wos-orb-bar [data-wos-tabs]::after{content:""!important;display:block!important;position:static!important;order:2!important;flex:0 0 var(--wos-orb-slot,80px)!important;align-self:stretch!important;background:none!important;border:0!important}'
    + 'html.wos-orb-bar [data-wos-flat]{display:contents!important}'
    + 'html.wos-orb-bar [data-wos-tab]{order:1!important;flex:0 0 calc((100% - var(--wos-orb-slot,80px))/2*var(--wos-tab-f,1))!important;min-width:0!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:2px!important;padding-right:2px!important;box-sizing:border-box!important;flex-direction:column!important;justify-content:center!important;align-items:center!important;row-gap:2px!important;column-gap:0!important;text-align:center!important}'
    + 'html.wos-orb-bar [data-wos-tab="r"]{order:3!important}'
    // no tab right of the orb (a bar of one): the slot takes the orb and the empty right half, so the orb stays centred
    + 'html.wos-orb-bar [data-wos-tabs][data-wos-nr="0"]::after{flex-basis:calc(var(--wos-orb-slot,80px) + (100% - var(--wos-orb-slot,80px))/2)!important}'
    // a label is always whole: no ellipsis, no clipping; smaller (--wos-fs) or on two lines only when tabFit says so
    + 'html.wos-orb-bar [data-wos-fs]{white-space:nowrap!important;overflow:visible!important;text-overflow:clip!important;max-width:none!important;min-width:0!important;flex-shrink:0!important}'
    + 'html.wos-orb-bar [data-wos-fs][data-wos-small]{font-size:var(--wos-fs)!important}'
    + 'html.wos-orb-bar [data-wos-fs][data-wos-wrap]{white-space:normal!important;overflow-wrap:normal!important;word-break:normal!important;text-align:center!important;line-height:1.15!important}'
    // equal parts until tabFit has measured the labels (it then sets --wos-tab-f on each tab: its share of its side)
    + [1, 2, 3, 4].map(n => `html.wos-orb-bar [data-wos-tabs][data-wos-nl="${n}"] [data-wos-tab="l"],html.wos-orb-bar [data-wos-tabs][data-wos-nr="${n}"] [data-wos-tab="r"]{--wos-tab-f:${+(1 / n).toFixed(4)}}`).join('');
  /* Round 6 (Miguel, 2 Nov 2026: "never waste a whole band at the bottom"): a block of controls along the bottom that is
   * not a tab bar (Messenger's composer and filter chips, Notes' footer, the Troubleshooter's composer, Mail's Load more)
   * keeps its own place and height; the orb takes a compact spot of its own at the END of the block's lowest row of
   * controls (the row makes room for it: data-wos-end), so no band is added under the app. html.wos-orb-end turns the
   * old lift off; the lift stays only as the fallback when the row has no room for the orb. */
  const ORB_END = 'html.wos-orb-end{--wos-inset-b:0px!important}'
    + 'html.wos-orb-end [data-wos-end="row"]{padding-right:var(--wos-end-pad)!important;box-sizing:border-box!important}'
    + 'html.wos-orb-end [data-wos-end="self"]{margin-right:var(--wos-end-pad)!important;max-width:calc(100% - var(--wos-end-pad))!important}'
    + 'html.wos-orb-end [data-wos-endpad="p"]{padding-bottom:var(--wos-end-pb)!important}'
    + 'html.wos-orb-end [data-wos-endpad="m"]{margin-bottom:var(--wos-end-pb)!important}';
  const INSET_CSS = '.wz-scroll::after,html.wos-inset-doc>body::after,[data-wos-inset-scroll]::after{content:"";display:block;flex:none;grid-column:1/-1;height:var(--wos-inset-b,0px);pointer-events:none}'
    + 'html:not(.wos-orb-bar):not(.wos-orb-end) [data-wos-inset-bar]:not([data-wos-lift="self"]){height:auto!important;padding-bottom:calc(var(--wos-inset-b,0px) - 12px)!important}'
    // a lone control along the bottom (Mail's Load more) keeps its own shape and is pushed up by a margin instead
    + 'html:not(.wos-orb-bar):not(.wos-orb-end) [data-wos-inset-bar][data-wos-lift="self"]{margin-bottom:calc(var(--wos-inset-b,0px) - 12px)!important}'
    + 'html:not(.wos-orb-bar):not(.wos-orb-end) [data-wos-float]{translate:0 calc(-1 * var(--wos-lift,0px))!important}' + ORB_BAR + ORB_END;
  const setAttr = (n, k, v) => { if (v == null) { if (n.hasAttribute(k)) n.removeAttribute(k); } else if (n.getAttribute(k) !== v) n.setAttribute(k, v); };
  const WOS_MARKS = ['data-wos-tabs', 'data-wos-tab', 'data-wos-flat', 'data-wos-nl', 'data-wos-nr', 'data-wos-fs', 'data-wos-small', 'data-wos-wrap'];
  const WOS_MARKED = '[data-wos-tabs],[data-wos-tab],[data-wos-flat],[data-wos-fs]';
  const unmark = n => { for (const k of WOS_MARKS) setAttr(n, k, null); n.style?.removeProperty?.('--wos-tab-f'); n.style?.removeProperty?.('--wos-fs'); };
  /* The tabs of a bottom bar: its buttons / links / tabs on the bar's lowest row (2 to 8 of them, none full width). Their
   * nearest common box becomes the tab row; wrappers in between flatten (display: contents), so the tabs themselves are
   * what gets split, whatever groups the app put them in. Returns false when the bar has no such row. */
  function orbTabs(d, bar, vw) {
    const old = [...d.querySelectorAll(WOS_MARKED)];
    const vis = n => n.getClientRects().length > 0 && d.defaultView.getComputedStyle(n).visibility !== 'hidden';
    let tabs = [...bar.querySelectorAll('button,a[href],[role="tab"],[role="radio"]')].filter(n => vis(n) && !n.parentElement.closest('button,a[href],[role="tab"],[role="radio"]'))
      .map(n => ({ n, r: n.getBoundingClientRect() })).filter(t => t.r.width < vw * .7 && t.r.height >= 20);
    const low = Math.max(...tabs.map(t => t.r.top + t.r.height / 2));
    tabs = tabs.filter(t => Math.abs(t.r.top + t.r.height / 2 - low) < 16).sort((x, y) => x.r.left - y.r.left);
    if (!tabs.length || tabs.length > 8) { for (const n of old) unmark(n); return false; }
    let row = tabs[0].n.parentElement;
    while (row && row !== bar && !tabs.every(t => row.contains(t.n))) row = row.parentElement;
    if (!row || !bar.contains(row) && row !== bar) return false;
    // a row that also holds another kind of control (a date picker, a field: Morning Report's ‹ date › PDF) is not a
    // tab bar: splitting it would crush that control at the row's start; the orb takes the row's end instead
    const isTab = new Set(tabs.map(t => t.n));
    if ([...row.querySelectorAll('select,input,textarea')].some(n => n.getAttribute('type') !== 'hidden' && vis(n) && !isTab.has(n) && Math.abs(n.getBoundingClientRect().top + n.getBoundingClientRect().height / 2 - low) < 16)) { for (const n of old) unmark(n); return false; }
    const nl = Math.ceil(tabs.length / 2), keep = new Set([row]);
    tabs.forEach((t, i) => {
      keep.add(t.n); setAttr(t.n, 'data-wos-tab', i < nl ? 'l' : 'r');
      for (let p = t.n.parentElement; p && p !== row; p = p.parentElement) { keep.add(p); setAttr(p, 'data-wos-flat', ''); }
    });
    setAttr(row, 'data-wos-tabs', row === bar ? 'bar' : 'inner'); setAttr(row, 'data-wos-nl', String(nl)); setAttr(row, 'data-wos-nr', String(tabs.length - nl));
    // a label keeps its marks while its tab is still a tab (tabFit re-measures it); everything else goes
    for (const n of old) if (!keep.has(n) && !(n.hasAttribute('data-wos-fs') && !n.hasAttribute('data-wos-tab') && keep.has(n.parentElement?.closest?.('[data-wos-tab]')))) unmark(n);
    return true;
  }
  /* Every label whole (Miguel, 2 Nov 2026: with three tabs two share a side, and Podcasts' 'Discover' was cut to
   * 'Dis…'). Each side of the orb is shared by its tabs in proportion to what they need (label or icon, plus a little
   * room, at least 44 px), not in equal parts; only when a side is still too tight do the labels get smaller, both
   * sides alike and never under 10 px, and as a last resort a label of several words takes two lines. Pure: sides =
   * [left, right], each tab { icon, text, word, fs } in px at the app's own size; room = px per side. Returns the scale,
   * whether labels wrap, and each tab's share of its side (each side's shares add up to 1). */
  function tabFit(sides, room) {
    const PAD = 6, MIN = 44, all = sides.flat();
    const need = (t, s, wrap) => Math.max(MIN, Math.max(t.icon || 0, (wrap ? t.word : t.text) * s) + PAD);
    const sum = (side, s, wrap) => side.reduce((n, t) => n + need(t, s, wrap), 0);
    const fits = (s, wrap) => sides.every(side => sum(side, s, wrap) <= room + .01);
    const floor = Math.min(1, Math.max(.5, ...all.filter(t => t.text > 0 && t.fs > 0).map(t => 10 / t.fs)));
    // the app's own size if it fits; else a little smaller, 2 % at a time down to the floor; else two lines as well
    let best = null;
    for (const wrap of [false, true]) {
      for (let k = 100; k >= Math.ceil(floor * 100) && !best; k -= 2) if (fits(k / 100, wrap)) best = { s: k / 100, wrap };
      if (best) break;
    }
    const { s, wrap } = best || { s: floor, wrap: true };
    const share = sides.map(side => {
      const ns = side.map(t => need(t, s, wrap)), total = ns.reduce((a, b) => a + b, 0), extra = Math.max(0, room - total) / (side.length || 1);
      return ns.map(n => (n + extra) / Math.max(room, total));
    });
    return { s, wrap, share };
  }
  const fitCanvas = new WeakMap();
  /* Measure the split tabs' labels (canvas text metrics at the app's own font, so it never depends on the current
   * squeeze) and apply tabFit: --wos-tab-f on each tab, a smaller --wos-fs / two lines on labels only when needed. */
  function fitTabs(d, row) {
    const win = d.defaultView, tabs = [...row.querySelectorAll('[data-wos-tab]')];
    if (!tabs.length || !win) return;
    let cx = fitCanvas.get(d);
    if (!cx) { cx = d.createElement('canvas').getContext?.('2d'); if (!cx) return; fitCanvas.set(d, cx); }
    const shown = n => n.getClientRects().length > 0 && !/^(absolute|fixed)$/.test(win.getComputedStyle(n).position);
    const info = tabs.map(tab => {
      const t = { tab, icon: 0, text: 0, word: 0, fs: 0, labels: [] }, byEl = new Map();
      const walk = d.createTreeWalker(tab, 4);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement, tx = n.nodeValue.replace(/\s+/g, ' ').trim();
        if (!tx || !el || !shown(el)) continue;
        let p = el; while (p && p !== tab && shown(p)) p = p.parentElement;
        if (p !== tab) continue;   // inside a badge (positioned) or something hidden: not a label
        byEl.set(el, (byEl.get(el) || '') + (byEl.has(el) ? ' ' : '') + tx);
      }
      for (const [el, tx] of byEl) {
        // the app's own size: what it computes now, unless tabFit made it smaller (then the size it had before)
        const cs = win.getComputedStyle(el), fs0 = (el.hasAttribute('data-wos-small') && parseFloat(el.getAttribute('data-wos-fs'))) || parseFloat(cs.fontSize) || 14;
        const tr = cs.textTransform === 'uppercase' ? tx.toUpperCase() : tx, ls = parseFloat(cs.letterSpacing) || 0;
        cx.font = `${cs.fontStyle} ${cs.fontWeight} ${fs0}px ${cs.fontFamily}`;
        const m = str => cx.measureText(str).width + ls * str.length;
        t.text = Math.max(t.text, m(tr)); t.word = Math.max(t.word, ...tr.split(' ').map(m)); t.fs = Math.max(t.fs, fs0);
        t.labels.push({ el, fs0, words: tr.includes(' ') });
      }
      for (const el of tab.querySelectorAll('svg,img,i,[class*="icon"],[class*="ico"]')) if (!el.textContent.trim() && shown(el)) t.icon = Math.max(t.icon, el.getBoundingClientRect().width);
      return t;
    });
    const slot = parseFloat(d.documentElement.style.getPropertyValue('--wos-orb-slot')) || 80;
    const room = (row.getBoundingClientRect().width - slot) / 2;
    if (!(room > 0)) return;
    const sides = [info.filter(t => t.tab.getAttribute('data-wos-tab') === 'l'), info.filter(t => t.tab.getAttribute('data-wos-tab') === 'r')];
    const fit = tabFit(sides.map(side => side.map(({ icon, text, word, fs }) => ({ icon, text, word, fs }))), room);
    sides.forEach((side, i) => side.forEach((t, j) => {
      t.tab.style.setProperty('--wos-tab-f', fit.share[i][j].toFixed(4));
      for (const l of t.labels) {
        setAttr(l.el, 'data-wos-fs', String(l.fs0));
        if (fit.s < 1) { l.el.style.setProperty('--wos-fs', (l.fs0 * fit.s).toFixed(2) + 'px'); setAttr(l.el, 'data-wos-small', ''); }
        else { l.el.style.removeProperty('--wos-fs'); setAttr(l.el, 'data-wos-small', null); }
        setAttr(l.el, 'data-wos-wrap', fit.wrap && l.words ? '' : null);
      }
    }));
  }
  /* Round 5 (Miguel, 2 Nov 2026: "the orb floats over Messenger"): an app's bottom controls are not always a kit tab
   * bar. bottomBar finds the outermost block along the bottom of the page that holds controls and stays put: at least
   * 80 % of the page wide, at most 45 % tall, in its lower half, its bottom within 24 px of the page's, not inside
   * anything that scrolls (and pinned when the page itself scrolls). Sampled under a few points of the bottom edge. */
  const CONTROLS = 'button,a[href],input:not([type="hidden"]),textarea,select,[role="button"],[role="tab"],[role="radio"],[contenteditable="true"]';
  const ENTRY = 'textarea,input:not([type]),input[type="text"],input[type="search"],[contenteditable="true"]';
  const isTabBar = n => /^(NAV|FOOTER)$/.test(n.tagName) || /^(navigation|tablist)$/.test(n.getAttribute('role') || '');
  const shownIn = (d, n) => n.getClientRects().length > 0 && d.defaultView.getComputedStyle(n).visibility !== 'hidden';
  const hasEntry = (d, bar) => [...bar.querySelectorAll(ENTRY)].some(n => shownIn(d, n));
  /* (round 6) at = the orb's x in the page (0-1): a narrower block right under the orb counts too (at least 35 % of the
   * page wide), e.g. the desktop Messenger's thread composer beside its list */
  function bottomBar(d, vw, vh, at = null) {
    const win = d.defaultView, cs = n => win.getComputedStyle(n), se = d.scrollingElement;
    const scrolls = n => /(auto|scroll)/.test(cs(n).overflowY) && n.scrollHeight > n.clientHeight + 2;
    const docScrolls = !!se && se.scrollHeight > se.clientHeight + 4;
    const fits = r => r.width >= vw * (at == null ? .8 : .35) && r.height > 0 && r.height <= vh * .45 && r.top >= vh * .45 && r.bottom >= vh - 24 && r.bottom <= vh + 2;
    let best = null;
    for (const fx of at == null ? [.5, .2, .8] : [at]) for (const dy of [3, 16, 32, 56]) {
      let cand = null, pinned = false;
      for (let n = d.elementFromPoint(vw * fx, vh - dy); n && n !== d.body && n !== d.documentElement; n = n.parentElement) {
        if (scrolls(n)) { cand = null; break; }   // inside a list: content, not controls
        if (/^(fixed|sticky)$/.test(cs(n).position)) pinned = true;
        if (fits(n.getBoundingClientRect())) cand = n;   // the outermost fit wins
      }
      if (!cand || (docScrolls && !pinned)) continue;
      if (!cand.matches(CONTROLS) && ![...cand.querySelectorAll(CONTROLS)].some(n => shownIn(d, n))) continue;
      if (!best || cand.contains(best)) best = cand;
      else if (!best.contains(cand) && cand.getBoundingClientRect().height > best.getBoundingClientRect().height) best = cand;
    }
    return best;
  }
  /* A button floating just above the bar (Messenger's compose ✎, positioned from the page's bottom) would sit on the bar
   * once the bar is lifted: it rises by the same amount (data-wos-float; --wos-lift = how far the bar's top moved). Found
   * once, when the bar is first found, so a risen button is never let go of on the next look. */
  function floatsOver(d, bar, vw) {
    const win = d.defaultView;
    bar.removeAttribute('data-wos-inset-bar'); const top0 = bar.getBoundingClientRect().top; bar.setAttribute('data-wos-inset-bar', '');
    const near = [];
    for (const n of d.body.querySelectorAll('*')) {
      if (bar.contains(n) || n.contains(bar)) continue;
      const cs = win.getComputedStyle(n); if (!/^(absolute|fixed)$/.test(cs.position) || !shownIn(d, n)) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 24 || r.width > vw * .4 || r.bottom > top0 + 4 || r.bottom < top0 - 120 || n.parentElement?.closest('[data-wos-float]')) continue;
      if (n.matches(CONTROLS) || n.querySelector(CONTROLS)) near.push(n);
    }
    // the bar's padding (the inset CSS) applies once it is marked: how far its top moved up is how far they rise
    const lift = Math.max(0, Math.round(top0 - bar.getBoundingClientRect().top));
    d.documentElement.style.setProperty('--wos-lift', lift + 'px');
    for (const n of near) n.setAttribute('data-wos-float', '');
  }
  /* Round 6: the lowest row of controls in a bottom block, where the orb takes the row's end. A lone control (Mail's Load
   * more) is its own row ('self'); else the controls whose middles sit within 16 px of the lowest one, and their
   * nearest common box is the row. Pure on the DOM it is given (tests run it on a fake one). */
  const NESTED = 'button,a[href],[role="button"],[role="tab"],[role="radio"]';
  function endRow(d, bar) {
    if (bar.matches(CONTROLS)) return { row: bar, self: true, ctrls: [bar] };
    let ctrls = [...bar.querySelectorAll(CONTROLS)].filter(n => shownIn(d, n) && !n.parentElement?.closest(NESTED))
      .map(n => ({ n, r: n.getBoundingClientRect() })).filter(c => c.r.height >= 20 && c.r.width > 0);
    if (!ctrls.length) return null;
    const low = Math.max(...ctrls.map(c => c.r.top + c.r.height / 2));
    ctrls = ctrls.filter(c => Math.abs(c.r.top + c.r.height / 2 - low) < 16).sort((x, y) => x.r.left - y.r.left);
    let row = ctrls.length === 1 ? ctrls[0].n.parentElement : ctrls[0].n.parentElement;
    while (row && row !== bar && !ctrls.every(c => row.contains(c.n))) row = row.parentElement;
    if (!row || (row !== bar && !bar.contains(row))) return null;
    return { row, self: false, ctrls: ctrls.map(c => c.n) };
  }
  /* The orb's size and room in that row: as tall as the row's controls plus a little (never under 40 px, never over the
   * orb's own size), and an 8 px gap before it. */
  const endSize = (h, od) => { const D = Math.round(Math.max(40, Math.min(od, h + 8))); return { D, slot: D + 8 }; };
  function clearEnd(d) {
    for (const n of d.querySelectorAll('[data-wos-end],[data-wos-endpad]')) { n.removeAttribute('data-wos-end'); n.removeAttribute('data-wos-endpad'); n.style?.removeProperty?.('--wos-end-pad'); n.style?.removeProperty?.('--wos-end-pb'); }
  }
  /* Put the orb at the end of the bar's lowest row (viewport spot { x, y, d } for the view's orb), or null when the row
   * has no room for it (the bar is then lifted, as before). o = the orb's own spot (untransformed), fr = the frame. */
  function orbEnd(d, bar, o, fr) {
    const html = d.documentElement, win = d.defaultView;
    html.classList.add('wos-orb-end');   // no lift while measuring: the bar where the app put it
    clearEnd(d);
    const p = endRow(d, bar);
    const fail = () => { clearEnd(d); html.classList.remove('wos-orb-end'); return null; };
    if (!p) return fail();
    const { row, self, ctrls } = p, vw = html.clientWidth;
    const h = Math.max(...ctrls.map(c => c.getBoundingClientRect().height)), { D, slot } = endSize(h, o.d);
    // the orb takes the row's own end padding too (4-8 px left between it and the edge), so the row gives up as little
    // as it can (Messenger's chips keep every chip whole)
    const pr = Math.min(8, Math.max(4, parseFloat(self ? win.getComputedStyle(row).marginRight : win.getComputedStyle(row).paddingRight) || 0));
    row.style.setProperty('--wos-end-pad', (pr + slot) + 'px');
    row.setAttribute('data-wos-end', self ? 'self' : 'row');
    // the row's middle on the orb's own line: a row lower than the orb rises by the difference (the bar's bottom padding,
    // the room a phone keeps over its home bar); a row higher than it takes the orb up to it
    const mid = () => { const rs = ctrls.map(c => c.getBoundingClientRect()); return rs.reduce((n, r) => n + r.top + r.height / 2, 0) / rs.length; };
    const oy = o.y - fr.top, below = mid() - oy;
    if (below > 1) {
      // (a lone control rises by a margin, keeping its own shape)
      const pb = parseFloat(self ? win.getComputedStyle(bar).marginBottom : win.getComputedStyle(bar).paddingBottom) || 0;
      bar.style.setProperty('--wos-end-pb', Math.round(pb + below) + 'px'); bar.setAttribute('data-wos-endpad', self ? 'm' : 'p');
    }
    const rr = row.getBoundingClientRect(), cx = self ? rr.right + 8 + D / 2 : rr.right - pr - D / 2;   // (a lone control: its own margin stays past the orb)
    // room check: the row's controls end before the orb's spot, nothing spills, the spot is on the page
    const left = cx - D / 2 - 4;
    if (cx + D / 2 > vw - 1 || cx - D / 2 < 0) return fail();
    for (const c of ctrls) {
      const r = c.getBoundingClientRect(); if (r.right > left + 1 || r.left < -1) return fail();
      // nor cut by a strip that scrolls or clips (a chip half under its neighbour)
      for (let n = c.parentElement; n && n !== row.parentElement; n = n.parentElement) {
        if (win.getComputedStyle(n).overflowX === 'visible') continue;
        const b = n.getBoundingClientRect(); if (r.right > b.right + 1 || r.left < b.left - 1) return fail();
      }
    }
    if (!self && row.scrollWidth > row.clientWidth + 1) return fail();
    return { x: fr.left + cx, y: fr.top + mid(), d: D };
  }
  // the list a page scrolls in (no kit scroll area): the scroller under the middle of the page, nearly full width
  function mainScroller(d, vw, vh) {
    const win = d.defaultView;
    for (let n = d.elementFromPoint(vw / 2, vh * .6); n && n !== d.body && n !== d.documentElement; n = n.parentElement) {
      const r = n.getBoundingClientRect();
      if (r.width >= vw * .8 && /(auto|scroll)/.test(win.getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 2) return n;
    }
    return null;
  }
  return { bottomBar, clearEnd, CONTROLS, fitTabs, floatsOver, frameSpots, hasEntry, INSET_CSS, insetFonts, insetHolders, insetOrbs, insetPlaces, insetSheets, insetWatch, isTabBar, mainScroller, orbEnd, orbTabs, setAttr, shownIn, unmark, WOS_MARKED };
};
