/* Wizard UX core: deep links (feature/chat-polish). Both shells.
 *
 *   ?session=<id>          open that thread inside the app (same path as the Android ACTION_THREAD handoff)
 *   ?view=<name>[&section] open a screen: inbox | work | chats | apps | settings | files | day | week | month | help | tour
 *   ?video=<32 hex>        play a Wizard attachment in the in-app viewer (checked with HEAD: must be video/*)
 *   ?open=<app id>         open an app (the desktop already had this; the phone gets it too)
 * A session is more specific than a view, so it wins when both are present (legacy deepLink.ts).
 * The params are removed from the address bar once used (history entry and its state are kept), so a
 * reload doesn't replay them and Back walks the app's own stack: thread → Chats list → Home, never out.
 *
 * Shells register handlers once: WizCore.deeplink.handle({ thread(id), view(name, section), video(item), app(id) })
 * then call WizCore.deeplink.consume() when they're ready. Links inside messages to this app's own URL
 * (…/wizard-os-home/?session=…) go through WizCore.deeplink.route(url) instead of reloading the page.
 */
(() => {
  'use strict';
  const C = window.WizCore = window.WizCore || {};
  const SESSION_ID = /^(?!\.{1,2}$)[A-Za-z0-9._:-]{1,180}$/;
  const VIDEO_ID = /^[a-f0-9]{32}$/;
  const VIEWS = new Set(['home', 'inbox', 'work', 'chats', 'apps', 'store', 'settings', 'files', 'day', 'week', 'month', 'usage', 'help', 'tour']);
  const SECTIONS = new Set(['errors', 'working', 'ready', 'yesterday', 'pastWeek', 'deferred', 'archive', 'drafts']);
  const KEYS = ['session', 'view', 'section', 'video', 'open'];
  let H = null;
  const log = s => { window.__deeplinkLog = (window.__deeplinkLog || []).concat(s).slice(-30); };

  function parse(href) {
    let u; try { u = new URL(href, location.href); } catch (e) { return null; }
    const q = u.searchParams, out = {};
    const sid = (q.get('session') || '').trim(); if (SESSION_ID.test(sid)) out.session = sid;
    const view = (q.get('view') || '').trim(); if (!out.session && VIEWS.has(view)) { out.view = view; const s = q.get('section') || ''; if (SECTIONS.has(s)) out.section = s === 'deferred' ? 'ready' : s; } // Deferred lives at the bottom of Ready
    const vid = (q.get('video') || '').trim().toLowerCase(); if (VIDEO_ID.test(vid)) out.video = vid;
    const open = (q.get('open') || '').trim(); if (!out.session && !out.view && /^[a-z0-9-]{1,40}$/i.test(open)) out.open = open;
    return Object.keys(out).length ? out : null;
  }
  // Is this a link to this app (the Wizard UX page itself), as opposed to another app on the origin?
  function isOwn(u) {
    if (!u || u.origin !== location.origin) return false;
    const here = location.pathname.replace(/[^/]*$/, ''); // …/wizard-os-home/
    return u.pathname === here || u.pathname === here + 'index.html' || u.pathname === here + 'desktop.html';
  }
  async function playVideo(id) {
    const url = `/wizard/attachments/${id}`;
    try {
      const r = await fetch(url, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
      const mime = (r.headers.get('content-type') || '').split(';')[0].trim();
      if (!r.ok || !mime.startsWith('video/')) { log('video:unavailable'); H?.toast?.('▶', 'That video isn’t available', 2200); return false; }
      const cd = r.headers.get('content-disposition') || '';
      const name = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1] || '') || (cd.match(/filename="?([^";]+)"?/i) || [])[1] || 'Video';
      log('video:open');
      return !!H?.video?.({ url, mime, name, kind: 'video', id });
    } catch (e) { log('video:error'); return false; }
  }
  function run(d, src) {
    if (!d || !H) return false;
    if (d.session) { log('session:' + d.session); H.thread(d.session); }
    else if (d.view) { log('view:' + d.view); H.view(d.view, d.section || ''); }
    else if (d.open) { log('open:' + d.open); H.app?.(d.open, src || null); }
    if (d.video) playVideo(d.video);
    return true;
  }
  function strip() {
    const u = new URL(location.href); let had = false;
    for (const k of KEYS) if (u.searchParams.has(k)) { u.searchParams.delete(k); had = true; }
    if (had) history.replaceState(history.state, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams : '') + u.hash);
  }
  C.deeplink = {
    parse, isOwn,
    handle(h) { H = h; },
    /* Use the page's own deep link once, then take it out of the address bar. */
    consume() { const d = parse(location.href); strip(); if (d) run(d); return d; },
    /* A link clicked inside the app. True when it was ours and is now open in-app. src = the tapped link, so
     * an app it opens knows where it came from (Back closes it and lands there again). */
    route(href, src) { let u; try { u = new URL(href, location.href); } catch (e) { return false; } if (!isOwn(u)) return false; const d = parse(u.href); if (!d) return false; run(d, src); return true; },
    get log() { return window.__deeplinkLog || []; },
  };
})();
