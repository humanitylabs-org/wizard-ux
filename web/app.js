/* Wizard OS — home shell prototype */
(() => {
  'use strict';
  if (document.documentElement.dataset.leaving) return; // core/shell.js is switching to the other shell
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vib = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
  const D = window.WIZ_DATA || { threads: [], projects: {} };
  const LIVE = window.WizLive;
  const OUTBOX = window.WosOutbox || null;
  const S = window.WIZ_SUMM || { days: {}, weeks: {}, month: '' };
  const device = $('#device');
  // In-app browser for links tapped in Wizard (core/links.js). Mounted once the window manager exists.
  let LINKS = null;
  const TODAY = (D.generated || '2026-10-08').slice(0, 10);
  // Desk strip (James, 10 Oct 2026): Home is pinned at the far left, Chats sits next to it, every new thing
  // opens on its own desk right beside the one in front, and a desk goes away when its last window closes.
  const HOME = 0;

  /* ---------------- dates ---------------- */
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dt = d => new Date(d + 'T00:00:00Z');
  const iso = x => x.toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = dt(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
  const weekOf = d => { const x = dt(d); return addDays(d, -((x.getUTCDay() + 6) % 7)); };
  const fmtDay = d => { const x = dt(d); return `${DOW[x.getUTCDay()]} ${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; };
  const fmtDayLong = d => { const x = dt(d); return `${DOWL[x.getUTCDay()]} ${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; };
  const fmtRange = (a, b) => { const x = dt(a), y = dt(b); return x.getUTCMonth() === y.getUTCMonth() ? `${x.getUTCDate()} – ${y.getUTCDate()} ${MON[y.getUTCMonth()]}` : `${x.getUTCDate()} ${MON[x.getUTCMonth()]} – ${y.getUTCDate()} ${MON[y.getUTCMonth()]}`; };
  const YESTERDAY = addDays(TODAY, -1);

  /* ---------------- data ---------------- */
  const PCOL = { 'wizard-os': '#b99bff', 'wizard-app': '#7c5cff', mizel: '#3fe0ff', clips: '#ffbe55', signal: '#ff5ccf', music: '#4ff0b0', wisdom: '#a6e35f', business: '#ff8a5c', infra: '#8aa0c8', life: '#e9dcff' };
  const PICON = { 'wizard-os': '✦', 'wizard-app': '◈', mizel: '◉', clips: '▶', signal: '◎', music: '♫', wisdom: '☯', business: '◆', infra: '⌬', life: '✺' };
  const byDay = {}, byId = {};
  for (const t of D.threads) { (byDay[t.day] = byDay[t.day] || []).push(t); byId[t.id] = t; }
  const allDays = []; { let d = weekOf(D.threads.length ? D.threads.reduce((m, t) => t.day < m ? t.day : m, TODAY) : TODAY); while (d <= TODAY) { allDays.push(d); d = addDays(d, 1); } }
  const weeks = [...new Set(allDays.map(weekOf))].sort();
  const threadsIn = days => days.flatMap(d => byDay[d] || []);
  const msgCount = ts => ts.reduce((s, t) => s + (t.n || 0), 0);
  function projMix(ts) {
    const m = {}; for (const t of ts) m[t.p] = (m[t.p] || 0) + (t.n || 1);
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }
  function bars(ts) {
    const mix = projMix(ts), tot = mix.reduce((s, x) => s + x[1], 0) || 1;
    return `<div class="bars">${mix.map(([p, v]) => `<i style="flex:${v / tot};background:${PCOL[p]}"></i>`).join('')}</div>`;
  }
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

  /* ---------------- apps ---------------- */
  // The registry lives in core/apps.js (shared with the desktop shell); the phone gets its own list.
  const { APPS, APP, findApp, appByName, quickSearch, searchUrl } = window.WizCore.apps('mobile');
  const norm = window.WizCore.norm;

  /* ---------------- state ---------------- */
  const tourEv = (type, d) => { try { window.WosTour?.event?.(type, d || {}); } catch (e) { console.error(e); } };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('wos.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('wos.' + k, JSON.stringify(v)); } catch (e) {} },
  };
  /* ---------------- desks hold tiled windows ----------------
   * A desk is a workspace, not an app. It holds up to four windows tiled
   * Omarchy-style: small gaps, rounded corners, wallpaper bleeding through.
   * Windows can be focused, made full screen (pinch out or double-tap the title
   * bar), moved to another desk, or closed. Nothing is pinned anywhere. */
  const MAXW = 4;
  const newId = () => 'w' + Math.random().toString(36).slice(2, 9);
  const newDid = () => 'd' + Math.random().toString(36).slice(2, 9);
  const blank = (o = {}) => ({ id: newDid(), wins: [], focus: null, full: false, ...o });
  // New storage keys: the shipped five-desk layout (wos.wins / wos.desks3) is read once and left untouched.
  let W = store.get('wins4', null), desks = store.get('strip', null);
  function migrateFive() {
    const oW = store.get('wins', null), oD = store.get('desks3', null);
    if (!oW || typeof oW !== 'object' || !Array.isArray(oD)) return false;
    W = {}; desks = [blank({ id: 'home', home: true })];
    const hasChats = d => d.wins.some(id => oW[id]?.app === 'chats');
    const order = oD.map((d, i) => ({ d, i })).filter(x => x.d && Array.isArray(x.d.wins) && x.d.wins.some(id => oW[id]));
    order.sort((x, y) => (hasChats(y.d) - hasChats(x.d)) || x.i - y.i); // Chats right of Home, the rest in their old order
    for (const { d } of order) {
      const wins = d.wins.filter(id => oW[id]).slice(0, MAXW); wins.forEach(id => { W[id] = JSON.parse(JSON.stringify(oW[id])); });
      desks.push(blank({ wins, focus: wins.includes(d.focus) ? d.focus : wins[wins.length - 1], full: !!d.full }));
    }
    return true;
  }
  function seedApps() {
    for (const appId of ['topics', 'mizel']) if (APP[appId] && !Object.values(W).some(w => w.app === 'frame' && w.appId === appId)) { const id = newId(); W[id] = { id, app: 'frame', appId }; desks.push(blank({ wins: [id], focus: id })); }
  }
  function freshLayout() {
    W = {}; desks = [blank({ id: 'home', home: true })];
    const c = { id: newId(), app: 'chats', thread: null }; W[c.id] = c; desks.push(blank({ wins: [c.id], focus: c.id }));
    if (APP['v-day']) { const r = { id: newId(), app: 'review', z: { level: 'day', day: YESTERDAY } }; W[r.id] = r; desks.push(blank({ wins: [r.id], focus: r.id })); }
    seedApps();
  }
  const okStrip = () => W && typeof W === 'object' && Array.isArray(desks) && desks.length > 0 && desks[0] && desks[0].home && desks.every(d => d && d.id && Array.isArray(d.wins));
  if (!okStrip()) { if (migrateFive()) store.set('stripSeeded', true); else { freshLayout(); store.set('stripSeeded', !!(APP.topics || APP.mizel)); } }
  // Mizel.ai moved from the old Meetings view (/meetings/, /mizel-preview/) to the canonical Mizel Live view.
  // A frame window remembers the page it was on, so a saved Mizel desk would keep the retired view: move it.
  Object.values(W).forEach(w => { if (w && w.app === 'frame' && w.appId === 'mizel' && /^\/(meetings|mizel-preview|apps)(\/|$)|^\/$/.test(w.url || '')) delete w.url; });
  // Apps from the Agent Service can arrive after first paint (fresh install, cleared cache): a frame window
  // painted before its app was known has no page yet, so draw that desk again once the app list lands.
  const reframe = () => {
    desks.forEach((d, i) => { if (d.wins.some(id => { const w = W[id], u = w?.app === 'frame' && !w.url && APP[w.appId]?.url;
      if (!u) return false; const f = document.querySelector(`.win[data-win="${id}"] iframe`); if (f && f.getAttribute('src') === u) return false;
      winEl(id)?.remove(); return true; })) { try { renderDesk(i); } catch (e) {} } });
  };
  const lateLayout = () => {
    if (store.get('stripSeeded', false) || !(APP.topics || APP.mizel)) return;
    seedApps(); store.set('stripSeeded', true); try { save(); syncDesks(); } catch (e) {}
  };
  window.addEventListener('wizard:apps', () => { lateLayout(); reframe(); });
  setTimeout(reframe, 0); setTimeout(reframe, 1500);
  desks.forEach(d => {
    d.wins = d.wins.filter(id => W[id]).slice(0, MAXW);
    if (!d.wins.includes(d.focus)) d.focus = d.wins[d.wins.length - 1] || null;
    if (!d.wins.length) d.full = false;
  });
  if (desks[0].wins.length) { const d = blank({ wins: desks[0].wins, focus: desks[0].focus }); desks[0] = blank({ id: 'home', home: true }); desks.splice(1, 0, d); }
  desks = desks.filter((d, i) => i === 0 || d.wins.length);
  Object.keys(W).forEach(id => { if (!desks.some(d => d.wins.includes(id))) delete W[id]; });
  let idx = store.get('idx4', HOME); if (!(idx >= 0 && idx < desks.length)) idx = HOME;
  const save = () => { store.set('wins4', W); store.set('strip', desks); store.set('idx4', idx); };

  /* Live Wizard state: inbox, unread, working come from the real Wizard backend. */
  // Thread emojis are Wizard's own (same-origin storage), read fresh each render.
  let EMO = {}, emoAt = 0;
  const emoOf = id => { if (Date.now() - emoAt > 2000) { try { EMO = JSON.parse(localStorage.getItem('wizard.thread-emojis.v1') || '{}'); } catch (e) {} emoAt = Date.now(); } return EMO[`direct:${id}`] || '✦'; };
  const live = () => (LIVE && LIVE.ok ? LIVE.groups() : { needs: [], ready: [], working: [] });
  const ago = iso => {
    const t = Date.parse(iso || ''); if (!isFinite(t)) return '';
    const m = Math.round((Date.now() - t) / 6e4);
    if (m < 1) return 'now'; if (m < 60) return m + 'm'; if (m < 24 * 60) return Math.round(m / 60) + 'h';
    const d = window.WizConfig.dayParts(t); return `${DOW[d.dow]} ${d.d}`;
  };

  /* ---------------- window model ---------------- */
  const track = $('#track');
  /* ---------------- Chats ----------------
   * The Chats client (list, thread, composer, attachments, voice notes, unsent bubbles) is shared with
   * the desktop shell: web/core/chats.js. The phone hands it windows on desks. */
  const CHATS = window.WizCore.chats({
    win: id => W[id],
    root: () => track,
    save: () => save(),
    layout: id => applyLayout(deskOf(id)),
    toast: (...a) => toast(...a),
    title: w => winTitle(w),
    viewContext: (id, how) => viewContext(id, how),
    visible: () => desks[idx].wins,
    editUnsent: it => editUnsent(it),
    newChatHint: 'Type below, or tap the orb and talk.',
    // The composer's mic (#13): the orb's own recorder, pinned to this thread.
    recordReply: (wid, sid) => recordReply(wid, sid),
    recordingFor: () => (V.replyTo && (V.state === 'listen' || V.state === 'paused') ? V.replyTo.sid : ''),
    // The thread a recording take will go into (its composer rides along); Send in that composer finishes the take.
    voiceInto: () => (V.state === 'listen' || V.state === 'paused' ? sealTarget()?.sid || '' : ''),
    finishVoice: () => finishVoice(),
    // A private-origin link in a message opens in a window on this desk: the shell never navigates away.
    openLink: (url, title) => openLinkDesk(url, null),
    overlay: open => { if (open) { closeMenu(); armBack(); } },
    vib: ms => vib(ms),
    threadShown: (wid, el) => threadShown(wid, el),
  });
  const { CH, ch, renderChats, renderChatList, renderThread, loadThread, openChat, chatsBack, sendChat, refreshCompose, toggleVoice, markVisibleThreadsSeen, MIC_SVG } = CHATS;
  const CHATS_APP = { id: 'wizard', name: 'Chats', icon: '✦', g: ['#6b46ff', '#c04dff'] };
  // App icons are sigils (core/sigils.js): one silhouette, one bite, one colour per app.
  const ico = (tag, cls, a, extra) => window.WizSigil ? window.WizSigil.box(tag, cls, a, extra) : `<${tag} class="${cls}" style="--g1:${a.g?.[0]};--g2:${a.g?.[1]}">${a.icon || '◇'}${extra || ''}</${tag}>`;
  const sig = (cls, glyph, color, fb) => window.WizSigil ? window.WizSigil.chip('span', cls, glyph, color) : `<span class="${cls}">${fb}</span>`;
  let tileN = 0;
  function winApp(w) {
    if (w.app === 'chats') return CHATS_APP;
    if (w.app === 'review') return APP[w.z?.level === 'month' ? 'v-month' : w.z?.level === 'week' ? 'v-week' : 'v-day'] || { name: 'Review', icon: '◐', g: ['#444a60', '#22263a'] };
    if (w.app === 'maps') return APP.maps;
    if (w.app === 'usuals') return APP.usuals || { name: 'Food', icon: '🍜', g: ['#00b14f', '#0a5c32'] };
    return APP[w.appId] || { name: w.title || 'Page', icon: '◇', g: ['#444a60', '#22263a'], url: w.url };
  }
  function winTitle(w) {
    if (!w) return '';
    if (w.app === 'chats') return w.thread === '__new__' ? 'New chat' : w.thread ? (LIVE?.session(w.thread)?.title || OUTBOX?.forThread(w.thread)[0]?.title || 'Thread') : 'Chats';
    if (w.app === 'review') return { month: 'Month in review', week: 'Week in review', day: 'Day in review', group: 'Day in review', thread: 'Thread' }[w.z?.level] || 'Review';
    if (w.app === 'maps') return w.dest ? `Maps · ${w.dest}` : 'Maps';
    return winApp(w).name;
  }
  function deskTitle(i) {
    const d = desks[i]; if (!d.wins.length) return i === HOME ? 'Home' : 'Empty';
    const f = W[d.focus] || W[d.wins[0]];
    return d.wins.length > 1 ? `${winTitle(f)} +${d.wins.length - 1}` : winTitle(f);
  }
  // Short name for the bottom label and scrubber: the app ("Chats"), never a long thread title.
  function deskName(i) {
    const d = desks[i]; if (!d.wins.length) return i === HOME ? 'Home' : 'Empty';
    const f = W[d.focus] || W[d.wins[0]], n = f.app === 'frame' || f.app === 'maps' || f.app === 'chats' ? winApp(f).name : winTitle(f);
    return d.wins.length > 1 ? `${n} +${d.wins.length - 1}` : n;
  }
  const deskOf = id => desks.findIndex(d => d.wins.includes(id));
  const winEl = id => track.querySelector(`.win[data-win="${id}"]`);
  const focusedWin = () => W[desks[idx].focus] || null;

  function winBody(w) {
    switch (w.app) {
      case 'chats': return `<div class="chats" data-chats="${w.id}"></div>`;
      case 'review': return renderReviewShell(w.id);
      case 'frame': return renderFrame(w);
      case 'maps': return renderMaps(w);
      case 'usuals': return `<div class="usuals" data-usuals="${w.id}"></div>`;
      default: return renderApp(w);
    }
  }
  function makeWin(w) {
    const a = winApp(w);
    const el = document.createElement('article');
    const rv = !!(w.from && w.from.sid);
    el.className = `win app-${w.app}${w.appId === 'app-store' || w.appId === 'system' ? ' store-window' : ''}${rv ? ' reviewing' : ''}${w.bound ? ' bound' : ''}`; el.dataset.win = w.id;
    el.innerHTML = `<header class="wbar">${ico('span', 'wic', a)}<span class="wt">${esc(winTitle(w))}</span>${rv ? '<span class="rv-tag">Review</span>' : ''}
      ${w.from ? '<button class="wb wpin wopen" data-wact="detach" aria-label="Open as an app on its own desk" title="Keep a copy open on its own desk"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg><span>Open app</span></button>' : ''}
      <button class="wb" data-wact="full" aria-label="Full screen"><svg viewBox="0 0 24 24"><path class="i-grow" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path class="i-shrink" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg></button>
      <button class="wb" data-wact="close" aria-label="Close window"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg></button></header>
      <div class="wbody">${winBody(w)}</div><div class="shield" aria-hidden="true"></div>`;
    return el;
  }
  function mountWin(w, el) {
    if (w.app === 'review') mountReview(w.id, null);
    if (w.app === 'chats') renderChats(w);
    if (w.app === 'usuals') window.WosUsuals?.mount(el.querySelector('[data-usuals]'));
    watchFrames(el);
  }
  // Desk sections are keyed by desk id and laid out with CSS order, so reordering, merging or closing desks
  // never re-parents a section (which would reload every app in it).
  function secOf(i) { const d = desks[i]; return d ? track.querySelector(`.desk[data-did="${d.id}"]`) : null; }
  function isReviewDesk(i) { const d = desks[i]; return !!(d && d.wins.some(id => W[id]?.from?.sid)); }
  function deskShell(i) {
    const d = desks[i];
    return `<section class="desk${d.home ? ' home-desk' : ''}" data-did="${d.id}" data-desk="${i}" style="order:${i}" aria-label="${esc(deskTitle(i))}"><div class="glance">${d.home ? renderHome() : renderEmpty(i)}</div><div class="tiles" data-n="0"></div></section>`;
  }
  function syncDesks() {
    const ids = new Set(desks.map(d => d.id));
    $$('.desk', track).forEach(sec => { if (!ids.has(sec.dataset.did)) sec.remove(); });
    desks.forEach((d, i) => {
      let sec = secOf(i);
      if (!sec) { track.insertAdjacentHTML('beforeend', deskShell(i)); sec = secOf(i); renderDesk(i); }
      sec.style.order = String(i); sec.dataset.desk = String(i);
      sec.classList.toggle('review-desk', isReviewDesk(i));
    });
    placeTrack(0, false); renderDots(); parkDesks(false);
  }
  function buildDesks() {
    track.innerHTML = desks.map((_, i) => deskShell(i)).join('');
    desks.forEach((_, i) => renderDesk(i));
    placeTrack(0, false); renderDots(); renderMoons(); parkDesks(true);
  }
  /* Sync one desk's DOM with its window list without reloading live windows. */
  function renderDesk(i) {
    const sec = secOf(i); if (!sec) return;
    const d = desks[i], tiles = $('.tiles', sec);
    $$('.win', tiles).forEach(el => { if (!d.wins.includes(el.dataset.win)) el.remove(); });
    d.wins.forEach(id => {
      let el = winEl(id);
      if (!el) { el = makeWin(W[id]); tiles.appendChild(el); mountWin(W[id], el); }
      else if (el.parentElement !== tiles) tiles.appendChild(el);
    });
    if (!d.wins.length) $('.glance', sec).innerHTML = d.home ? renderHome() : renderEmpty(i);
    sec.classList.toggle('review-desk', isReviewDesk(i));
    applyLayout(i);
  }
  function applyLayout(i) {
    const d = desks[i], sec = secOf(i); if (!sec) return;
    const tiles = $('.tiles', sec), n = Math.min(d.wins.length, MAXW);
    tiles.dataset.n = String(n);
    tiles.classList.toggle('has-full', !!(d.full && d.focus));
    sec.classList.toggle('has-wins', n > 0);
    d.wins.forEach((id, k) => {
      const el = winEl(id); if (!el) return;
      el.style.gridArea = 'abcd'[k];
      el.classList.toggle('focus', id === d.focus && n > 1);
      el.classList.toggle('solo', n === 1);
      el.classList.toggle('full', !!d.full && id === d.focus);
      const t = $('.wt', el); if (t) t.textContent = winTitle(W[id]); // Chats shows the thread's name (or New chat / Chats)
    });
    sec.setAttribute('aria-label', deskTitle(i));
    if (i === idx) { syncImmersive(); syncReviewChip(); }
  }
  function refreshWin(id) {
    const w = W[id], el = winEl(id); if (!w || !el) return;
    if (w.app === 'chats') renderChats(w);
    else if (w.app === 'review') mountReview(id, null);
    else if (w.app !== 'frame') $('.wbody', el).innerHTML = winBody(w);
    applyLayout(deskOf(id));
  }
  function placeTrack(dx, anim) {
    track.classList.toggle('anim', !!anim);
    track.style.transform = `translate3d(calc(${-idx * 100}% + ${dx}px),0,0)`;
    $('.nebula').style.transform = `translate3d(${(-idx + 2) * -3 + dx * .01}%,0,0)`;
    window.WosScenery?.still('stars'); // scenery hook: star parallax follows the desk (one still frame; core/scenery.js)
  }
  let labelT = 0;
  /* Parking: hosted apps on desks out of view stay loaded but go quiet, so swipes stay smooth.
   *  - Every framed app off the current desk sees document.visibilityState === 'hidden' (and a
   *    visibilitychange), exactly as if the phone screen were off: Legacy Wizard, Topics, Meetings and
   *    friends stop their polling and catch up the moment their desk lands in view.
   *  - Desks more than one swipe away also skip rendering (content-visibility), so a heavy app two
   *    desks over costs no style, layout or paint. The neighbours stay painted for the swipe itself.
   * A desk is woken only after the slide settles, so its catch-up work never lands mid-animation. */
  let parkT = 0;
  function frameSetHidden(f, hidden) {
    try {
      const d = f.contentDocument; if (!d || d.location.href === 'about:blank') return;
      if (!d.__wosVis) {
        d.__wosVis = { hidden: false };
        Object.defineProperty(d, 'hidden', { configurable: true, get: () => d.__wosVis.hidden || document.hidden });
        Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => (d.__wosVis.hidden || document.hidden) ? 'hidden' : 'visible' });
      }
      if (d.__wosVis.hidden === hidden) return;
      d.__wosVis.hidden = hidden;
      if (!document.hidden) d.dispatchEvent(new Event('visibilitychange'));
    } catch (e) {}
  }
  function parkDesks(wakeCurrent) {
    desks.forEach((_, i) => {
      const sec = secOf(i); if (!sec) return;
      sec.classList.toggle('parked', Math.abs(i - idx) > 1);
      if (i !== idx || wakeCurrent) $$('iframe.appframe', sec).forEach(f => frameSetHidden(f, i !== idx));
    });
  }
  function scheduleParking() {
    parkDesks(false); clearTimeout(parkT);
    // The slide is 520 ms; a desk you only pass through never wakes, and a wake never lands mid-swipe
    // (a waking app catches up at once, which is exactly the hitch this avoids).
    const wake = () => { let busy = false; try { busy = !!(G || DS); } catch (e) {} if (busy) parkT = setTimeout(wake, 250); else parkDesks(true); };
    parkT = setTimeout(wake, 900);
  }
  function swipeDesk(step) {
    // The ＋ is the next destination after the last occupied desk, for swipes as well as taps.
    if (step > 0 && idx === desks.length - 1) return newDesk();
    goDesk(idx + step);
  }
  function atPickerEnd() { const d = desks[idx]; return idx === desks.length - 1 && !d.home && !d.wins.length; }
  function goDesk(n, silent) {
    n = Math.max(0, Math.min(desks.length - 1, n));
    // An empty desk (one the ＋ made, left without picking an app) goes away as soon as you leave it.
    const from = desks[idx], to = desks[n];
    if (from && to && from !== to && !from.home && !from.wins.length) { desks = desks.filter(d => d !== from); syncDesks(); n = desks.indexOf(to); }
    const moved = from !== to; idx = n;
    if (moved) window.WosResources?.back();
    // A Home card's chip is a quick look: leaving the Chats desk puts it back to all chats. Chips James picks stay.
    if (moved) for (const id in W) { const c = CHATS.CH[id]; if (W[id].app === 'chats' && c?.fromCard && !desks[n].wins.includes(id)) { c.fromCard = false; c.coach = false; CHATS.setFilter(W[id], ''); } }
    placeTrack(0, true); renderDots(); save(); scheduleParking(); syncImmersive(); syncReviewChip(); syncBound();
    window.WosScenery?.[idx === HOME ? 'poke' : 'update'](); // scenery hook: Home animates, any other desk freezes it
    if (moved && LINKS && LINKS.isOpen()) LINKS.close(); // a link is a peek over this desk: moving desks dismisses it
    if (moved) vib(8);
    if (!silent) announce(`<b>${esc(deskName(idx))}</b>`);
    markVisibleThreadsSeen();
    window.WosResources?.sync();
  }
  function announce(html) {
    const L = $('#deskLabel'); L.innerHTML = html; L.classList.add('show'); document.body.classList.add('labeling');
    clearTimeout(labelT); labelT = setTimeout(() => { L.classList.remove('show'); document.body.classList.remove('labeling'); }, 1300);
  }
  // Any number of desks: up to three each side (Home always shows at the far left), a faint tick for more.
  // Desk sigils (James, 12 Oct 2026): each neighbour shows the glyph of the app it holds, bare (no tile), in
  // that app's colour; Home is a house; an empty desk is a faint ring; a desk with several windows carries a
  // small count. The current desk is the orb. Each is a thumb-sized button, so one tap jumps there.
  function deskSigil(i) {
    const d = desks[i], S = window.WizSigil;
    if (!S) return '';
    if (d.home) return `<span class="dsg" style="--c:#C9BEFF">${S.named('home')}</span>`;
    const f = W[d.focus] || W[d.wins[0]]; if (!f) return '<span class="dsg empty"></span>';
    const a = winApp(f), s = S.of(a.sigil || a), c = a.sgc || s.color, g = a.sgh || S.html(a.sigil || a);
    return `<span class="dsg" style="--c:${c}">${g}${d.wins.length > 1 ? `<b class="dn">${d.wins.length}</b>` : ''}</span>`;
  }
  function renderDots() {
    const mk = i => `<button class="ddot sig${desks[i].wins.length ? ' filled' : ''}${desks[i].home ? ' dhome' : ''}${isReviewDesk(i) ? ' review' : ''}" data-goto="${i}" aria-label="${esc(deskName(i))}">${deskSigil(i)}</button>`;
    const L = []; for (let i = Math.max(0, idx - 3); i < idx; i++) L.push(i);
    const R = []; for (let i = idx + 1; i <= Math.min(desks.length - 1, idx + 3); i++) R.push(i);
    const homeExtra = L.length && L[0] > 0;
    $('#dotsL').innerHTML = (homeExtra ? mk(0) + (L[0] > 1 ? '<i class="dmore"></i>' : '') : '') + L.map(mk).join('');
    $('#dotsR').innerHTML = R.map(mk).join('') + (R.length && R[R.length - 1] < desks.length - 1 ? '<i class="dmore"></i>' : '')
      + (atPickerEnd() ? '' : '<button class="ddot sig dplus" data-plus aria-label="New desk: pick an app"><span class="dsg"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span></button>');
  }
  /* Dots: tap = jump to that desk. Long-press any dot = peek every desk as a
   * stack of cards (Android recents feel); tap a card to land there. */
  let dotHold = null, peekEl = null, peekJustOpened = 0;
  $('#dock').addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-goto]'); if (!b) return;
    dotHold = setTimeout(() => { dotHold = null; peekJustOpened = Date.now(); openOverview(); ovTapBlock = Date.now() + 500; /* the click that ends the long-press must not land on the overview */ }, 420);
  });
  const endDotHold = () => { clearTimeout(dotHold); dotHold = null; };
  $('#dock').addEventListener('pointerup', endDotHold); $('#dock').addEventListener('pointercancel', endDotHold); $('#dock').addEventListener('pointerleave', endDotHold);
  $('#dock').addEventListener('click', e => {
    if (e.target.closest('[data-plus]')) { if (Date.now() - dockSwiped < 400) return; newDesk(); tourEv('desk-plus', {}); return; }
    const b = e.target.closest('[data-goto]'); if (!b) return;
    if (Date.now() - peekJustOpened < 600 || Date.now() - dockSwiped < 400) return;
    goDesk(+b.dataset.goto); tourEv('desk', { home: idx === HOME });
  });
  $('#dock').addEventListener('contextmenu', e => { if (e.target.closest('[data-goto]')) e.preventDefault(); });
  /* Swipe anywhere on the bottom bar to change desks: the orb has its own gestures, the
   * scrubber its own; everything else in the bar (dots, gaps, edges) is a desk swipe. */
  let DS = null, dockSwiped = 0;
  $('#dock').addEventListener('pointerdown', e => {
    if (e.target.closest('#orbWrap, #scrub') || sheet) return;
    DS = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, h: false };
  });
  $('#dock').addEventListener('pointermove', e => {
    if (!DS || e.pointerId !== DS.id) return;
    const dx = e.clientX - DS.x, dy = e.clientY - DS.y;
    if (!DS.h) { if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy)) return; DS.h = true; endDotHold(); try { $('#dock').setPointerCapture(e.pointerId); } catch (_) {} }
    let d = dx; if ((idx === 0 && d > 0) || (atPickerEnd() && d < 0)) d *= .28;
    placeTrack(d * 1.1, false);
  });
  const dockEnd = e => {
    if (!DS || e.pointerId !== DS.id) return; const s = DS; DS = null;
    if (!s.h) return;
    const dx = e.clientX - s.x, v = dx / ((performance.now() - s.t) || 1);
    dockSwiped = Date.now();
    if (e.type !== 'pointercancel' && (dx < -60 || v < -.5)) { swipeDesk(1); tourEv('desk', { home: idx === HOME }); }
    else if (e.type !== 'pointercancel' && (dx > 60 || v > .5)) { swipeDesk(-1); tourEv('desk', { home: idx === HOME }); }
    else placeTrack(0, true);
  };
  $('#dock').addEventListener('pointerup', dockEnd); $('#dock').addEventListener('pointercancel', dockEnd);
  /* Overview (James, 10 Oct 2026): pinch in on a desk, or long-press the desk dots, to see every desk at once.
   * Tap a desk to go there · ✕ closes it · hold and drag to reorder (Home stays first) · pinch two desks
   * together to merge them into one desk · spread a desk that holds several windows to split them apart. */
  let ovEl = null, OV = null, ovTapBlock = 0;
  // Overview: the same app sigil and colour as the dock, large enough to recognize before reading.
  function ovMark(a) {
    const S = window.WizSigil, s = S.of(a.sigil || a);
    return { color: a.sgc || s.color, glyph: a.sgh || S.html(a.sigil || a) };
  }
  function ovCard(i) {
    const d = desks[i], wins = d.wins.map(id => W[id]).filter(Boolean), rv = isReviewDesk(i), here = i === idx;
    const lead = W[d.focus] || wins[0], primary = lead ? ovMark(winApp(lead)) : { color: '#C9BEFF' };
    const second = wins.find(w => w !== lead), c2 = second ? ovMark(winApp(second)).color : primary.color;
    const name = d.home ? 'Home' : !wins.length ? 'New desk' : deskName(i);
    let body;
    if (d.home) body = `<span class="ov-symbol" style="--c:${primary.color}">${window.WizSigil.named('home')}</span>`;
    else if (!wins.length) body = '<span class="ov-empty-symbol" aria-hidden="true">＋</span>';
    else body = wins.map(w => {
      const a = winApp(w), m = ovMark(a), same = wins.filter(x => winApp(x).id === a.id).length > 1;
      const label = same ? winTitle(w) : a.name;
      return `<span class="ov-win${w.from?.sid ? ' rv' : ''}"><span class="ov-symbol" style="--c:${m.color}">${m.glyph}</span>${wins.length > 1 ? `<em>${esc(label)}</em>` : ''}</span>`;
    }).join('');
    const cap = wins.length === 1 && winTitle(wins[0]) !== winApp(wins[0]).name ? winTitle(wins[0]) : '';
    const accessible = wins.length > 1 ? `${wins.length} windows: ${wins.map(w => winTitle(w)).join(', ')}` : name;
    return `<div class="ov-card${here ? ' here' : ''}${d.home ? ' ov-home' : ''}${rv ? ' review' : ''}" data-ov="${d.id}" role="button" tabindex="0"${here ? ' aria-current="true"' : ''} style="--ov-c:${primary.color};--ov-c2:${c2}" aria-label="${esc(accessible)}${here ? ', current desk' : ''}${rv ? ', review' : ''}">
      <div class="ov-chrome"><span class="ov-state">${here ? '<span class="ov-here">Here</span>' : ''}${rv ? '<span class="ov-review">Review</span>' : ''}</span>${d.home ? '' : `<button class="ov-x" data-ovx="${d.id}" aria-label="Close ${esc(name)}">✕</button>`}</div>
      <div class="ov-body ov-n${Math.min(wins.length, 4)}">${body}</div>
      <div class="ov-top"><b>${esc(wins.length > 1 ? `${wins.length} windows` : name)}</b>${cap ? `<small>${esc(cap)}</small>` : ''}</div></div>`;
  }
  function renderOverview() {
    const open = desks.filter(d => !d.home && d.wins.length).length;
    ovEl.innerHTML = `<div class="ov-head"><b>Desks</b><span>${open} open</span><button class="ov-done" data-ovdone>Done</button></div>
      <div class="ov-grid">${desks.map((_, i) => ovCard(i)).join('')}<button class="ov-card ov-add" data-ovadd aria-label="New desk: pick an app"><span aria-hidden="true">＋</span><b>New desk</b></button></div>
      <p class="ov-hint">Hold and drag to reorder · pinch two desks together to merge · spread one apart to split</p>`;
  }
  function openOverview() {
    if (!ovEl) { ovEl = document.createElement('div'); ovEl.id = 'overview'; ovEl.className = 'ov'; device.appendChild(ovEl); bindOverview(ovEl); }
    closeSheets(true); if (LINKS && LINKS.isOpen()) LINKS.close();
    renderOverview(); void ovEl.offsetWidth; ovEl.classList.add('open'); device.classList.add('ov-open');
    ovEl.querySelector('.ov-card.here')?.scrollIntoView({ block: 'center' });
    armBack(); vib(14); window.__ovLog = (window.__ovLog || []).concat('open').slice(-30);
  }
  function closeOverview() { if (!ovEl || !ovEl.classList.contains('open')) return false; ovEl.classList.remove('open'); device.classList.remove('ov-open'); return true; }
  const openPeek = () => openOverview(), closePeek = () => closeOverview();
  const posOf = did => desks.findIndex(d => d.id === did);
  function ovLog(s) { window.__ovLog = (window.__ovLog || []).concat(s).slice(-30); }
  function bindOverview(el) {
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('keydown', e => {
      const c = e.target.closest('[data-ov]');
      if (c && e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); c.click(); }
    });
    el.addEventListener('click', e => {
      if (Date.now() < ovTapBlock) return;
      if (e.target.closest('[data-ovdone]')) return closeOverview();
      const x = e.target.closest('[data-ovx]'); if (x) { closeDesk(posOf(x.dataset.ovx)); if (desks.length) renderOverview(); return; }
      if (e.target.closest('[data-ovadd]')) { closeOverview(); return newDesk(); }
      const c = e.target.closest('[data-ov]'); if (c) { const i = posOf(c.dataset.ov); closeOverview(); if (i >= 0) goDesk(i); return; }
      if (e.target === el || e.target.classList.contains('ov-grid')) closeOverview();
    });
    const cardAt = (x, y) => { const t = document.elementFromPoint(x, y); return t && t.closest ? t.closest('.ov-card[data-ov]') : null; };
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    el.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        clearTimeout(OV?.hold); if (OV?.drag) endDrag(false);
        const [p, q] = e.touches, a = cardAt(p.clientX, p.clientY), b = cardAt(q.clientX, q.clientY);
        OV = { pinch: true, a, b, d0: dist(p, q), s: 1 }; return;
      }
      if (e.touches.length !== 1) return;
      const t = e.touches[0], c = cardAt(t.clientX, t.clientY);
      OV = { x: t.clientX, y: t.clientY, c, moved: false, drag: false };
      if (c && !c.classList.contains('ov-home') && !e.target.closest('.ov-x')) OV.hold = setTimeout(() => { if (OV && !OV.moved && !OV.pinch) startDrag(c, t.clientX, t.clientY); }, 380);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (!OV) return;
      if (OV.pinch && e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        OV.s = dist(e.touches[0], e.touches[1]) / OV.d0;
        const same = OV.a && OV.a === OV.b;
        el.querySelectorAll('.ov-card.merging, .ov-card.splitting').forEach(c => c.classList.remove('merging', 'splitting'));
        if (!same && OV.a && OV.b && OV.s < .85) { OV.a.classList.add('merging'); OV.b.classList.add('merging'); }
        if (same && OV.s > 1.15) OV.a.classList.add('splitting');
        return;
      }
      const t = e.touches[0]; if (!t) return;
      if (!OV.drag) { if (Math.hypot(t.clientX - OV.x, t.clientY - OV.y) > 9) { OV.moved = true; clearTimeout(OV.hold); } return; }
      if (e.cancelable) e.preventDefault();
      moveDrag(t.clientX, t.clientY);
    }, { passive: false });
    const end = e => {
      if (!OV) return;
      if (OV.pinch) {
        if (e.touches && e.touches.length) return; // wait for both fingers
        const q = OV; OV = null; ovTapBlock = Date.now() + 400;
        el.querySelectorAll('.ov-card.merging, .ov-card.splitting').forEach(c => c.classList.remove('merging', 'splitting'));
        if (q.a && q.b && q.a !== q.b && q.s < .72) { mergeDesks(q.a.dataset.ov, q.b.dataset.ov); renderOverview(); }
        else if (q.a && q.a === q.b && q.s > 1.3) { splitDesk(q.a.dataset.ov); renderOverview(); }
        return;
      }
      clearTimeout(OV.hold);
      if (OV.drag) { endDrag(true); ovTapBlock = Date.now() + 400; }
      OV = null;
    };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
    function startDrag(c, x, y) {
      OV.drag = true; OV.card = c; const r = c.getBoundingClientRect(); OV.ox = x - r.left; OV.oy = y - r.top;
      c.classList.add('drag'); el.classList.add('dragging'); vib(16); ovLog('drag');
      OV.ghost = c.cloneNode(true); OV.ghost.classList.add('ghost'); OV.ghost.style.width = r.width + 'px'; OV.ghost.style.height = r.height + 'px'; el.appendChild(OV.ghost);
      moveDrag(x, y);
    }
    function moveDrag(x, y) {
      const dr = el.getBoundingClientRect();
      OV.ghost.style.transform = `translate(${x - OV.ox - dr.left}px, ${y - OV.oy - dr.top}px) scale(1.04)`;
      OV.ghost.style.visibility = 'hidden'; const over = cardAt(x, y); OV.ghost.style.visibility = '';
      if (over && over !== OV.card && !over.classList.contains('ov-home')) {
        const grid = el.querySelector('.ov-grid'), cards = [...grid.querySelectorAll('.ov-card[data-ov]')];
        const a = cards.indexOf(OV.card), b = cards.indexOf(over);
        grid.insertBefore(OV.card, a < b ? over.nextSibling : over); vib(6);
      }
      // Near the top or bottom edge: scroll so far desks can be reached while dragging.
      if (y < dr.top + 70) el.scrollTop -= 12; else if (y > dr.bottom - 70) el.scrollTop += 12;
    }
    function endDrag(commit) {
      const c = OV.card; c.classList.remove('drag'); el.classList.remove('dragging'); OV.ghost?.remove();
      if (commit) reorderDesks([...el.querySelectorAll('.ov-grid .ov-card[data-ov]')].map(x => x.dataset.ov));
      renderOverview();
    }
  }
  function reorderDesks(order) {
    const cur = desks[idx]?.id, by = Object.fromEntries(desks.map(d => [d.id, d]));
    const next = [desks[0], ...order.filter(id => id !== desks[0].id && by[id]).map(id => by[id])];
    desks.forEach(d => { if (!next.includes(d)) next.push(d); });
    desks = next; idx = Math.max(0, posOf(cur)); syncDesks(); save(); ovLog('reorder');
  }
  // Drop desks that lost their last window and keep the same desk in front (or the one asked for).
  function pruneDesks(prefer) {
    const cur = desks[idx]?.id, at = idx;
    desks = desks.filter((d, i) => i === 0 || d.wins.length);
    let n = posOf(prefer || cur); if (n < 0) n = posOf(cur);
    if (n < 0) n = Math.max(0, Math.min(at - 1, desks.length - 1));
    idx = Math.min(idx, desks.length - 1); syncDesks(); goDesk(n, true); save();
  }
  function mergeDesks(aId, bId) {
    let a = posOf(aId), b = posOf(bId); if (a < 0 || b < 0 || a === b) return false;
    if (a > b) [a, b] = [b, a];
    if (desks[a].home || desks[b].home) { toast('⌂', 'Home stays on its own'); return false; }
    if (desks[a].wins.length + desks[b].wins.length > MAXW) { toast('▦', 'A desk holds up to four windows'); return false; }
    const keep = desks[a].id, cur = desks[idx].id === desks[b].id ? keep : desks[idx].id;
    desks[a].wins.push(...desks[b].wins); desks[a].full = false; desks[b].wins = [];
    renderDesk(a); pruneDesks(cur); vib([8, 30, 8]); ovLog('merge'); return true;
  }
  function splitDesk(did) {
    const i = posOf(did); if (i < 1) return false; const d = desks[i]; if (d.wins.length < 2) return false;
    const rest = d.wins.filter(id => id !== d.focus), first = d.focus && d.wins.includes(d.focus) ? d.focus : d.wins[0];
    d.wins = [first]; d.focus = first; d.full = false;
    rest.filter(id => id !== first).forEach((id, k) => desks.splice(i + 1 + k, 0, blank({ wins: [id], focus: id })));
    if (idx > i) idx += rest.length;
    renderDesk(i); syncDesks(); save(); vib([8, 30, 8]); ovLog('split'); return true;
  }
  function closeDesk(i) {
    const d = desks[i]; if (!d || d.home) return false;
    const name = deskName(i);
    [...d.wins].forEach(id => { delete W[id]; delete CH[id]; }); d.wins = [];
    renderDesk(i); pruneDesks(); toast('✕', `Closed ${esc(name)}`); ovLog('close'); return true;
  }

  /* Scrubber: the strip just below the orb. Touch, hold, and drag sideways;
   * every small nudge steps one desk (haptic tick), release lands. */
  const scrub = document.createElement('div'); scrub.id = 'scrub'; scrub.className = 'scrub';
  scrub.innerHTML = '<i></i><span class="sc-label"></span>'; $('#dock').appendChild(scrub);
  let SC = null; const SC_STEP = 26;
  scrub.addEventListener('pointerdown', e => {
    e.preventDefault(); scrub.setPointerCapture(e.pointerId);
    SC = { x: e.clientX, start: idx, at: idx, live: false, t: setTimeout(() => { if (SC) { SC.live = true; scrub.classList.add('on'); scLabel(); vib(10); } }, 140) };
  });
  scrub.addEventListener('pointermove', e => {
    if (!SC) return; const dx = e.clientX - SC.x;
    if (!SC.live && Math.abs(dx) > 10) { clearTimeout(SC.t); SC.live = true; scrub.classList.add('on'); }
    if (!SC.live) return;
    const n = Math.max(0, Math.min(desks.length - 1, SC.start + Math.round(dx / SC_STEP)));
    if (n !== SC.at) { SC.at = n; vib(6); idx = n; placeTrack(0, true); renderDots(); scLabel(); }
  });
  function scLabel() { scrub.querySelector('.sc-label').textContent = deskName(SC.at); }
  const scEnd = () => { if (!SC) return; clearTimeout(SC.t); const live = SC.live; const at = SC.at; SC = null; scrub.classList.remove('on'); if (live) goDesk(at, true); };
  scrub.addEventListener('pointerup', scEnd); scrub.addEventListener('pointercancel', scEnd);

  /* ---------------- window operations ---------------- */
  /* Every new thing opens on its own desk, right beside the one in front (James, 12 Oct 2026: apps always open
   * in a new tab, as one shell rule, never a per-app setting). Only an explicit user placement (opts.desk from a
   * user aim, opts.here) may share an existing desk; app openers pass opts through and never pick a desk. */
  // Directly beside the desk in front, Home included (James, 11 Oct 2026: from Home, Yesterday and every other
  // app open on the desk right next to Home; Chats just moves one to the right).
  function insertPos() { return idx + 1; }
  function openWin(obj, opts = {}) {
    const w = { id: newId(), ...obj }; W[w.id] = w;
    let t = opts.desk != null ? Math.max(0, Math.min(desks.length - 1, opts.desk)) : opts.here ? idx : -1;
    if (t >= 0 && (desks[t].home || desks[t].wins.length >= MAXW)) t = -1;
    if (t < 0 && !desks[idx].home && !desks[idx].wins.length) t = idx; // the empty desk in front takes it
    if (t < 0) { t = insertPos(); desks.splice(t, 0, blank({ wins: [w.id], focus: w.id })); syncDesks(); }
    else { const d = desks[t]; d.wins.push(w.id); d.focus = w.id; d.full = false; }
    renderDesk(t); save(); renderDots();
    if (opts.stay) return w; // opened beside, out of view (a bound view): the desk in front stays in front
    if (t !== idx) goDesk(t, true);
    announce(`Opened <b>${esc(winApp(w).name)}</b>`);
    return w;
  }
  function closeWin(id, quiet) {
    const i = deskOf(id); if (i < 0) return;
    const w = W[id], d = desks[i], name = winTitle(w);
    if (quiet) { d.wins = d.wins.filter(x => x !== id); delete W[id]; delete CH[id]; if (d.focus === id) d.focus = d.wins[d.wins.length - 1] || null; if (!d.wins.length) d.full = false; renderDesk(i); pruneDesks(); return; }
    // ✕ on a bound view: it stays closed for this reply (opening the thread again, or a new reply, binds again).
    if (w.bound) boundOff[w.bound] = w.bsid + '|' + w.bkey;
    const back = w.from && i === idx && desks.some(x => x.id === w.from.desk) ? w.from : null;
    d.wins = d.wins.filter(x => x !== id); delete W[id]; delete CH[id];
    if (d.focus === id) d.focus = d.wins[d.wins.length - 1] || null;
    if (!d.wins.length) d.full = false;
    renderDesk(i); pruneDesks(back && !d.wins.length ? back.desk : null); vib(8);
    if (back && W[back.win] && deskOf(back.win) === idx) focusWin(back.win);
    if (back) announce(`Back to <b>${esc(clip(back.title || deskName(idx), 40))}</b>`); else toast('✕', `Closed ${esc(name)}`);
  }
  // Move a window onto another desk (to = a desk index), or onto a desk of its own (to = 'own').
  function moveWin(id, to) {
    const from = deskOf(id); if (from < 0) return false;
    if (to === 'own') {
      if (desks[from].wins.length < 2) return false;
      const f = desks[from]; f.wins = f.wins.filter(x => x !== id); if (f.focus === id) f.focus = f.wins[f.wins.length - 1] || null; f.full = false;
      desks.splice(from + 1, 0, blank({ wins: [id], focus: id })); renderDesk(from); syncDesks(); renderDesk(from + 1); save(); goDesk(from + 1, true);
      announce(`<b>${esc(winApp(W[id]).name)}</b> has its own desk`); return true;
    }
    if (to < 1 || to >= desks.length || to === from) return false;
    if (desks[to].wins.length >= MAXW) { toast('▦', `${esc(deskName(to))} is full`); return false; }
    const f = desks[from]; f.wins = f.wins.filter(x => x !== id); if (f.focus === id) { f.focus = f.wins[f.wins.length - 1] || null; f.full = false; } if (!f.wins.length) f.full = false;
    const d = desks[to]; d.wins.push(id); d.focus = id; d.full = false;
    renderDesk(from); renderDesk(to); const dest = d.id; pruneDesks(dest);
    announce(`Moved to <b>${esc(deskName(idx))}</b>`);
    return true;
  }
  function focusWin(id) {
    const i = deskOf(id); if (i < 0 || desks[i].focus === id) return;
    desks[i].focus = id; applyLayout(i); save();
  }
  let fullAt = 0;
  /* Immersive full screen (James, 9 Oct): a full-screen window owns the whole display. Its title bar,
   * the bottom bar with the orb, the desk label and the phone's status bar all go away. Ways out:
   * pinch in, swipe up from the bottom edge, or Back. Chats keeps a small orb in the bottom-right
   * corner so a voice reply is always one tap away; there the orb only talks (no shell swipes). */
  var immOn = null, immTipT = 0; // var: applyLayout can run before this line during boot
  /* Edge to edge (James, 10 Oct): in immersive full screen the window reaches the very top of the glass, under
   * the camera too. The native shell reports the camera cutout height; shell-drawn windows pad their content by
   * it, and hosted apps get it as --wos-cutout on their <html> so their own top controls can clear the camera. */
  var cutTop = 0; try { cutTop = +window.WizardOSNative?.cutoutTop?.() || 0; } catch (e) {}
  function shareCutout() {
    const v = device.classList.contains("immersive") ? (cutTop || 0) : 0;
    device.style.setProperty('--cut-t', v + 'px');
    $$('iframe.appframe').forEach(f => { try { const d = f.contentDocument; if (d && d.documentElement) d.documentElement.style.setProperty('--wos-cutout', (f.closest('.win.full') ? v : 0) + 'px'); } catch (e) {} });
  }
  window.__wosCutout = px => { cutTop = Math.max(0, px | 0); shareCutout(); };
  /* Status bar (James, 10 Oct: "like Telegram"): the native shell draws this page under the status bar so the
   * background reaches the top of the glass, and reports the bar's height; --safe-t keeps content below it. */
  function setNatTop(px) { document.documentElement.style.setProperty('--nat-t', Math.max(0, px | 0) + 'px'); }
  try { setNatTop(+window.WizardOSNative?.insetTop?.() || 0); } catch (e) {}
  window.__wosTop = setNatTop;
  /* A hosted app either clears the camera itself (its CSS reads --wos-cutout) or the shell moves it below the camera
   * and paints the strip above in the app's own background colour. */
  function frameEdge(f) {
    const we = f.closest('.win'); if (!we) return;
    let own = false, bg = '';
    try {
      const d = f.contentDocument;
      own = !!d.querySelector('meta[name="wizard-os-edge"][content="cover"]');
      if (!own) for (const sh of d.styleSheets) { let t = ''; try { t = Array.from(sh.cssRules, r => r.cssText).join(''); } catch (e) {} if (t.includes('--wos-cutout')) { own = true; break; } }
      const pick = el => { const c = el && d.defaultView.getComputedStyle(el).backgroundColor; return c && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(c) ? c : ''; };
      bg = pick(d.body) || pick(d.documentElement);
    } catch (e) {}
    we.classList.toggle('edge-own', own);
    if (bg) we.style.setProperty('--frame-bg', bg); else we.style.removeProperty('--frame-bg');
  }
  function syncImmersive() {
    const d = desks[idx], w = d && d.full && d.focus ? W[d.focus] : null, on = !!w;
    const corner = on && w.app === 'chats';
    device.classList.toggle('immersive', on);
    device.classList.toggle('orb-corner', corner);
    window.WosScenery?.update(); // scenery hook: full screen freezes the background
    trackCornerLift(corner);
    shareCutout();
    if (on === immOn) return; immOn = on;
    try { window.WizardOSNative?.immersive?.(on); } catch (e) {}
    clearTimeout(immTipT); device.classList.remove('imm-tip');
    if (on) {
      void device.offsetWidth; device.classList.add('imm-tip');
      immTipT = setTimeout(() => device.classList.remove('imm-tip'), 2600);
      const n = store.get('immTips', 0);
      if (n < 3) { store.set('immTips', n + 1); toast('⤡', 'Pinch in or swipe up from the bottom to exit full screen'); }
    }
  }
  /* Full-screen Chats (James, 10 Oct): the orb sits in the right-hand column above the composer, high enough that
   * Done (end of a reply) and ↓ Latest (scrolled up) sit directly below it. It follows the composer's real height
   * (attachments, multi-line text, keyboard). On the thread list there is no composer: it stays in the corner. */
  let liftRO = null, liftMO = null, liftEl = null;
  function paintCornerLift() {
    const c = device.querySelector('.win.full .ch-thread .ch-compose');
    if (c !== liftEl) { try { liftRO?.disconnect(); } catch (e) {} liftEl = c; if (c && liftRO) liftRO.observe(c); }
    const h = c && c.offsetParent ? Math.round(c.getBoundingClientRect().height) : 0;
    device.style.setProperty('--comp-h', h + 'px');
    device.classList.toggle('orb-lift', h > 0);
  }
  function trackCornerLift(on) {
    if (!on) { try { liftRO?.disconnect(); liftMO?.disconnect(); } catch (e) {} liftRO = liftMO = liftEl = null; device.classList.remove('orb-lift'); device.style.removeProperty('--comp-h'); return; }
    if (!liftRO && window.ResizeObserver) { liftRO = new ResizeObserver(paintCornerLift); liftMO = new MutationObserver(paintCornerLift); liftMO.observe(track, { childList: true, subtree: true }); }
    paintCornerLift();
  }
  function setFull(id, on) {
    const i = deskOf(id); if (i < 0) return;
    const d = desks[i]; d.focus = id; d.full = !!on; fullAt = performance.now(); applyLayout(i); save(); vib(on ? 10 : 6);
  }
  function clearDesk(i) { closeDesk(i); }
  /* Apps open as windows. Views reuse a review window already on this desk. */
  function mountLinks() {
    if (LINKS || !window.WizLinks) return;
    LINKS = window.WizLinks.mount({
      parent: device, mode: 'sheet',
      onKeep: (url, title) => { const a = APPS.find(x => x.url && x.url.replace(/[#?].*$/, '') === url.replace(/[#?].*$/, '')); if (a) openApp(a); else openWin({ app: 'frame', url, title }); },
      onChange: on => { device.classList.toggle('link-open', on); if (on) { closeSheets(true); armBack(); } },
    });
    // Phone (James, 10 Oct 2026): a tapped link opens on its own desk beside this one (see openLinkDesk).
    LINKS.route = (href, from) => openLinkDesk(href, from);
    window.WizLinks.intercept(device, LINKS);
  }
  /* A tapped internal link opens on its own desk right beside the one it came from, full screen at once.
   * Tapped in a Chats thread, that desk is in review mode: amber edge, "Review" tag, and the orb sends what
   * James says as feedback to that thread. Back or ✕ closes it and lands on the thread again; Pin keeps it
   * as a normal desk. Links tapped inside a review desk navigate that same window (Back steps back). */
  function linkTitle(u) {
    const seg = decodeURIComponent(u.pathname.replace(/\/+$/, '').split('/').filter(Boolean)[0] || u.hostname);
    const app = APPS.find(x => x.url && u.pathname.startsWith(x.url.replace(/[#?].*$/, '')));
    return app ? app.name : seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  // Where a tapped link came from: Back or ✕ on what it opened closes that and lands here again.
  function fromOf(srcId) {
    const src = W[srcId], sid = src?.app === 'chats' && src.thread && src.thread !== '__new__' ? src.thread : '';
    return { desk: desks[deskOf(srcId)]?.id || desks[idx].id, win: srcId || '', sid, title: sid ? (LIVE?.session(sid)?.title || winTitle(src)) : (src ? winTitle(src) : '') };
  }
  function openLinkDesk(href, fromEl) {
    let u; try { u = new URL(href, location.href); } catch (e) { return false; }
    if (u.origin !== location.origin) return false;
    const srcId = (fromEl && fromEl.closest ? fromEl.closest('.win')?.dataset.win : '') || desks[idx].focus;
    const src = W[srcId], rel = u.pathname + u.search + u.hash;
    if (src && src.from && src.app === 'frame') { const f = winEl(srcId)?.querySelector('iframe'); if (f) { try { f.contentWindow.location.href = u.href; } catch (e) { f.src = u.href; } return true; } }
    const open = Object.values(W).find(w => w.from && w.url === rel); if (open) { goDesk(deskOf(open.id)); return true; }
    const from = fromOf(srcId);
    window.__ovLog = (window.__ovLog || []).concat('link:' + rel).slice(-30);
    return !!openWin({ app: 'frame', appId: 'link', url: rel, title: linkTitle(u), from });
  }
  /* ---------------- bound views ----------------
   * James, 12 Oct 2026: "as soon as I open the thread, I'm reading your response, but there's a view bound to it."
   * A thread whose latest reply links a page or app (the thing that was built or changed) opens that view on the
   * desk right beside the thread the moment the thread opens, out of view. The thread's right edge blends into it
   * (the next desk peeks in, with a tab carrying the app's sigil): tap the tab or swipe the bar to look. On the
   * view: the orb sends feedback to the thread (review mode), Back slides back to the thread, "Open app" keeps a
   * normal copy on a desk of its own, ✕ closes it for this reply. Leaving the thread (Back to the list, another
   * thread) closes the bound view; opening the thread again, or a new reply with a new link, binds again.
   * Binding = the first in-app link in the latest reply (an agent-declared view can replace this later). */
  var boundOff = {}, boundBusy = false;
  const BOUND_NOT = /^\/wizard\/(files|attachments|hermes|v1|api)\b|\.(png|jpe?g|gif|webp|avif|bmp|svg|pdf|apk|zip|mp4|mov|webm|mp3|m4a|wav|ogg)$/i;
  // Install and update pages are not views (James, 12 Oct: a Wizard OS release reply docked its download page). They
  // are about updating an app on the phone, not something to look at beside the thread. Wizard OS's own shell paths
  // are excluded too: the shell is already in front. Matching links are skipped; a later real view still binds.
  const BOUND_INSTALL = /^\/(downloads)\/|^\/reports\/(wizard-os|wizard-lock)(\/|$)|^\/wizard-os-home\/(?!(index|desktop)\.html$)./i;
  // Staging/sibling previews treat the live private hosts as this origin, so real replies bind there too.
  const BOUND_HOME = ['private.wizard001.com', 'wizard.tailc0f369.ts.net'];
  function boundAbs(href) {
    let u; try { u = new URL(href, location.href); } catch (e) { return null; }
    const sib = /\.staging\.wizard001\.com$|^127\.0\.0\.1$|^localhost$/.test(location.hostname);
    if (sib && u.protocol === 'https:' && BOUND_HOME.includes(u.hostname)) u = new URL(u.pathname + u.search + u.hash, location.origin);
    return u;
  }
  // What the latest reply in this painted thread points at: { key, app } or { key, url, title }, else null.
  function boundTarget(el) {
    const all = el.querySelectorAll('.ch-msgs .msg.a'), last = all[all.length - 1]; if (!last) return null;
    const rk = all.length + ':' + last.textContent.length; // which reply this is (a new reply reloads the same view)
    for (const a of last.querySelectorAll('.bub a[href]')) {
      if (a.hasAttribute('data-session') || a.hasAttribute('data-mlink') || a.closest('[data-mi]')) continue;
      const u = boundAbs(a.getAttribute('href')); if (!u || !/^https?:$/.test(u.protocol) || u.origin !== location.origin) continue;
      if (BOUND_NOT.test(u.pathname) || BOUND_INSTALL.test(u.pathname)) continue;
      const DL = window.WizCore.deeplink;
      if (DL && DL.isOwn(u)) {
        const d = DL.parse(u.href), app = d && d.open && !d.video ? (findApp(d.open) || APP[d.open]) : null;
        if (app && app.kind === 'wizard' && app.url) return { key: 'app:' + app.id, win: { app: 'frame', appId: app.id }, rk };
        if (app && app.id === 'usuals') return { key: 'app:usuals', win: { app: 'usuals' }, rk };
        continue; // ?session= / ?view= links are this shell's own screens, not a view to review
      }
      const rel = u.pathname + u.search + u.hash;
      return { key: 'url:' + rel, win: { app: 'frame', appId: 'link', url: rel, title: linkTitle(u) }, rk };
    }
    return null;
  }
  const boundOf = wid => Object.values(W).find(x => x.bound === wid && deskOf(x.id) >= 0) || null;
  function unbind(wid) { const b = boundOf(wid); if (b) closeWin(b.id, true); }
  // Called by Chats whenever a window paints a loaded thread (el) or its list (null).
  function threadShown(wid, el) {
    if (boundBusy) return; const w = W[wid]; if (!w || w.app !== 'chats') return;
    boundBusy = true;
    try {
      const b = boundOf(wid), sid = el && w.thread && w.thread !== '__new__' ? w.thread : '';
      if (!sid) { if (b) closeWin(b.id, true); delete boundOff[wid]; return; }
      if (b && b.bsid !== sid) { closeWin(b.id, true); delete boundOff[wid]; }
      const cur = boundOf(wid);
      if (cur && el.querySelector('.ch-msgs details.steps.live')) return; // a reply is being written: keep the view until it lands
      const t = boundTarget(el);
      if (!t) { if (cur) closeWin(cur.id, true); return; }
      if (cur && cur.bkey === t.key) {
        // Same view, newer reply (the change after James's feedback): reload it, unless he is looking at it.
        if (cur.brk !== t.rk && deskOf(cur.id) !== idx) { cur.brk = t.rk; save(); const f = winEl(cur.id)?.querySelector('iframe'); if (f) { try { f.contentWindow.location.reload(); } catch (e) { f.src = f.src; } } }
        return;
      }
      if (boundOff[wid] === sid + '|' + t.key) return;
      const at = deskOf(wid);
      if (at !== idx) return; // binds when James is on the thread (goDesk re-checks)
      if (cur) { if (deskOf(cur.id) === idx) return; closeWin(cur.id, true); } // never swap a view he is looking at
      const from = fromOf(wid), base = { from, bound: wid, bsid: sid, bkey: t.key, brk: t.rk };
      openWin({ ...t.win, ...base }, { stay: true });
      boundTip(wid);
    } finally { boundBusy = false; syncPeek(); }
  }
  // Re-check every open thread (after a desk change) and drop bound views whose thread went away.
  function syncBound() {
    if (boundBusy) return;
    for (const w of Object.values(W)) if (w.bound && deskOf(w.id) >= 0) { const c = W[w.bound]; if (!c || deskOf(c.id) < 0 || c.thread !== w.bsid) { boundBusy = true; try { closeWin(w.id, true); } finally { boundBusy = false; } } }
    const f = W[desks[idx]?.focus];
    if (f && f.app === 'chats' && f.thread && f.thread !== '__new__') { const el = winEl(f.id)?.querySelector('[data-chats]'); if (el && el.querySelector('.ch-thread') && CHATS.ch(f.id).loadedFor === f.thread) threadShown(f.id, el); }
    syncPeek();
  }
  function boundTip(wid) {
    const n = store.get('boundTips', 0); if (n >= 3) return;
    store.set('boundTips', n + 1);
    const b = boundOf(wid); if (b) toast('▸', `<b>${esc(clip(winTitle(b), 28))}</b> is open beside this thread · swipe the bottom bar to look`, 2600);
  }
  /* The peek (James, 12 Oct 2026: no tab, the bottom bar swipe is enough): on the thread the bound desk leans
   * 36 px in from the right; on the bound view its thread leans 12 px in from the left. */
  function syncPeek() {
    const f = W[desks[idx]?.focus], b0 = f && f.app === 'chats' && f.thread ? boundOf(f.id) : null, b = b0 && b0.bsid === f.thread ? b0 : null;
    const on = !!(b && deskOf(b.id) === idx + 1);
    const owner = f?.bound ? W[f.bound] : null;
    const left = !!(owner && owner.thread === f.bsid && deskOf(owner.id) === idx - 1);
    const nsec = on ? secOf(idx + 1) : null;
    const psec = left ? secOf(idx - 1) : null;
    const hsec = on ? secOf(idx) : null;
    const vsec = left ? secOf(idx) : null;
    $$('.desk.bound-peek', track).forEach(s => { if (s !== nsec) s.classList.remove('bound-peek'); });
    $$('.desk.bound-chat-peek', track).forEach(s => { if (s !== psec) s.classList.remove('bound-chat-peek'); });
    $$('.desk.bound-host', track).forEach(s => { if (s !== hsec) s.classList.remove('bound-host'); });
    $$('.desk.bound-view-host', track).forEach(s => { if (s !== vsec) s.classList.remove('bound-view-host'); });
    if (nsec) nsec.classList.add('bound-peek');
    if (psec) psec.classList.add('bound-chat-peek');
    if (hsec) hsec.classList.add('bound-host');
    if (vsec) vsec.classList.add('bound-view-host');
    device.classList.toggle('bound-peeking', on);
    device.classList.toggle('bound-view-peeking', left);
  }
  // "Open app": a normal copy on a desk of its own, beside the bound one; the bound view stays with the thread.
  function detachBound(id) {
    const w = W[id]; if (!w || !w.from) return;
    if (!w.bound) return pinWin(id); // a manually opened review becomes its own app desk
    const href = frameHref(id) || w.url || '';
    const a = w.appId && w.appId !== 'link' ? (findApp(w.appId) || APP[w.appId]) : null;
    if (w.app === 'usuals') { const here = Object.keys(W).find(k => W[k].app === 'usuals' && !W[k].bound && deskOf(k) >= 0); if (here) goDesk(deskOf(here)); else openWin({ app: 'usuals' }); }
    else if (a) {
      const here = Object.keys(W).find(k => W[k].app === 'frame' && W[k].appId === a.id && !W[k].from && deskOf(k) >= 0);
      if (here) { bringBeside(here); goDesk(deskOf(here), true); focusWin(here); }
      else openWin({ app: 'frame', appId: a.id, ...(href && href !== a.url ? { url: href } : {}) });
    } else openWin({ app: 'frame', appId: 'link', url: href, title: winTitle(w) });
    toast('↗', `${esc(clip(winTitle(w), 30))} has its own desk now · the review view stays with the thread`, 2200);
  }
  function pinWin(id) {
    const w = W[id]; if (!w || !w.from) return;
    delete w.from; save();
    const el = winEl(id); if (el) { el.classList.remove('reviewing'); el.querySelector('[data-wact="detach"]')?.remove(); el.querySelector('.rv-tag')?.remove(); }
    applyLayout(deskOf(id)); renderDots(); syncReviewChip(); toast('↗', 'Open app · it now has its own desk', 1600);
  }
  /* Review mode: the amber orb ring is the only lasting marker (James, 10 Oct 2026: no persistent chip).
   * The first time a review desk opens, a one-off card explains it; tap anywhere or Back dismisses it. */
  let rvCoach = null;
  function closeReviewCoach() { if (!rvCoach) return false; const el = rvCoach; rvCoach = null; el.classList.remove('open'); setTimeout(() => el.remove(), 240); return true; }
  function showReviewCoach(f) {
    if (rvCoach || store.get('rvCoached', false)) return;
    store.set('rvCoached', true);
    rvCoach = document.createElement('div'); rvCoach.className = 'rv-coach'; rvCoach.setAttribute('role', 'dialog'); rvCoach.setAttribute('aria-label', 'Review mode');
    rvCoach.innerHTML = `<div class="rv-card"><div class="rv-h"><i></i>Review mode</div>
      <p><b>Tap the orb and talk.</b> Your feedback goes to <b>${esc(clip(LIVE?.session(f.from.sid)?.title || (f.from.title !== 'Thread' && f.from.title) || 'the thread you came from', 48))}</b>.</p>
      <p><b>Open app</b> keeps the app on its own desk${f.bound ? ", while this review stays with the thread" : ""}.</p>
      <p>${f.bound ? "<b>Swipe right on the bottom bar</b> to return to the thread. <b>Back</b> returns too; leaving the thread closes its review view." : "<b>Back</b> or <b>✕</b> closes the review and takes you back."}</p>
      <button class="rv-ok" type="button">Got it</button></div>`;
    rvCoach.addEventListener('click', () => closeReviewCoach());
    device.appendChild(rvCoach); void rvCoach.offsetWidth; rvCoach.classList.add('open');
  }
  function syncReviewChip() {
    const f = desks[idx] ? W[desks[idx].focus] : null, on = !!(f && f.from && f.from.sid);
    device.classList.toggle('reviewing', on);
    if (on) showReviewCoach(f); else closeReviewCoach();
  }
  /* Quick search: results open in the link sheet over whatever James is doing (no thread, no desk change). */
  function openSearch(query, tab) {
    const url = searchUrl(query, tab); if (!url) return false;
    closeSheets(true); mountLinks(); if (!LINKS) return false;
    LINKS.open(url); return true;
  }
  /* THE placement rule for every app (James, 12 Oct 2026: apps always open in a new tab, as system behaviour,
   * never per app). An app opener only says what to show (obj) and how to spot its open copy (mine); it never
   * picks a desk. Not open yet: its own desk right beside the one in front (openWin). Already open: that window,
   * brought beside the desk in front on a desk of its own (refresh lets the app take the new query/date).
   * Chats is the hub and stays where it is; an explicit user placement (opts.desk) always gets a fresh window. */
  function placeApp(mine, obj, opts = {}, refresh) {
    const here = opts.desk == null ? Object.keys(W).find(id => deskOf(id) >= 0 && mine(W[id])) : null;
    if (!here) return openWin(obj, opts);
    if (W[here].app !== 'chats') bringBeside(here);
    const t = deskOf(here);
    if (refresh) refresh(W[here], t);
    if (t !== idx) goDesk(t, true);
    focusWin(here); save();
    return W[here];
  }
  // Hosted Wizard apps (App Store, System) ask the shell to open another installed app in its own window.
  const hostedOpenable = id => { const a = APP[id]; if (!a?.url || a.kind !== 'wizard') return null; try { if (new URL(a.url, location.origin).origin !== location.origin) return null; } catch (e) { return null; } return a; };
  window.WizCanOpen = id => !!hostedOpenable(id);
  // Only the App Store and System windows may ask; the sender is checked by its actual frame, not by anything it says.
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:open-app' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && W[host.dataset.win]; if (!w || !['app-store', 'system'].includes(w.appId)) return;
    const a = hostedOpenable(d.id); if (a) openApp(a);
  });
  function openApp(a, extra = {}, opts = {}) {
    if (!a) return false;
    if (a.id === 'side-button') { closeSheets(true); if (idx !== HOME) goDesk(HOME); sideButtonTap(true); return true; }
    if (a.kind === 'view') {
      if (a.view === 'inbox') { openSheet('inbox'); return true; }
      openReview(a.view, extra.date, opts); return true;
    }
    if (a.id === 'usuals') { openUsuals(opts); return true; }
    if (a.id === 'maps') { openMaps(extra.query ? 'search' : 'home', extra.query || '', opts); return true; }
    if (a.kind === 'chats') { placeApp(w => w.app === 'chats', { app: 'chats', thread: null }, opts); return true; }
    if (a.kind === 'wizard' && a.url && opts.from) {
      // Opened from a link in a thread (James, 12 Oct 2026): Back closes it and lands on that thread again,
      // exactly like any other link. A copy already opened from a link is reused; a normal desk of the app is left alone.
      placeApp(w => w.app === 'frame' && w.appId === a.id && w.from, { app: 'frame', appId: a.id, from: opts.from }, {}, w => { w.from = opts.from; });
      return true;
    }
    if (a.kind === 'wizard' && a.url) { placeApp(w => w.app === 'frame' && w.appId === a.id && !w.from, { app: 'frame', appId: a.id }, opts); return true; }
    const q = extra.query || '';
    placeApp(w => w.app === 'app' && w.appId === a.id, { app: 'app', appId: a.id, query: q }, opts, q ? (w, t) => { w.query = q; renderDesk(t); } : null);
    return true;
  }
  function openMaps(mode, dest, opts = {}) {
    closeSheets(true);
    placeApp(w => w.app === 'maps', { app: 'maps', dest, mode }, opts, dest || mode === 'home' ? (w, t) => { if (!dest && w.dest) return; w.dest = dest; w.mode = mode; renderDesk(t); } : null);
  }
  function openUsuals(opts = {}) {
    closeSheets(true);
    placeApp(w => w.app === 'usuals', { app: 'usuals' }, opts, () => window.WosUsuals?.refresh());
  }
  function openReview(level, date, opts = {}) {
    const z = level === 'month' ? { level: 'month' } : level === 'week' ? { level: 'week', week: weekOf(date || YESTERDAY) } : { level: 'day', day: date || YESTERDAY };
    placeApp(w => w.app === 'review', { app: 'review', z }, opts, (w, t) => { w.z = z; w.zd = 0; setTimeout(() => { mountReview(w.id, null); applyLayout(deskOf(w.id)); }, 0); });
  }
  /* Move an open window to where a new app would open (insertPos: right beside this desk, Home included.
   * A window alone on its desk takes its whole desk along; one sharing a desk gets a desk of its own. */
  function bringBeside(id) {
    const from = deskOf(id); if (from < 0 || from === idx) return;
    const t = insertPos(); if (from === t) return;
    if (desks[from].wins.length === 1) {
      const [d] = desks.splice(from, 1); desks.splice(from < t ? t - 1 : t, 0, d);
      if (idx > from && idx <= t) idx--; // keep the desk in front (Home) the same desk
    } else {
      const f = desks[from]; f.wins = f.wins.filter(x => x !== id); if (f.focus === id) f.focus = f.wins[f.wins.length - 1] || null; f.full = false;
      desks.splice(t, 0, blank({ wins: [id], focus: id })); renderDesk(from);
    }
    syncDesks(); save();
  }
  /* Home's Unread and Working cards: the Chats window, filtered to just those threads. Back clears the filter
   * and returns to the desk the card was tapped on. */
  function openChatsFiltered(f, opts = {}) {
    closeSheets(true);
    const from = desks[idx].id;
    let here = Object.keys(W).find(id => W[id].app === 'chats' && deskOf(id) >= 0);
    if (!here) { openApp(APP.wizard); here = Object.keys(W).find(id => W[id].app === 'chats' && deskOf(id) >= 0); }
    if (!here) return;
    const t = deskOf(here); if (t !== idx) goDesk(t, true);
    focusWin(here); const w = W[here], d = desks[t]; if (d.full && d.focus !== here) setFull(d.focus, false);
    const c = CHATS.ch(here); c.subject = ''; c.q = ''; c.sheet = false; c.lastChip = 'status';
    // The chip is the same one James can add himself from the filter button; the first time, one coach line.
    c.coach = !store.get('chipCoached', false); store.set('chipCoached', true);
    c.fromCard = !!opts.card;
    c.filter = ''; CHATS.setFilter(w, f); c.filterFrom = opts.from === undefined ? from : opts.from;
  }

  /* ---------------- side button (Wizard OS Android app only) ----------------
   * The switch lives on Home. One tap: Wizard OS asks for the microphone in place, then opens the one system page
   * Android keeps for itself (pick Wizard OS as the assistant). Back in Wizard OS, the app pushes the new state to
   * window.__wosSideButton and the card turns green on its own. Once the side button has really reached Wizard
   * OS, the card disappears. */
  const NATIVE = () => window.WizardOSNative && typeof window.WizardOSNative.sideButton === 'function';
  let SIDE = null;
  try { if (NATIVE()) SIDE = JSON.parse(window.WizardOSNative.sideButton()); } catch (e) { SIDE = null; }
  function sideCard() {
    if (!SIDE || SIDE.step === 'ready' || store.get('sideHidden', false)) return '';
    const on = SIDE.step === 'press';
    const k = on ? 'Side button is on' : 'Side button';
    const v = on ? (SIDE.samsung ? 'Hold the side button and talk · power menu? tap here' : 'Hold the side button and talk') : 'Hold it to talk to Wizard, even when locked';
    const btn = on ? '' : `<span class="side-go">${SIDE.step === 'mic' ? 'Turn on' : 'Finish'}</span>`;
    return `<button class="now-card side-card ${on ? 'on' : ''}" style="--c:${on ? 'var(--green)' : 'var(--violet-2)'}" data-act="side-button" data-step="${SIDE.step}"><span class="pip ${on ? '' : 'pulse'}"></span><span class="meta"><span class="k">${k}</span><span class="v">${v}</span></span>${btn}${on ? '<span class="side-x" data-act="side-button-hide" aria-label="Hide">✕</span>' : ''}</button>`;
  }
  function sideButtonTap(fromLauncher) {
    if (!NATIVE()) { toast('◉', 'The side button works in the Wizard OS app'); return; }
    if (SIDE && SIDE.step !== 'mic' && SIDE.step !== 'assistant') {
      if (fromLauncher) { store.set('sideHidden', false); refreshHome(true); }
      toast('◉', SIDE.step === 'ready' ? 'Side button is on. Hold it to talk.' : 'Side button is on. Hold it and talk.', 2600);
      // Samsung: if holding the key still opens the power menu, the tap goes straight to Samsung's Side button page.
      if (SIDE.samsung && SIDE.step === 'press') window.WizardOSNative.sideButtonSettings();
      else if (fromLauncher && SIDE.samsung) window.WizardOSNative.sideButtonSettings();
      return;
    }
    window.__backLog = (window.__backLog || []).concat('side:' + (SIDE ? SIDE.step : '?')).slice(-30);
    window.WizardOSNative.setupSideButton();
  }
  window.__wosSideButton = st => {
    if (!st || typeof st !== 'object') return false;
    const was = SIDE && SIDE.step; SIDE = st;
    if (was !== st.step) refreshHome(true);
    return true;
  };

  /* ---------------- settings & unsent ----------------
   * The gear sits top-right wherever no app is in front (Home and empty desks). Settings holds Wizard Everywhere,
   * the side button and the Unsent list. Unsent = everything saved on this phone that Wizard hasn't accepted yet:
   * messages from the app (outbox) and recordings from the Everywhere button (native outbox), one list, Retry each. */
  const GEAR_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  function gearBtn() { const n = unsentAll().length; return `<button class="gear" data-act="settings" aria-label="Settings${n ? `, ${n} unsent` : ''}">${GEAR_SVG}${n ? `<span class="gear-n">${n}</span>` : ''}</button>`; }
  let NATIVE_UNSENT = [];
  function readNativeUnsent() { try { NATIVE_UNSENT = NATIVE() && window.WizardOSNative.unsent ? JSON.parse(window.WizardOSNative.unsent()) : []; } catch (e) { NATIVE_UNSENT = []; } }
  // From the app (outbox) and from the Everywhere button (native), oldest first.
  function unsentAll() {
    const web = OUTBOX ? OUTBOX.unsent().map(it => ({ ...it, origin: 'app' })) : [];
    const nat = (NATIVE_UNSENT || []).map(it => ({ ...it, origin: 'everywhere' }));
    return [...web, ...nat].sort((a, b) => a.createdAt - b.createdAt);
  }
  function unsentCard() {
    const all = unsentAll(); if (!all.length) return '';
    const failed = all.filter(x => x.state === 'failed').length;
    const k = failed ? `${failed} not sent` : `${all.length} waiting to send`;
    const v = esc(clip(all[0].text || 'Voice note', 70));
    return `<button class="now-card unsent-card ${failed ? 'fail' : ''}" style="--c:${failed ? 'var(--amber)' : 'var(--violet-2)'}" data-act="unsent"><span class="pip ${failed ? '' : 'pulse'}"></span><span class="meta"><span class="k">${k}</span><span class="v">${v}</span></span><span class="side-go">${failed ? 'Retry' : 'View'}</span></button>`;
  }
  function unsentRow(it) {
    const when = ago(new Date(it.createdAt).toISOString());
    const st = it.state === 'failed' ? `<b class="fail">Not sent</b> · ${esc(it.error || '')}` : it.state === 'sending' ? 'Sending…' : `${esc(it.error || 'Waiting')} · retrying`;
    const src = it.origin === 'everywhere' ? 'Everywhere button' : it.source === 'orb' ? 'Orb' : 'Chat';
    return `<div class="ub-row ${it.state}" data-ubid="${esc(it.id)}" data-uborigin="${it.origin}">
      <div class="ub-t">${it.audio || it.audioFile || it.hasAudio ? MIC_SVG : ''}<span>${esc(it.text || 'Voice note · words come when it sends')}</span></div>
      <div class="ub-m">${src} · ${esc(when)} · ${st}</div>
      <div class="ub-a"><button data-ub="retry">${it.state === 'failed' ? 'Retry' : 'Retry now'}</button>${it.origin === 'app' && it.sessionId && LIVE?.session(it.sessionId) ? '<button data-ub="open">Open thread</button>' : ''}${it.origin === 'app' ? '<button data-ub="edit">Edit</button>' : ''}<button data-ub="delete" class="ghost">Delete</button></div></div>`;
  }
  function renderSettings() {
    readNativeUnsent();
    const all = unsentAll(), native = NATIVE(), evNative = native && typeof window.WizardOSNative.setEverywhere === 'function';
    let ev = null; try { ev = evNative ? JSON.parse(window.WizardOSNative.everywhere()) : null; } catch (e) {}
    const evOn = !!ev?.enabled;
    const evSub = !native ? 'Works in the Wizard OS Android app' : !evNative ? 'Update the Wizard OS app (0.5.0) to turn this on' : evOn ? (ev.overlay ? (ev.hold ? 'On · tap to talk · hold for Select text, Translate and Hide' : 'On · floats over other apps, hides while Wizard OS is open') : 'Needs “Display over other apps”') : 'A floating Wizard button over your other apps. Tap to talk, drag to move.';
    const side = !native ? 'Works in the Wizard OS Android app' : !SIDE ? '' : SIDE.step === 'press' || SIDE.step === 'ready' ? 'On · hold the side button to talk' : 'Hold the side button to talk, even when locked';
    $('#settingsBody').innerHTML = `
      <h3 class="st-title">Settings</h3>
      <div class="st-group"><h4>Unsent <span>${all.length || ''}</span></h4>
        ${all.length ? all.map(unsentRow).join('') + (all.length > 1 ? '<button class="st-wide" data-ub-all="retry">Retry all</button>' : '') : '<div class="st-empty">Everything you’ve said reached Wizard.</div>'}
        <p class="st-note">Every message is saved on this phone before it’s sent, and retried until Wizard accepts it.</p></div>
      ${lookGroup()}
      <div class="st-group"><h4>Assistant</h4>
        <button class="st-row" data-st="everywhere" ${evNative ? '' : 'disabled'}><span class="st-ic">✦</span><span class="st-tx"><b>Wizard Everywhere</b><small>${esc(evSub)}</small></span><span class="sw ${evOn ? 'on' : ''}"><i></i></span></button>
        ${evNative && evOn && typeof window.WizardOSNative.voiceTypingSettings === 'function' ? `<button class="st-row" data-st="typing"><span class="st-ic">⌨</span><span class="st-tx" id="stTyping"><b>Voice typing &amp; screenshots</b><small>${esc(ev?.keyboard ? 'On · with a keyboard open the orb types what you say' : 'Off · tap to set up: the orb types into any app and attaches screenshots')}</small></span>${ev?.keyboard ? '<span class="sw on"><i></i></span>' : '<span class="st-go">›</span>'}</button>` : ''}
        <button class="st-row" data-st="side" ${native ? '' : 'disabled'}><span class="st-ic">◉</span><span class="st-tx"><b>Side button</b><small>${esc(side)}</small></span><span class="st-go">›</span></button>
      </div>
      ${window.WizCore.voiceStatus?.card() || ''}
      ${window.WosCancelled ? window.WosCancelled.html() : ''}
      ${window.WosSelMenu ? window.WosSelMenu.html() : ''}
      <div class="st-group"><h4>Wizard</h4>
        <div class="st-row static"><span class="st-ic">◇</span><span class="st-tx"><b>${LIVE?.ok ? 'Connected' : LIVE?.error === 'access' ? 'Sign-in needed' : 'Connecting…'}</b><small>${native ? esc(window.WizardOSNative.platform()) : 'Web'} · ${esc(location.host)}</small></span></div>
        ${window.WosDevice?.settingsHtml?.() || ''}
        <button class="st-row" data-st="help"><span class="st-ic">?</span><span class="st-tx"><b>Gestures &amp; help</b><small>How the orb, desks and Back work · practice again</small></span><span class="st-go">›</span></button>
        ${window.WosFiles ? `<button class="st-row" data-st="files"><span class="st-ic">▤</span><span class="st-tx"><b>Files</b><small>Everything in Wizard Files · preview, attach to a chat</small></span><span class="st-go">›</span></button>` : ''}
      </div>
      ${window.WosUsage ? window.WosUsage.html() : ''}`;
    // AI usage (#24): read when Settings opens, painted in place when it lands.
    if (window.WosUsage && !window.WosUsage.loading && (!window.WosUsage.snap || Date.now() - window.WosUsage.at > 60e3)) window.WosUsage.load().then(paintUsage);
  }
  /* Settings → Look (James, 12 Oct 2026): the skin picker. Tap applies at once (WosSkin.set) and is kept on this
   * device (localStorage wos.skin; box-level theme.json sync is a later step). Hosted apps re-dress through the
   * appearance host, which watches html[data-skin]/style. */
  function lookGroup() {
    const S = window.WosSkin; if (!S) return '';
    const cur = S.current, nm = (S.list.find(k => k.id === cur) || {}).name || '';
    return `<div class="st-group" data-stgroup="look"><h4>Look</h4>
      <div class="st-row static sk-row"><div class="sk-head"><span class="st-ic">◐</span><span class="st-tx"><b>Skin</b><small data-skinname>${esc(nm)} · tap to wear</small></span></div>
        <div class="sk-sw" role="group" aria-label="Skin">${S.list.map(k => `<button class="sk-opt" data-skinpick="${esc(k.id)}" aria-pressed="${k.id === cur}" aria-label="${esc(k.name)}" style="--sk-bg:${esc(k.bg)};--sk-ac:${esc(k.accent)}"><span class="sk-dot"></span><span class="sk-nm">${esc(k.name)}</span></button>`).join('')}</div></div></div>`;
  }
  function pickSkin(id) {
    const S = window.WosSkin; if (!S) return;
    const now = S.set(id), nm = (S.list.find(k => k.id === now) || {}).name || '';
    $$('#settingsBody [data-skinpick]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.skinpick === now)));
    const n = $('#settingsBody [data-skinname]'); if (n) n.textContent = `${nm} · tap to wear`;
    vib(8);
  }
  function paintUsage() { const g = $('#settingsBody [data-usage]'); if (g && sheet === 'settings') g.outerHTML = window.WosUsage.html(); }
  function openFilesScreen() {
    closeSheets(true);
    let wid = chatsWinAny();
    if (!wid) { const w = openWin({ app: 'chats', thread: null }); if (!w) return; wid = w.id; }
    focusWin(wid); renderChats(W[wid]);
    setTimeout(() => CHATS.PW?.openFiles(wid), 30);
  }
  function openSettings(focusUnsent) {
    openSheet('settings');
    if (focusUnsent === 'look') { // scroll the sheet body only (scrollIntoView would also move the fixed shell)
      const body = $('#settingsBody'), g = $('#settingsBody [data-stgroup="look"]');
      if (body && g) body.scrollTop += g.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
      return;
    }
    if (focusUnsent) { const g = $('#settingsBody .st-group'); g && g.scrollIntoView({ block: 'start' }); }
  }
  function unsentAction(id, origin, a) {
    if (origin === 'everywhere') {
      if (a === 'retry' && window.WizardOSNative?.retryUnsent) window.WizardOSNative.retryUnsent(id);
      if (a === 'delete' && window.WizardOSNative?.deleteUnsent) window.WizardOSNative.deleteUnsent(id);
      setTimeout(onUnsentChange, 300); return;
    }
    const it = OUTBOX.get(id); if (!it) return;
    if (a === 'retry') { OUTBOX.retry(id); toast('↻', 'Sending again', 1400); }
    if (a === 'delete') { OUTBOX.remove(id); toast('✕', 'Deleted', 1400); }
    if (a === 'open') { closeSheets(true); openWizardThread(it.sessionId); }
    if (a === 'edit') editUnsent(it);
  }
  // Edit puts the words back in a composer (the thread's, or a new chat's) and takes the item out of the queue.
  function editUnsent(it) {
    closeSheets(true);
    const known = it.kind === 'reply' || (LIVE && LIVE.session(it.sessionId));
    let wid = chatsWinAny();
    if (!wid) { const w = openWin({ app: 'chats', thread: null }); if (!w) return; wid = w.id; }
    focusWin(wid); openChat(wid, known ? it.sessionId : '__new__');
    CHATS.setDraft(wid, it.text || it.typed || '', (it.files || []).filter(f => f !== it.audioFile));
    OUTBOX.remove(it.id);
    renderChats(W[wid]);
    setTimeout(() => { const ta = track.querySelector(`[data-chats="${wid}"] textarea`); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 50);
  }
  let lastUnsentSig = '';
  function onUnsentChange() {
    readNativeUnsent();
    if (sheet === 'settings') renderSettings();
    if (sheet === 'inbox') renderInbox();
    refreshHome(); renderMoons();
    desks.forEach((d, i) => { if (!d.wins.length && !d.home) { const g = secOf(i)?.querySelector('.glance'); if (g) g.innerHTML = renderEmpty(i); } });
    for (const id of Object.keys(W)) { const w = W[id]; if (w.app === 'chats' && w.thread) { const el = track.querySelector(`[data-chats="${id}"]`); if (el) renderThread(w, el); } }
    // Tell Android how many app messages are stuck, so it can say so in a notification while the app is closed.
    const failed = OUTBOX ? OUTBOX.unsent().filter(x => x.state === 'failed') : [];
    const sig = failed.map(x => x.id).join(',');
    if (sig !== lastUnsentSig) { lastUnsentSig = sig; try { NATIVE() && window.WizardOSNative.appUnsent && window.WizardOSNative.appUnsent(failed.length, failed[0]?.text || ''); } catch (e) {} }
  }
  OUTBOX?.onChange(onUnsentChange);
  window.__wosUnsent = () => { onUnsentChange(); return true; };
  window.__wosEverywhere = () => { if (sheet === 'settings') renderSettings(); return true; };

  /* ---------------- home desk ---------------- */
  function renderHome() {
    const L = live(), needs = L.needs.length, ready = L.ready.length;
    // Working counts what the Chats Working list (and the Working card's filter) shows, sending messages included.
    const W0 = LIVE && LIVE.ok ? (LIVE.workGroups().working || []) : [], working = W0.length;
    const yd = byDay[YESTERDAY] || [];
    const now = new Date();
    return `<div class="home">${gearBtn()}
      <div class="home-top">
        <div class="home-date" id="homeDate">${(() => { const p = window.WizConfig.dayParts(now.getTime()); return `${DOWL[p.dow]} · ${p.d} ${MON[p.m - 1]}`; })()}</div>
        <div class="home-time" id="homeTime">${window.WizConfig.hm()}</div>
        <div class="home-line">${LIVE.ok ? `<b>${needs} need${needs === 1 ? 's' : ''} you</b>, ${ready} unread, ${working} working.` : LIVE.error === 'access' ? 'Sign in to Wizard to see your threads.' : 'Connecting to Wizard…'}</div>
      </div>
      <div class="home-gap home-gap-a"></div>
      <div class="home-attn">
      <div class="constellation">
        <button class="now-card wz-home-widget" style="--c:${needs ? 'var(--amber)' : 'var(--green)'}" data-act="unread"><span class="pip"></span><span class="meta"><span class="k">${needs ? 'Needs you' : 'Unread'}</span><span class="v">${esc(L.needs[0]?.title || L.ready[0]?.title || 'Nothing waiting')}</span></span><span class="n">${needs + ready}</span></button>
        <button class="now-card wz-home-widget" style="--c:var(--violet-2)" data-act="working"><span class="pip pulse"></span><span class="meta"><span class="k">Working</span><span class="v">${esc(W0[0]?.title || 'Idle')}</span></span><span class="n">${working}</span></button>
      </div>
      ${unsentCard()}
      ${sideCard()}
      <button class="now-card wz-home-widget sys-card" style="--c:var(--cyan)" data-act="system"><span class="sys-glyph" aria-hidden="true">◈</span><span class="meta"><span class="k">Your system</span><span class="v">Agents, apps, connections</span></span><span class="side-go">Open</span></button>
      </div>
      <div class="home-gap home-gap-b"></div>
      ${window.WosResources?.home() || ''}
    </div>`;
  }
  setInterval(() => {
    const now = new Date(), t = $('#homeTime'), c = $('#clock');
    const hm = window.WizConfig.hm();
    if (t) t.textContent = hm; if (c) c.textContent = hm;
  }, 5000);
  const refreshHome = force => { if (!desks[HOME].wins.length) { const g = secOf(HOME)?.querySelector('.glance'); if (g) g.innerHTML = renderHome(); } };

  /* ---------------- empty desk, app cards, maps, frames ---------------- */
  /* ＋ after the last desk (James, 12 Oct 2026): jump straight to a new desk at the end of the strip. An empty desk
   * is a page of app tiles, not a pop-up: tap one and it opens right here. Leave without picking and the desk goes. */
  function newDesk() {
    const last = desks.length - 1;
    if (last > 0 && !desks[last].wins.length) return goDesk(last);
    desks.push(blank({})); syncDesks(); renderDots(); goDesk(desks.length - 1, true); announce('<b>New desk</b>');
  }
  function renderEmpty(i) {
    const grp = (h, list) => list.length ? `<div class="lgroup"><h4>${h}</h4><div class="lgrid">${list.map(appTile).join('')}</div></div>` : '';
    const wiz = APPS.filter(a => a.kind === 'wizard' || a.kind === 'chats' || a.kind === 'usuals'), views = APPS.filter(a => a.kind === 'view');
    tileN = 0;
    return `<div class="desk-scroll new-desk"><div class="nd-head"><b>New desk</b><span>Pick an app to open here</span></div>${grp('Apps', wiz)}${grp('Views', views)}</div>`;
  }
  function renderApp(w) {
    const a = APP[w.appId] || {};
    const native = a.kind === 'native';
    let href = a.url || a.href;
    if (a.id === 'spotify' && w.query) href = `spotify:search:${encodeURIComponent(w.query)}`;
    return `<div class="desk-scroll"><div class="appcard">${ico('div', 'hero', a).replace(/^(<div[^>]*>)([\s\S]*)<\/div>$/, '$1<span class="big">$2</span></div>')}
      <div class="body"><h3>${esc(a.name)}${w.query ? ` · “${esc(w.query)}”` : ''}</h3><p>${esc(a.desc || '')}${native ? '. Opens the real Android app.' : ''}</p>
      <a class="cta" href="${esc(href)}" target="${native ? '_self' : '_blank'}" rel="noopener">Open ${esc(a.name)}</a></div></div></div>`;
  }
  function renderMaps(w) {
    const q = w.dest || '';
    const link = w.mode === 'dir' ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=driving`
      : q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : 'https://www.google.com/maps';
    const roads = Array.from({ length: 9 }, (_, i) => `<path d="M${-20 + i * 55} -10 L${40 + i * 48} 360" stroke="rgba(120,140,200,.16)" stroke-width="${i % 3 ? 2 : 6}"/>`).join('') +
      Array.from({ length: 8 }, (_, i) => `<path d="M-10 ${20 + i * 46} L420 ${-10 + i * 52}" stroke="rgba(120,140,200,.13)" stroke-width="${i % 3 ? 2 : 5}"/>`).join('');
    return `<div class="desk-scroll">
      <div class="map"><svg viewBox="0 0 360 330" preserveAspectRatio="xMidYMid slice">
        <path d="M-10 250 C 80 230, 120 300, 210 270 S 330 250, 380 300 L380 340 L-10 340Z" fill="rgba(63,120,255,.13)"/>
        ${roads}
        ${w.mode === 'dir' ? '<path class="route" d="M70 260 C 110 210, 120 190, 170 170 S 250 120, 282 82" fill="none" stroke="#3fe0ff" stroke-width="5" stroke-linecap="round" stroke-dasharray="7 9"><animate attributeName="stroke-dashoffset" from="64" to="0" dur="1.4s" repeatCount="indefinite"/></path>' : ''}
      </svg>
      ${w.mode === 'dir' ? '<span class="me" style="left:62px;top:252px"></span>' : ''}<span class="pin" style="left:${w.mode === 'dir' ? 274 : 170}px;top:${w.mode === 'dir' ? 64 : 140}px"></span>
      <div class="eta"><b>${w.mode === 'dir' ? 'Route ready' : q ? 'Found' : 'Maps'}</b><span>${w.mode === 'dir' ? 'Live ETA comes from Google Maps' : 'Preview'}</span></div></div>
      <div class="map-dest"><h3>${esc(q || 'Google Maps')}</h3><p>${w.mode === 'dir' ? 'Driving directions' : 'Search results'} · opens the real Maps app on Android</p></div>
      <a class="cta" href="${esc(link)}" rel="noopener">${w.mode === 'dir' ? 'Start navigation in Maps' : 'Open in Maps'}</a></div>`;
  }
  function renderFrame(w) {
    const a = APP[w.appId] || winApp(w);
    return renderFrameCore(w, a);
  }
  function renderFrameCore(w, a) {
    return `<div class="frame-wrap"><div class="frame-coming">${ico('span', 'glyph', a)}<h3>${esc(a.name)} is on its way</h3><p>${esc(a.desc || '')}. It’s being built in another thread and appears here on its own once it’s published.</p></div><iframe class="appframe" ${a.probe ? `data-probe="${esc(w.url || a.url)}"` : ''} src="${esc(w.url || a.url || '/')}" title="${esc(a.name || 'App')}" allow="microphone; clipboard-read; clipboard-write; autoplay; fullscreen" referrerpolicy="same-origin"></iframe>
      <div class="frame-fallback">${ico('span', 'glyph', a)}<h3>${esc(a.name)} can’t run in a window yet</h3><p>It opens in its own tab instead.</p><a class="cta" href="${esc(a.url || '/')}" target="_blank" rel="noopener">Open ${esc(a.name)}</a></div></div>`;
  }
  // A refused frame lands on an unreadable error document: show the fallback card.
  // Readable (same-origin) frames get the shell's Back handling, pinch, and voice hooks.
  function probeFrame(f, url) {
    const wrap = f.closest('.frame-wrap'); if (!wrap) return;
    fetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' }).then(r => {
      if (r.ok) { if (wrap.classList.contains('coming')) { wrap.classList.remove('coming'); try { f.contentWindow.location.replace(url); } catch (e) { f.src = url; } } }
      else { wrap.classList.add('coming'); setTimeout(() => { if (f.isConnected) probeFrame(f, url); }, 60000); }
    }).catch(() => setTimeout(() => { if (f.isConnected) probeFrame(f, url); }, 60000));
  }
  /* Hosted apps must not pad the Back stack: a history entry an app pushes
   * without the user touching it (router boot, redirects) becomes a replace.
   * Patched as early as the new document exists, before its module scripts run. */
  function tameHistory(win) {
    try {
      if (!win || win.__wosTamed || !win.history) return;
      win.__wosTamed = true;
      const h = win.history, push = h.pushState.bind(h), rep = h.replaceState.bind(h);
      h.pushState = function (st, t, u) { const r = (win.navigator.userActivation?.isActive ? push : rep)(st, t, u); try { win.__wosHref = win.location.href; } catch (e) {} return r; };
      h.replaceState = function (st, t, u) { const r = rep(st, t, u); try { win.__wosHref = win.location.href; } catch (e) {} return r; };
      // The app stepping back through its own entries (collapse a section with history.back()) is the app's
      // step, never the user's Back: mark it so the frame popstate below lets the app handle it (James, 10 Oct:
      // collapsing a part in a full-screen app dropped full screen).
      const bk = h.back.bind(h), go = h.go.bind(h);
      h.back = function () { selfPop(win); return bk(); };
      h.go = function (n) { if (+n < 0) selfPop(win); return go(n); };
    } catch (e) {}
  }
  function selfPop(win) { try { win.__wosSelfPop = Date.now() + 800; } catch (e) {} }
  function takeSelfPop(win) { try { if (win.__wosSelfPop && Date.now() < win.__wosSelfPop) { win.__wosSelfPop = 0; return true; } } catch (e) {} return false; }
  function watchEarly(f) {
    let last = null, n = 0;
    const tick = () => {
      if (!f.isConnected) return;
      try { const w = f.contentWindow; if (w && w !== last && w.location.href !== 'about:blank') { last = w; tameHistory(w); } } catch (e) {}
      if (++n < 4000) setTimeout(tick, 4);
    };
    tick();
    f.addEventListener('load', () => { n = 0; tick(); });
  }
  function watchFrames(root) {
    $$('iframe.appframe', root).forEach(f => {
      if (f._watched) return; f._watched = true;
      watchEarly(f);
      const wrap = f.closest('.frame-wrap');
      if (f.dataset.probe) { wrap.classList.add('coming'); f.removeAttribute('src'); probeFrame(f, f.dataset.probe); }
      f.addEventListener('load', () => {
        let ok = false, why = '';
        try { const doc = f.contentDocument; why = doc ? doc.location.href : 'nodoc'; ok = !!doc && doc.location.href !== 'about:blank'; } catch (e) { ok = false; why = 'x:' + e.name; }
        window.__frameLog = (window.__frameLog || []).concat(why).slice(-40); // bounded: the shell may run for weeks
        if (why === 'about:blank') {
          // A frame that had a real page and is back on blank was traversed by the Back key (cross-document, so no
          // popstate fires). That press belongs to the shell: take the step and restore the app in place.
          if (f._lastUrl) { const u = f._lastUrl; f._lastUrl = ''; onBack(); if (Date.now() >= exitUntil) ensureGuard(true); try { f.contentWindow.location.replace(u); } catch (e) {} }
          return;
        }
        if (ok) { try { f._lastUrl = f.contentWindow.location.href; } catch (e) {} }
        wrap?.classList.toggle('blocked', !ok);
        if (ok) bridgeFrame(f);
        if (ok) { const sec = f.closest('.desk'); if (sec && sec.dataset.did !== desks[idx]?.id) frameSetHidden(f, true); } // opened or reloaded off-screen: park at once
        if (ok) { try { const id = f.closest('.win')?.dataset.win, w = W[id], t = (f.contentDocument.title || '').trim(); if (w && w.appId === 'link' && t && t !== w.title) { w.title = t.slice(0, 60); save(); applyLayout(deskOf(id)); renderDots(); } } catch (e) {} }
      });
    });
  }
  function bridgeFrame(f) {
    const id = f.closest('.win')?.dataset.win; if (!id) return;
    let win; try { win = f.contentWindow; } catch (e) { return; }
    try { if (LINKS && window.WizLinks?.guardFrame) window.WizLinks.guardFrame(win, (W[id] && (APP[W[id].appId]?.url || W[id].url)) || win.location.pathname, LINKS); } catch (e) {}
    try { if (W[id]) { const here = win.location.pathname + win.location.search; const want = APP[W[id].appId]?.url || '';
      // Remember only pages inside this app (never the placeholder "/" or where it redirects), or a frame
      // painted before its app was known would stick on the wrong page for good.
      const home = (want.split(/[?#]/)[0] || '').replace(/[^/]*$/, '');
      if (home && home !== '/' && here.startsWith(home)) { W[id].url = here; save(); } } } catch (e) {}
    try { win.document.addEventListener('pointerdown', () => { focusWin(id); armBack(); }, true); } catch (e) {}
    // A hosted app may keep its own history guard. During the exit window the shell owns Back:
    // any Back that lands on a frame entry keeps unwinding until Wizard OS really leaves.
    tameHistory(win);
    // A hosted app may push its own Back guard at boot (same URL) before the shell can tame it. Popping such an
    // entry is the user pressing Back: the shell takes that step and the app never sees it. Popping a real in-app
    // navigation (the URL changes) stays the app's own back step.
    try { win.__wosHref = win.location.href; } catch (e) {}
    try { win.addEventListener('popstate', e => {
      if (Date.now() < dropUntil) { e.stopImmediatePropagation(); ignorePop = 0; dropUntil = 0; return; } // the shell's guard drop landed here
      if (Date.now() < exitUntil) { e.stopImmediatePropagation(); history.back(); return; }
      // The app (or the shell on its behalf) stepped back through the app's own entry: the app's step.
      if (takeSelfPop(win)) { try { win.__wosHref = win.location.href; } catch (x) {} return; }
      let same = false; try { same = win.location.href === win.__wosHref; win.__wosHref = win.location.href; } catch (x) {}
      // The app keeps its own back step only when it is the focused window on the desk in view, nothing is
      // open over it, and the pop really changed its page. Anything else (an app on another desk, a boot-time
      // guard, a stray hash entry) is the user's Back for the shell, so a Back is never silently swallowed.
      const wid = f.closest('.win')?.dataset.win;
      const mine = !same && wid && desks[idx]?.focus === wid && desks[idx].wins.includes(wid) && !sheet && !menuFor && V.state === 'idle' && !document.querySelector('.peek.open, .ov.open') && !window.LiveMode?.card;
      if (mine) return;
      e.stopImmediatePropagation();
      guardOn = history.state?.wos === 'guard'; // the shell's own guard is still under the popped app entry
      onBack();
      if (Date.now() >= exitUntil) ensureGuard(true);
    }, true); } catch (e) {}
    try { bindWinPinch(win.document, id); } catch (e) {}
    armFrameBack(f, win);
    shareCutout();
    frameEdge(f); setTimeout(() => { if (f.isConnected) frameEdge(f); }, 800); // apps that paint their theme after boot
  }
  // Voice mode a framed app asks for: <meta name="wizard-os-voice" content="capture|auto">.
  function frameVoiceMode(id) {
    try { const m = winEl(id)?.querySelector('iframe')?.contentDocument?.querySelector('meta[name="wizard-os-voice"]'); const v = m?.content; return v === 'capture' || v === 'auto' ? v : ''; } catch (e) { return ''; }
  }
  function frameNav(id) { try { return winEl(id)?.querySelector('iframe')?.contentWindow?.navigation || null; } catch (e) { return null; } }
  function frameHref(id) { try { const l = winEl(id)?.querySelector('iframe')?.contentWindow?.location; return l ? l.pathname + l.search : ''; } catch (e) { return ''; } }

  // A Chats window: the one on this desk, else any desk's (and go there).
  function chatsWinAny() {
    let wid = desks[idx].wins.find(x => W[x].app === 'chats'); if (wid) return wid;
    const d = desks.findIndex(dd => dd.wins.some(x => W[x].app === 'chats')); if (d < 0) return '';
    goDesk(d, true); return desks[d].wins.find(x => W[x].app === 'chats');
  }
  /* Open a real thread: in a Chats window on this desk, else any Chats window, else a new one here. */
  function openWizardThread(id, opts = {}) {
    if (!id) return;
    let wid = desks[idx].wins.find(x => W[x].app === 'chats');
    if (!wid) { const d = desks.findIndex(dd => dd.wins.some(x => W[x].app === 'chats')); if (d >= 0) { wid = desks[d].wins.find(x => W[x].app === 'chats'); goDesk(d, true); } }
    if (!wid) { const w = openWin({ app: 'chats', thread: null }, opts); if (!w) return; wid = w.id; }
    focusWin(wid); openChat(wid, id);
  }

  /* ---------------- review (semantic zoom) ---------------- */
  const LEVELS = ['month', 'week', 'day', 'group', 'thread'];
  const LNAME = { month: 'Month', week: 'Week', day: 'Day', group: 'Focus', thread: 'Thread' };
  function renderReviewShell(i) {
    return `<div class="review" data-review="${i}">
      <div class="zoom-rail">${LEVELS.map(l => `<button class="lvl" data-rail="${l}">${LNAME[l]}</button>`).join('')}</div>
      <div class="crumb"></div>
      <div class="zstage"></div>
      <div class="pinch-hint ${store.get('pinched', 0) > 1 ? 'gone' : ''}">🤏 Pinch to zoom · tap to dive</div>
    </div>`;
  }
  function groupThreads(z) {
    const ts = byDay[z.day] || [];
    if (z.type === 'project') return ts.filter(t => t.p === z.key);
    if (z.type === 'person') return ts.filter(t => (t.people || []).includes(z.key));
    if (z.type === 'calls') return ts.filter(t => t.call);
    return ts;
  }
  function zs(o) { return esc(JSON.stringify(o)); }
  function renderLevel(z) {
    if (z.level === 'month') {
      const ts = threadsIn(allDays), active = allDays.filter(d => byDay[d]).length;
      return `<div class="summary"><div class="eyebrow"><span class="spark"></span>Month in review</div><h3>${fmtRange(allDays[0], allDays[allDays.length - 1])}</h3><p>${esc(S.month || '')}</p>
        <div class="stats"><span><b>${ts.length}</b>threads</span><span><b>${msgCount(ts).toLocaleString()}</b>messages</span><span><b>${active}</b>active days</span></div>${bars(ts)}</div>
        <div class="sec-title"><span>Weeks</span><span>pinch in</span></div><div class="zgrid">
        ${weeks.slice().reverse().map(w => { const wd = Array.from({ length: 7 }, (_, k) => addDays(w, k)).filter(d => d <= TODAY); const wt = threadsIn(wd);
          return `<button class="zcard ${wd.includes(TODAY) ? 'today' : ''}" data-z="${zs({ level: 'week', week: w })}"><div class="dow">Week of ${fmtDay(w).slice(4)}</div><div class="row"><span class="t">${fmtRange(w, wd[wd.length - 1])}</span><span class="c">${wt.length} threads</span></div><div class="s">${esc(S.weeks[w] || '')}</div>${bars(wt)}</button>`; }).join('')}
        </div>
        <div class="sec-title"><span>Projects this month</span></div><div class="chips">${projMix(ts).map(([p, v]) => `<span class="chip"><i class="pdot" style="color:${PCOL[p]};background:${PCOL[p]}"></i>${esc(D.projects[p])} · ${v.toLocaleString()}</span>`).join('')}</div>`;
    }
    if (z.level === 'week') {
      const wd = Array.from({ length: 7 }, (_, k) => addDays(z.week, k)); const shown = wd.filter(d => d <= TODAY); const ts = threadsIn(shown);
      return `<div class="summary"><div class="eyebrow"><span class="spark"></span>Week in review</div><h3>${fmtRange(z.week, wd[6])}</h3><p>${esc(S.weeks[z.week] || '')}</p>
        <div class="stats"><span><b>${ts.length}</b>threads</span><span><b>${msgCount(ts).toLocaleString()}</b>messages</span><span><b>${projMix(ts).length}</b>projects</span></div>${bars(ts)}</div>
        <div class="sec-title"><span>Days</span><span>pinch in</span></div><div class="zgrid">
        ${shown.slice().reverse().map(d => { const t = byDay[d] || [];
          return `<button class="zcard ${d === TODAY ? 'today' : ''} ${t.length ? '' : 'empty'}" data-z="${zs({ level: 'day', day: d })}"><div class="row"><span class="t">${fmtDay(d)}</span><span class="c">${t.length} threads</span></div><div class="s">${esc(S.days[d] || (t.length ? t.slice(0, 3).map(x => x.title).join(' · ') : 'Quiet day'))}</div>${t.length ? bars(t) : ''}</button>`; }).join('')}
        </div>`;
    }
    if (z.level === 'day') {
      const ts = byDay[z.day] || [], mix = projMix(ts);
      const people = {}; ts.forEach(t => (t.people || []).forEach(p => people[p] = (people[p] || 0) + 1));
      const calls = ts.filter(t => t.call);
      return `<div class="summary"><div class="eyebrow"><span class="spark"></span>${z.day === YESTERDAY ? 'Yesterday' : z.day === TODAY ? 'Today' : 'Day in review'}</div><h3>${fmtDayLong(z.day)}</h3><p>${esc(S.days[z.day] || (ts.length ? `${ts.length} threads.` : 'A quiet day. Nothing ran.'))}</p>
        <div class="stats"><span><b>${ts.length}</b>threads</span><span><b>${msgCount(ts).toLocaleString()}</b>messages</span><span><b>${mix.length}</b>projects</span></div>${ts.length ? bars(ts) : ''}</div>
        ${mix.length ? `<div class="sec-title"><span>Projects</span><span>pinch in</span></div><div class="zgrid two">${mix.map(([p]) => { const g = ts.filter(t => t.p === p);
          return `<button class="zcard" data-z="${zs({ level: 'group', day: z.day, type: 'project', key: p })}"><div class="row"><span class="t"><i class="pdot" style="color:${PCOL[p]};background:${PCOL[p]}"></i>${esc(D.projects[p])}</span></div><div class="big">${g.length}</div><div class="s">${esc(clip(g.map(x => x.title).join(' · '), 80))}</div></button>`; }).join('')}</div>` : ''}
        ${Object.keys(people).length ? `<div class="sec-title"><span>People</span></div><div class="zgrid">${Object.entries(people).map(([p, n]) =>
          `<button class="zcard" data-z="${zs({ level: 'group', day: z.day, type: 'person', key: p })}"><div class="row"><span class="t"><span class="ticon">◍</span> ${esc(p)}</span><span class="c">${n} thread${n > 1 ? 's' : ''}</span></div></button>`).join('')}</div>` : ''}
        ${calls.length ? `<div class="sec-title"><span>Calls &amp; meetings</span></div><div class="zgrid">${calls.map(t =>
          `<button class="zcard" data-z="${zs({ level: 'thread', day: z.day, id: t.id })}"><div class="row"><span class="t"><span class="ticon">☏</span> ${esc(t.title)}</span><span class="when">${esc(t.t)}</span></div></button>`).join('')}</div>` : ''}`;
    }
    if (z.level === 'group') {
      const ts = groupThreads(z).slice().sort((a, b) => a.t.localeCompare(b.t));
      const name = z.type === 'project' ? D.projects[z.key] : z.type === 'person' ? z.key : 'Calls';
      const top = ts.slice().sort((a, b) => b.n - a.n)[0];
      return `<div class="summary"><div class="eyebrow"><span class="spark" style="background:${PCOL[z.key] || 'var(--pink)'}"></span>${esc(fmtDay(z.day))} · ${z.type}</div><h3>${esc(name)}</h3>
        <p>${ts.length} thread${ts.length === 1 ? '' : 's'}, ${msgCount(ts)} messages.${top ? ` Most of the work went into “${esc(top.title)}”.` : ''}</p>
        <div class="stats"><span><b>${ts.length}</b>threads</span><span><b>${msgCount(ts)}</b>messages</span><span><b>${ts[0]?.t || '—'}</b>first</span></div></div>
        <div class="sec-title"><span>Threads</span><span>pinch in</span></div><div class="zgrid">${ts.map(t =>
          `<button class="zcard" data-z="${zs({ level: 'thread', day: z.day, id: t.id, from: { type: z.type, key: z.key } })}"><div class="row"><span class="when">${esc(t.t)}</span><span class="t">${esc(t.title)}</span><span class="c">${t.n}</span></div>${t.a ? `<div class="s">${esc(clip(t.a, 150))}</div>` : ''}</button>`).join('')}</div>`;
    }
    if (z.level === 'thread') {
      const t = byId[z.id] || {};
      return `<div class="summary"><div class="eyebrow"><span class="spark" style="background:${PCOL[t.p]}"></span>${esc(fmtDay(z.day))} · ${esc(t.t)} · ${esc(t.src)}</div><h3>${esc(t.title)}</h3>
        <div class="chips"><span class="chip"><i class="pdot" style="color:${PCOL[t.p]};background:${PCOL[t.p]}"></i>${esc(D.projects[t.p])}</span><span class="chip">${t.n} messages</span>${(t.people || []).map(p => `<span class="chip">${esc(p)}</span>`).join('')}</div></div>
        ${t.u ? `<div class="bubble u"><span class="who">You</span>${esc(t.u)}</div>` : ''}${t.a ? `<div class="bubble a"><span class="who">${window.WizConfig.agent()}</span>${esc(t.a)}</div>` : ''}
        <button class="cta" data-wizthread="${esc(z.id)}">Open the full thread in Wizard</button>`;
    }
    return '';
  }
  function parentOf(z) {
    if (z.level === 'thread') return z.from ? { level: 'group', day: z.day, type: z.from.type, key: z.from.key } : { level: 'day', day: z.day };
    if (z.level === 'group') return { level: 'day', day: z.day };
    if (z.level === 'day') return { level: 'week', week: weekOf(z.day) };
    if (z.level === 'week') return { level: 'month' };
    return null;
  }
  function chain(z) { const c = []; let x = z; while (x) { c.unshift(x); x = parentOf(x); } return c; }
  function crumbLabel(z) {
    if (z.level === 'month') return 'Month';
    if (z.level === 'week') return 'Wk ' + fmtDay(z.week).slice(4);
    if (z.level === 'day') return fmtDay(z.day).slice(0, 6).trim();
    if (z.level === 'group') return z.type === 'project' ? D.projects[z.key] : z.type === 'person' ? z.key : 'Calls';
    return 'Thread';
  }
  function mountReview(id, dir, origin) {
    const we = winEl(id), w = W[id]; const root = we?.querySelector('.review'); if (!root || !w) return;
    const z = w.z || { level: 'day', day: YESTERDAY };
    const stage = $('.zstage', root);
    const li = LEVELS.indexOf(z.level);
    $$('.lvl', root).forEach((b, k) => { b.classList.toggle('on', k === li); b.classList.toggle('past', k < li); });
    const chn = chain(z);
    const crumbEl = $('.crumb', root); crumbEl.innerHTML = chn.map((c, k) => `${k ? '<i>›</i>' : ''}<button data-crumb="${k}">${esc(crumbLabel(c))}</button>`).join(''); crumbEl.scrollLeft = crumbEl.scrollWidth;
    root._chain = chn;
    const layer = document.createElement('div');
    layer.className = 'zlayer'; layer.innerHTML = `<div class="desk-scroll">${renderLevel(z)}</div>`;
    const old = $$('.zlayer', stage);
    if (dir && old.length) {
      const o = origin || { x: stage.clientWidth / 2, y: stage.clientHeight / 3 };
      const ox = `${o.x}px ${o.y}px`;
      old.forEach(l => { l.style.transformOrigin = ox; l.classList.add(dir === 'in' ? 'leave-in' : 'leave-out'); setTimeout(() => l.remove(), 430); });
      layer.style.transformOrigin = ox; layer.classList.add(dir === 'in' ? 'enter-in' : 'enter-out');
    } else old.forEach(l => l.remove());
    stage.appendChild(layer);
    bindPinch(stage, id);
  }
  function setZ(id, z, dir, origin) {
    const w = W[id]; if (!w) return;
    // Back walks dives in reverse: zd counts how far below the opened level we are.
    if (dir === 'in') w.zd = (w.zd || 0) + 1; else if (dir === 'out') w.zd = Math.max(0, (w.zd || 0) - 1);
    w.z = z; save(); mountReview(id, dir, origin); applyLayout(deskOf(id));
    vib(dir === 'in' ? 10 : 6);
  }
  function zoomIn(id, card) {
    const stage = winEl(id)?.querySelector('.zstage'); if (!stage) return;
    card = card || stage.querySelector('.zlayer:last-child [data-z]');
    if (!card) return bounce(stage);
    const r = card.getBoundingClientRect(), s = stage.getBoundingClientRect();
    setZ(id, JSON.parse(card.dataset.z), 'in', { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 });
  }
  function zoomOut(id) {
    const w = W[id]; if (!w) return;
    const p = parentOf(w.z);
    if (!p) return bounce(winEl(id).querySelector('.zstage'));
    setZ(id, p, 'out');
  }
  function bounce(stage) { const l = stage?.querySelector('.zlayer:last-child'); if (!l) return; l.animate([{ transform: 'scale(1)' }, { transform: 'scale(.96)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' }); }

  function bindPinch(stage, id) {
    if (stage._pinch) return; stage._pinch = true;
    let p = null;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    stage.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const [a, b] = e.touches, mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
        const el = document.elementFromPoint(mid.x, mid.y);
        p = { d0: dist(a, b), s: 1, mid, card: el && el.closest('.zlayer:last-child [data-z]'), layer: stage.querySelector('.zlayer:last-child') };
        const r = stage.getBoundingClientRect(); p.layer.style.transformOrigin = `${mid.x - r.left}px ${mid.y - r.top}px`;
        p.layer.classList.add('pinching');
      }
    }, { passive: false });
    stage.addEventListener('touchmove', e => {
      if (!p || e.touches.length !== 2) return; e.preventDefault();
      p.s = dist(e.touches[0], e.touches[1]) / p.d0;
      const s = p.s > 1 ? 1 + (p.s - 1) * .5 : 1 - (1 - p.s) * .6;
      p.layer.style.transform = `scale(${s.toFixed(3)})`; p.layer.style.opacity = String(Math.max(.4, 1 - Math.abs(p.s - 1) * .7));
      if (p.card) p.card.classList.toggle('target', p.s > 1.08);
    }, { passive: false });
    const end = () => {
      if (!p) return; const q = p; p = null;
      q.layer.classList.remove('pinching');
      if (q.card) q.card.classList.remove('target');
      store.set('pinched', store.get('pinched', 0) + 1);
      if (q.s > 1.22) { q.layer.style.transform = ''; q.layer.style.opacity = ''; zoomIn(id, q.card); }
      else if (q.s < .82) { q.layer.style.transform = ''; q.layer.style.opacity = ''; zoomOut(id); }
      else { q.layer.animate([{ transform: q.layer.style.transform }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.2,.9,.25,1)' }); q.layer.style.transform = ''; q.layer.style.opacity = ''; }
      const h = stage.parentElement.querySelector('.pinch-hint'); if (h) h.classList.add('gone');
    };
    stage.addEventListener('touchend', e => { if (p && e.touches.length < 2) end(); });
    stage.addEventListener('touchcancel', end);
    let acc = 0, wt = 0;
    stage.addEventListener('wheel', e => {
      if (!e.ctrlKey) return; e.preventDefault(); acc += -e.deltaY;
      clearTimeout(wt); wt = setTimeout(() => {
        if (acc > 40) { const el = document.elementFromPoint(e.clientX, e.clientY); zoomIn(id, el && el.closest('.zlayer:last-child [data-z]')); }
        else if (acc < -40) zoomOut(id);
        acc = 0;
      }, 90);
    }, { passive: false });
  }

  /* ---------------- window interactions ---------------- */
  // Focus follows the finger. Double-tap a title bar toggles full screen.
  let lastBarTap = { id: '', t: 0 };
  track.addEventListener('pointerdown', e => {
    const we = e.target.closest('.win'); if (we) focusWin(we.dataset.win);
  }, true);
  track.addEventListener('click', e => {
    const say = e.target.closest('[data-say]'); if (say) return runUtterance(say.dataset.say, 'auto');
    const pick = e.target.closest('.new-desk [data-app]');
    if (pick) { const a = APP[pick.dataset.app]; if (a) { const r = store.get('recent', []).filter(x => x !== a.id); r.unshift(a.id); store.set('recent', r.slice(0, 8)); openApp(a); } return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'inbox') return openSheet('inbox');
    if (act === 'settings') return openSettings(false);
    if (act === 'unsent') return openSettings(true);
    if (act === 'yesterday') return openReview('day', YESTERDAY);
    if (act === 'unread' || act === 'working') return openChatsFiltered(act, { card: true });
    if (act === 'side-button') return sideButtonTap(false);
    if (act === 'system') return openApp(APP.system);
    if (act === 'side-button-hide') { store.set('sideHidden', true); return refreshHome(true); }
    const we = e.target.closest('.win'); if (!we) return;
    const id = we.dataset.win, w = W[id]; if (!w) return;
    const wa = e.target.closest('[data-wact]')?.dataset.wact;
    if (wa === 'close') return closeWin(id);
    if (wa === 'pin') return pinWin(id);
    if (wa === 'detach') return detachBound(id);
    if (wa === 'full') { const d = desks[deskOf(id)]; return setFull(id, !(d.full && d.focus === id)); }

    if (e.target.closest('.wbar')) {
      // Use the input timestamp, not handling time: a busy page (an app loading in
      // another tile) must not turn a quick double-tap into two single taps.
      const now = e.timeStamp || performance.now();
      if (lastBarTap.id === id && now - lastBarTap.t < 450) { lastBarTap = { id: '', t: 0 }; const d = desks[deskOf(id)]; return setFull(id, !(d.full && d.focus === id)); }
      lastBarTap = { id, t: now }; return;
    }
    if (w.app === 'review') {
      const zc = e.target.closest('[data-z]'); if (zc) return zoomIn(id, zc);
      const rail = e.target.closest('[data-rail]');
      if (rail) { const want = LEVELS.indexOf(rail.dataset.rail); const chn = $('.review', we)._chain; if (want < chn.length - 1) setZ(id, chn[want], 'out'); else if (want > chn.length - 1) zoomIn(id); return; }
      const cr = e.target.closest('[data-crumb]');
      if (cr) { const chn = $('.review', we)._chain; const k = +cr.dataset.crumb; if (k < chn.length - 1) setZ(id, chn[k], 'out'); return; }
      const wt = e.target.closest('[data-wizthread]'); if (wt) return openWizardThread(wt.dataset.wizthread);
    }
    if (w.app === 'chats' && CHATS.click(e, id)) return;
  });
  track.addEventListener('dblclick', e => {
    const bar = e.target.closest('.wbar'); if (!bar || e.target.closest('[data-wact]')) return;
    const id = bar.closest('.win')?.dataset.win; if (!id || lastBarTap.t === -1) return;
    const d = desks[deskOf(id)]; if (!d) return;
    // The click handler may already have toggled on the second tap; only act if it did not.
    if (!(d.full && d.focus === id) && performance.now() - fullAt > 600) setFull(id, true);
  });
  CHATS.bind(track);

  /* Window actions live in the title bar; desk arrangement lives in the overview. */
  const menuEl = $('#wmenu');
  let menuFor = null;
  function closeMenu() { menuFor = null; menuEl?.classList.remove('open'); }

  /* Pinch a window: spread to fill the screen, pinch in to tile it again.
   * Review windows keep their own pinch for Day → Week → Month. */
  function bindWinPinch(root, fixedId) {
    if (root._wpinch) return; root._wpinch = true;
    let p = null;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    root.addEventListener('touchstart', e => {
      if (e.touches.length !== 2) return;
      const t0 = e.touches[0].target, el = t0.closest ? t0 : t0.parentElement;
      if (!fixedId && el.closest('.zstage')) return;
      const id = fixedId || el.closest('.win')?.dataset.win;
      if (!id) { if (el.closest('.desk')) p = { id: null, d0: dist(e.touches[0], e.touches[1]), s: 1 }; return; }
      // A framed app that zooms its own content (maps, photos, PDFs) opts out of the shell's pinch with
      // <meta name="wizard-os-pinch" content="app">; Back and the bottom-edge swipe still leave full screen.
      if (fixedId && pinchClaimed(fixedId)) return;
      p = { id, d0: dist(e.touches[0], e.touches[1]), s: 1 };
    }, { passive: true, capture: true });
    root.addEventListener('touchmove', e => {
      if (!p || e.touches.length !== 2) return;
      // Two fingers on a window belong to the shell: keep a scrolling list from eating the pinch.
      if (e.cancelable) e.preventDefault();
      p.s = dist(e.touches[0], e.touches[1]) / p.d0;
      const we = p.id && winEl(p.id); if (we) we.style.setProperty('--pinch', String(Math.max(.9, Math.min(1.06, 1 + (p.s - 1) * .25))));
    }, { passive: false, capture: true });
    const end = () => {
      if (!p) return; const q = p; p = null;
      if (!q.id) { if (q.s < .75) openOverview(); return; }
      const we = winEl(q.id); if (we) we.style.removeProperty('--pinch');
      const d = desks[deskOf(q.id)]; if (!d) return;
      if (q.s > 1.25 && !(d.full && d.focus === q.id)) setFull(q.id, true);
      else if (q.s < (device.classList.contains('immersive') ? .72 : .8) && d.full) setFull(q.id, false);
      else if (q.s < .75 && !d.full) openOverview(); // already zoomed out to the desk: one more pinch shows every desk
    };
    root.addEventListener('touchend', e => { if (p && e.touches.length < 2) end(); }, { capture: true });
    root.addEventListener('touchcancel', end, { capture: true });
  }
  bindWinPinch(track);
  function pinchClaimed(id) { try { return winEl(id)?.querySelector('iframe')?.contentDocument?.querySelector('meta[name="wizard-os-pinch"]')?.content === 'app'; } catch (e) { return false; } }

  /* Bottom edge in immersive full screen: swipe up from anywhere along it to leave full screen.
   * The window follows the finger (shrinks a touch), past ~56 px or a quick flick it returns to tiles. */
  const immEdge = document.createElement('div'); immEdge.id = 'immEdge'; immEdge.className = 'imm-edge';
  immEdge.innerHTML = '<i></i>'; immEdge.setAttribute('aria-hidden', 'true'); device.appendChild(immEdge);
  // A click listener makes the strip a real tap target, so the browser's touch adjustment never snaps an
  // edge touch onto the composer just above it.
  immEdge.addEventListener('click', e => e.preventDefault());
  immEdge.addEventListener('touchmove', e => { if (IE && e.cancelable) e.preventDefault(); }, { passive: false });
  let IE = null;
  const immWin = () => { const d = desks[idx]; return d && d.full && d.focus ? winEl(d.focus) : null; };
  immEdge.addEventListener('pointerdown', e => {
    if (!device.classList.contains('immersive')) return;
    e.preventDefault(); try { immEdge.setPointerCapture(e.pointerId); } catch (_) {}
    IE = { y: e.clientY, x: e.clientX, t: performance.now(), id: e.pointerId, dy: 0 };
  });
  immEdge.addEventListener('pointermove', e => {
    if (!IE || e.pointerId !== IE.id) return;
    IE.dy = Math.min(0, e.clientY - IE.y);
    const p = Math.min(1, -IE.dy / 160), we = immWin();
    if (we) { we.style.transition = 'none'; we.style.transform = `translateY(${IE.dy * .35}px) scale(${1 - p * .08})`; we.style.borderRadius = `${p * 22}px`; }
    immEdge.classList.toggle('pull', -IE.dy > 12);
  });
  const immEnd = e => {
    if (!IE || e.pointerId !== IE.id) return; const s = IE; IE = null;
    immEdge.classList.remove('pull');
    const we = immWin(); if (we) { we.style.transition = ''; we.style.transform = ''; we.style.borderRadius = ''; }
    const v = s.dy / ((performance.now() - s.t) || 1);
    if (e.type !== 'pointercancel' && (s.dy < -56 || (s.dy < -18 && v < -.45))) { const d = desks[idx]; if (d.full && d.focus) setFull(d.focus, false); }
  };
  immEdge.addEventListener('pointerup', immEnd); immEdge.addEventListener('pointercancel', immEnd);
  // The keyboard is up: the bottom edge belongs to the text field, not the shell.
  setInterval(() => {
    if (!immOn) return;
    let a = document.activeElement;
    try { if (a && a.tagName === 'IFRAME') a = a.contentDocument?.activeElement; } catch (e) {}
    device.classList.toggle('imm-typing', !!a && (/^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName) || a.isContentEditable));
  }, 400);

  /* ---------------- sheets ---------------- */
  const launcher = $('#launcher'), inboxEl = $('#inbox'), settingsEl = $('#settings');
  let sheet = null;
  const sheetOpen = () => !!sheet;
  function openSheet(which, q) {
    closeSheets(true); closeMenu();
    sheet = which; device.classList.add('sheet-open'); tourEv('sheet', { which });
    window.WosResources?.back(); window.WosResources?.sync();
    if (which === 'launcher') { renderLauncher(q || ''); launcher.classList.add('open'); const s = $('#search'); s.value = q || ''; }
    else if (which === 'settings') { renderSettings(); settingsEl.classList.add('open'); $('#settingsBody').scrollTop = 0; }
    else { renderInbox(); inboxEl.classList.add('open'); }
    [launcher, inboxEl, settingsEl].forEach(el => { el.style.transform = ''; el.style.opacity = ''; });
    window.WosScenery?.update(); // scenery hook: a sheet over Home freezes the background
    vib(6);
  }
  function closeSheets(quiet) {
    if (!sheet && quiet) return;
    const was = sheet; sheet = null; if (was) tourEv('sheet-closed', { which: was }); device.classList.remove('sheet-open');
    launcher.classList.remove('open'); inboxEl.classList.remove('open'); settingsEl.classList.remove('open');
    [launcher, inboxEl, settingsEl].forEach(el => { el.style.transform = ''; el.style.opacity = ''; });
    $('#search').blur();
    window.WosResources?.sync();
    window.WosScenery?.update(); // scenery hook: sheet closed, Home may animate again
  }
  $('#scrim').addEventListener('click', () => closeSheets());
  settingsEl.addEventListener('click', e => {
    if (e.target.closest('[data-stclose]')) return closeSheets();
    { const sk = e.target.closest('[data-skinpick]'); if (sk) return pickSkin(sk.dataset.skinpick); }
    if (window.WosCancelled?.act(e.target)) return;
    if (window.WosSelMenu?.act(e.target)) return;
    const ub = e.target.closest('[data-ub]'); if (ub) { const r = ub.closest('[data-ubid]'); return unsentAction(r.dataset.ubid, r.dataset.uborigin, ub.dataset.ub); }
    if (e.target.closest('[data-ub-all]')) { OUTBOX?.retryAll(); try { NATIVE() && window.WizardOSNative.retryUnsent && window.WizardOSNative.retryUnsent('*'); } catch (x) {} toast('↻', 'Sending everything again', 1600); return setTimeout(onUnsentChange, 300); }
    const st = e.target.closest('[data-st]')?.dataset.st;
    if (st === 'typing' && NATIVE() && window.WizardOSNative.voiceTypingSettings) { window.WizardOSNative.voiceTypingSettings(); return; }
    if (st === 'everywhere' && NATIVE() && typeof window.WizardOSNative.setEverywhere === 'function') { let on = false; try { on = JSON.parse(window.WizardOSNative.everywhere()).enabled; } catch (x) {} window.WizardOSNative.setEverywhere(!on); setTimeout(renderSettings, 250); vib(8); }
    if (st === 'side') { closeSheets(true); sideButtonTap(true); }
    if (st === 'files') return openFilesScreen();
    if (st === 'help') { closeSheets(true); return window.WosTour?.openHelp(); }
    if (e.target.closest('[data-usage-refresh]')) { window.WosUsage?.load(true).then(paintUsage); paintUsage(); }
  });

  function appTile(a) { return `<button class="lapp" data-app="${a.id}" style="--i:${tileN++}">${ico('span', 'ic', a, a.kind === 'native' ? '<span class="badge">APK</span>' : '')}<span class="nm">${esc(a.name)}</span></button>`; }
  function appRow(a, sel) { const k = a.kind === 'view' ? 'view' : a.kind === 'native' ? 'native' : 'app'; return `<button class="lrow ${sel ? 'sel' : ''}" data-app="${a.id}">${ico('span', 'ic', a)}<span class="nm">${esc(a.name)}<small>${esc(a.desc)}</small></span><span class="kind ${k}">${k === 'native' ? 'Android' : k === 'view' ? 'View' : 'Wizard'}</span></button>`; }
  // live: a background refresh (sessions poll, app list). It repaints only when the content changed and never
  // moves the scroll, so an open Apps sheet stays still instead of redrawing every 15 s (James, 10 Oct).
  function renderLauncher(q, live) {
    const body = $('#launcherBody');
    q = q.trim(); tileN = 0;
    const paint = html => {
      if (live && body.__lhtml === html) return;
      const top = body.scrollTop; body.innerHTML = html; body.__lhtml = html;
      body.scrollTop = live ? top : body.scrollHeight;
    };
    if (!q) {
      const recentIds = store.get('recent', ['wizard', 'wizard-signal', 'wisdom', 'shopping']).filter(id => APP[id] && APP[id].kind !== 'native').slice(0, 4);
      paint(`<div class="lgroup"><h4>Recent</h4><div class="lgrid">${recentIds.map(id => appTile(APP[id])).join('')}</div></div>
        <div class="lgroup"><h4>Views <span>zoomable</span></h4><div class="lgrid">${APPS.filter(a => a.kind === 'view').map(appTile).join('')}</div></div>
        <div class="lgroup"><h4>Wizard apps <span>${APPS.filter(a => !['app-store', 'system'].includes(a.id) && (a.kind === 'wizard' || a.kind === 'chats' || a.kind === 'usuals')).length}</span></h4><div class="lgrid">${APPS.filter(a => !['app-store', 'system'].includes(a.id) && (a.kind === 'wizard' || a.kind === 'chats' || a.kind === 'usuals')).map(appTile).join('')}<button class="lapp" data-app="app-store"><span class="ic">+</span><span class="nm">Get apps</span></button></div></div>`); // preserve current tiles/order; Get apps opens a normal app frame
      return;
    }
    const n = norm(q);
    // Android apps stay voice-only ("open Maps" still routes); they never clutter the launcher.
    const hits = APPS.filter(a => a.kind !== 'native').map(a => { const nm = norm(a.name), ds = norm(a.desc); const s = nm.startsWith(n) ? 3 : nm.includes(n) ? 2 : ds.includes(n) ? 1 : 0; return [s, a]; }).filter(x => x[0]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    const th = (LIVE.ok ? LIVE.sessions.filter(x => !x.hidden && norm(x.title).includes(n)) : []).slice(0, 5);
    // Bottom-anchored like the rest of the sheet: the best app match sits right above the search bar, so it stays
    // in sight when the keyboard shrinks the sheet (James, 11 Oct: "searched wisdom and it didn't pop up").
    const top = hits.slice(0, 7);
    paint(`<div class="lgroup"><h4>Command</h4><button class="lrow ${hits.length ? '' : 'sel'}" data-cmd="${esc(q)}">${sig('ic', 'bolt', '#0AD3E3', '⚡')}<span class="nm">“${esc(q)}”<small>Run through the fast router</small></span><span class="kind cmd">Run</span></button></div>
      ${searchUrl(q) ? (() => { const qs = quickSearch(q) || { query: q, tab: 'all' }; return `<div class="lgroup"><h4>Search</h4><button class="lrow" data-qsearch="${esc(qs.query)}" data-qtab="all">${sig('ic', 'search', '#81B7FF', '⌕')}<span class="nm">“${esc(qs.query)}”<small>Search with an AI overview</small></span><span class="kind view">Web</span></button><button class="lrow" data-qsearch="${esc(qs.query)}" data-qtab="images">${sig('ic', 'image', '#EF90FE', '▦')}<span class="nm">“${esc(qs.query)}”<small>Image search</small></span><span class="kind view">Images</span></button></div>`; })() : ''}
      ${th.length ? `<div class="lgroup"><h4>Threads</h4>${th.map(t => `<button class="lrow" data-thread="${esc(t.id)}"><span class="ic emo">${emoOf(t.id)}</span><span class="nm">${esc(t.title)}<small>${esc(ago(t.lastAssistantAt || t.updatedAt))}${LIVE.isNew(t) ? ' · unread' : ''}</small></span><span class="kind view">Chats</span></button>`).join('')}</div>` : ''}
      ${top.length ? `<div class="lgroup"><h4>Apps &amp; views</h4>${top.slice().reverse().map(a => appRow(a, a === top[0])).join('')}</div>` : ''}`);
  }
  // This desk's windows sit right above the search bar, nearest the thumb.
  function deskBar() {
    const d = desks[idx]; if (!d.wins.length) return '';
    const rows = d.wins.map(id => { const w = W[id], a = winApp(w), full = d.full && d.focus === id;
      return `<div class="dwin${id === d.focus ? ' on' : ''}">${ico('span', 'ic', a)}<span class="nm">${esc(winTitle(w))}</span>
        <span class="acts"><button data-dw="full" data-id="${id}">${full ? 'Tile' : 'Full'}</button>${idx > 0 ? `<button data-dw="left" data-id="${id}" aria-label="Move to desk ${idx}">←</button>` : ''}${idx < desks.length - 1 ? `<button data-dw="right" data-id="${id}" aria-label="Move to desk ${idx + 2}">→</button>` : ''}<button data-dw="close" data-id="${id}" aria-label="Close">✕</button></span></div>`; }).join('');
    return `<div class="deskbar"><div class="dh"><b>${esc(deskName(idx))}</b><span>${d.wins.length} window${d.wins.length === 1 ? '' : 's'}</span></div>${rows}</div>`;
  }
  $('#search').addEventListener('input', e => renderLauncher(e.target.value));
  $('#searchForm').addEventListener('submit', e => {
    e.preventDefault(); const q = $('#search').value.trim(); if (!q) return;
    const sel = $('#launcherBody .lrow.sel');
    if (sel?.dataset.app) { launch(APP[sel.dataset.app]); return; }
    closeSheets(); runUtterance(q, 'command', true);
  });
  function launch(a) {
    if (!a) return;
    const r = store.get('recent', []).filter(x => x !== a.id); r.unshift(a.id); store.set('recent', r.slice(0, 8));
    closeSheets(); setTimeout(() => openApp(a), 120);
  }
  launcher.addEventListener('click', e => {
    const a = e.target.closest('[data-app]'); if (a) return launch(APP[a.dataset.app]);
    const t = e.target.closest('[data-thread]'); if (t) { closeSheets(); return openWizardThread(t.dataset.thread); }
    const dw = e.target.closest('[data-dw]');
    if (dw) {
      const id = dw.dataset.id, k = dw.dataset.dw, i = deskOf(id);
      if (k === 'close') { closeWin(id); renderLauncher(''); return; }
      closeSheets();
      if (k === 'full') { const d = desks[i]; setFull(id, !(d.full && d.focus === id)); }
      else if (k === 'left') moveWin(id, i - 1); else if (k === 'right') moveWin(id, i + 1);
      return;
    }
    const qs = e.target.closest('[data-qsearch]'); if (qs) { openSearch(qs.dataset.qsearch, qs.dataset.qtab); return; }
    const c = e.target.closest('[data-cmd]'); if (c) { closeSheets(); runUtterance(c.dataset.cmd, 'command', true); }
  });

  // Mizel.ai recordings: the bridge opens one "🎙 …" thread per recording; they live in the shade as their own source.
  const isRec = n => /^\s*\u{1F399}/u.test(n?.title || '');
  const REC_WORKING = new Set(['submitting', 'queued', 'running', 'stopping']);
  function recState(s) { if (REC_WORKING.has(s.status)) return { k: 'run', g: '⏳', t: 'Follow-ups running' };
    if (/\u2705/u.test(s.preview || '')) return { k: 'done', g: '✅', t: 'Ready for review' };
    if (s.status === 'failed' || s.status === 'interrupted') return { k: 'fail', g: '⚠', t: 'Needs a look' };
    return { k: 'sum', g: '◦', t: 'Summary ready' }; }
  function recStripHtml() {
    const rows = (LIVE?.sessions || []).filter(x => isRec(x) && !x.archived && !x.hidden)
      .sort((p, q) => (Date.parse(q.activityAt || q.updatedAt) || 0) - (Date.parse(p.activityAt || p.updatedAt) || 0)).slice(0, 10);
    const items = rows.map(r => { const st = recState(r); const t = r.title.replace(/^\s*\u{1F399}\uFE0F?\s*/u, '');
      return `<button class="rec-row ${st.k}${LIVE.isNew(r) ? ' new' : ''}" data-rec="${esc(r.id)}" title="${esc(st.t)}"><span class="rt">${esc(ago(r.activityAt || r.updatedAt))}</span><span class="rn">${esc(t)}</span><span class="rs" aria-label="${esc(st.t)}">${st.g}</span></button>`; }).join('');
    return `<div class="rec-h"><b>◉ Recordings</b><span>${rows.length ? rows.length + ' latest' : ''}</span></div><div class="rec-list">${items || '<div class="rec-empty">New recordings land here and in the shade.</div>'}</div>`;
  }
  function refreshRecStrips() { const h = recStripHtml(); document.querySelectorAll('.rec-strip').forEach(el => { if (el.innerHTML !== h) el.innerHTML = h; }); }
  document.addEventListener('click', e => { const r = e.target.closest('[data-rec]'); if (!r) return; e.stopPropagation(); vib(6); openWizardThread(r.dataset.rec); }, true);

  const GROUPS = [
    { g: 'working', name: 'Working', c: 'var(--violet-2)' },
    { g: 'ready', name: 'Unread', c: 'var(--green)' },
    { g: 'needs', name: 'Needs you', c: 'var(--amber)' },
  ];
  function noteHtml(n, g) {
    const sub = g === 'working' ? (n.status === 'queued' ? 'Queued' : `${window.WizConfig.agent()} is on it`) : g === 'needs' ? (n.status === 'waiting_for_approval' ? 'Waiting for your approval' : n.status === 'failed' || n.status === 'interrupted' ? 'Stopped · needs a look' : 'Needs you') : (n.preview || '');
    return `<button class="note ${g === 'working' ? 'working' : ''}" data-note="${esc(n.id)}" data-g="${g}">${isRec(n) ? '<span class="ic rec">◉</span>' : `<span class="ic emo">${emoOf(n.id)}</span>`}
      <span class="bd"><span class="tp"><span class="src${isRec(n) ? ' mizel' : ''}">${isRec(n) ? 'Mizel.ai' : 'Chats'}</span><span class="tm">${esc(ago(g === 'working' ? (n.lastUserAt || n.updatedAt) : (n.lastAssistantAt || n.activityAt || n.updatedAt)))}</span></span><span class="ti">${esc(n.title)}</span><span class="sb">${esc(clip(sub, 120))}</span></span></button>`;
  }
  function renderInbox() {
    const L = live();
    let html = '<div class="push"></div>';
    if (!LIVE.ok) html += `<div class="ibx-empty">${LIVE.error === 'access' ? 'Wizard needs you to sign in. Open Wizard once, then come back.' : 'Connecting to Wizard…'}</div>`;
    // Most urgent sits lowest: closest to the thumb and the orb.
    for (const G of GROUPS) {
      const items = L[G.g]; if (!items.length) continue;
      html += `<div class="ibx-h" style="--c:${G.c}"><h4><i></i>${G.name}</h4><span>${items.length}${G.g === 'ready' && items.length > 1 ? ' · <button class="ibx-all" data-allread>Mark all read</button>' : ''}</span></div>` + items.slice(0, 40).map(n => noteHtml(n, G.g)).join('');
    }
    // Unsent sits lowest of all: it is the one thing that can be lost if nobody looks.
    const un = unsentAll();
    if (un.length) html += `<div class="ibx-h" style="--c:var(--amber)"><h4><i></i>Unsent</h4><span>${un.length}${un.length > 1 ? ' · <button class="ibx-all" data-ub-all="retry">Retry all</button>' : ''}</span></div>` + un.map(unsentRow).join('');
    if (LIVE.ok && !un.length && !L.needs.length && !L.ready.length && !L.working.length) html += `<div class="ibx-empty"><b>All clear.</b> Nothing unread, nothing running.</div>`;
    html += `<div class="sec-title" style="justify-content:center;margin:10px 0 4px"><span>Tap to open · swipe right to mark read</span></div>`;
    $('#inboxBody').innerHTML = html;
    const b = $('#inboxBody'); b.scrollTop = b.scrollHeight;
  }
  // tap opens the real thread, swipe right marks it read everywhere
  let ns = null;
  inboxEl.addEventListener('pointerdown', e => { const el = e.target.closest('.note'); if (el) ns = { el, x: e.clientX, y: e.clientY, dx: 0 }; });
  inboxEl.addEventListener('pointermove', e => { if (!ns) return; ns.dx = e.clientX - ns.x; if (Math.abs(e.clientY - ns.y) > 20 && Math.abs(ns.dx) < 20) { ns.el.style.transform = ''; ns = null; return; } if (ns.dx > 0) ns.el.style.transform = `translateX(${ns.dx}px)`; });
  inboxEl.addEventListener('pointerup', () => {
    if (!ns) return; const { el, dx } = ns; ns = null;
    const id = el.dataset.note, g = el.dataset.g;
    if (dx > 90 && g !== 'working') { el.classList.add('gone'); vib(8); setTimeout(() => { LIVE.markSeen(id); toast('✓', 'Marked read'); }, 200); return; }
    el.style.transform = '';
    if (Math.abs(dx) < 8) { closeSheets(true); openWizardThread(id); }
  });
  inboxEl.addEventListener('pointercancel', () => { if (ns) ns.el.style.transform = ''; ns = null; });
  inboxEl.addEventListener('click', e => {
    if (e.target.closest('[data-allread]')) { LIVE.markSeen(live().ready.map(s => s.id)); vib(8); toast('✓', 'All marked read'); return; }
    const ub = e.target.closest('[data-ub]'); if (ub) { const r = ub.closest('[data-ubid]'); return unsentAction(r.dataset.ubid, r.dataset.uborigin, ub.dataset.ub); }
    if (e.target.closest('[data-ub-all]')) { OUTBOX?.retryAll(); try { NATIVE() && window.WizardOSNative.retryUnsent && window.WizardOSNative.retryUnsent('*'); } catch (x) {} toast('↻', 'Sending everything again', 1600); setTimeout(onUnsentChange, 300); }
  });

  // Moons orbit the orb: one per running agent (violet) or thread that needs you (amber).
  function renderMoons() {
    const L = live();
    const m = [...L.needs.map(() => 'var(--amber)'), ...L.working.map(() => 'var(--violet-2)'), ...L.ready.map(() => 'var(--green)')].slice(0, 8);
    $('#moons').innerHTML = m.map((c, k) => { const a = (k / Math.max(m.length, 1)) * Math.PI * 2 - Math.PI / 2, r = Math.round(($('#orbWrap').offsetWidth || 44) / 2 + 8);
      return `<i style="--c:${c};transform:translate(${(Math.cos(a) * r).toFixed(1)}px,${(Math.sin(a) * r).toFixed(1)}px)"></i>`; }).join('');
    const badge = L.needs.length + L.ready.length;
    $('#orbBadge').textContent = badge > 99 ? '99+' : String(badge || '');
    $('#orbBadge').hidden = !badge;
  }
  // One place reacts to live changes: reads anywhere, new replies, finished runs.
  if (LIVE) LIVE.onChange(() => {
    renderMoons(); refreshHome(); markVisibleThreadsSeen(); refreshRecStrips();
    if (sheet === 'inbox') renderInbox(); if (sheet === 'launcher') renderLauncher($('#search').value, true);
    for (const id of Object.keys(W)) {
      const w = W[id]; if (w.app !== 'chats') continue;
      const el = track.querySelector(`[data-chats="${id}"]`); if (!el) continue;
      if (!w.thread) { if (!el.contains(document.activeElement) && !CHATS.holdList(id)) renderChatList(w, el); }
      else loadThread(w);
    }
    desks.forEach((_, i) => applyLayout(i));
  });
  // Open threads poll a little faster than the session list while Archimedes works.
  setInterval(() => {
    if (document.hidden) return;
    for (const id of desks[idx].wins) { const w = W[id]; if (w?.app === 'chats' && w.thread && w.thread !== '__new__') loadThread(w); }
  }, 4000);

  /* ---------------- toast ---------------- */
  let toastT = 0;
  function toast(icon, text, ms = 2200) {
    const t = $('#toast'); t.innerHTML = `<span class="ti">${icon}</span><span>${text}</span>`; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ---------------- voice ---------------- */
  const V = { state: 'idle', kind: 'auto', route: store.get('routeV', 0) >= 2 ? store.get('route', 'auto') : (store.set('routeV', 2), store.set('route', 'auto'), 'auto'), rec: null, stream: null, chunks: [], parts: [], ac: null, an: null, t0: 0, acc: 0, raf: 0, sim: false, stopAsked: false, cancelled: false, simText: '' };
  const voiceEl = $('#voice'), tx = $('#transcript');
  // Keep the screen on while the orb records or transcribes: a screen lock mid-dictation pauses the WebView and loses the take.
  // Native shell (0.5.1+) sets FLAG_KEEP_SCREEN_ON; browsers and PWAs use the Screen Wake Lock API.
  const AWAKE = { want: false, lock: null };
  function keepAwake(on) {
    on = !!on;
    if (AWAKE.want === on) return;
    AWAKE.want = on;
    try { if (window.WizardOSNative && typeof window.WizardOSNative.keepAwake === 'function') { window.WizardOSNative.keepAwake(on); return; } } catch (e) {}
    if (on) requestWakeLock();
    else { const l = AWAKE.lock; AWAKE.lock = null; try { l && l.release(); } catch (e) {} }
  }
  async function requestWakeLock() {
    if (!AWAKE.want || AWAKE.lock || document.hidden || !navigator.wakeLock) return;
    try {
      const l = await navigator.wakeLock.request('screen');
      if (!AWAKE.want) { l.release(); return; }
      AWAKE.lock = l; l.addEventListener('release', () => { if (AWAKE.lock === l) AWAKE.lock = null; });
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestWakeLock(); });
  window.__wosAwake = () => AWAKE.want; // QA probe
  // Native shell (0.7.0, native parity): the orb records in Android's foreground-service recorder
  // (WizardOSDevice), so a take keeps going with the screen off or the app in the background, and
  // survives an app kill on disk. Browsers/PWAs and older shells keep the in-page MediaRecorder.
  // When James leaves the app mid-take, the floating orb (Everywhere) shows and drives this same take
  // through __wosVoiceCmd below; it never starts a second recorder.
  const DEV = () => { const d = window.WizardOSDevice; return d && typeof d.recStart === 'function' ? d : null; };
  function nativeBlob(id) {
    const dev = DEV(), parts = []; let off = 0;
    for (let k = 0; k < 4000 && off >= 0; k++) {
      let c = null; try { c = JSON.parse(dev.recRead(id, off)); } catch (e) {}
      if (!c) break;
      const bin = atob(c.b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      parts.push(u); off = c.next;
    }
    return new Blob(parts, { type: 'audio/aac' });
  }
  /* Stop (or claim an already-stopped) native take and hand its audio to the normal pipeline. */
  function nativeFinish(id, stopped) {
    // Notification/Everywhere Send enters here directly, bypassing finishVoice. Seal the model before claiming
    // audio or awaiting STT. A recreated page restores the last route saved for this native take.
    const hadSnap = !!V.snap;
    const snap = V.snap || sendSnap();
    try {
      if (!snap.route) {
        const pin = V.replyTo || (snap.view?.thread ? { wid: snap.view.id, sid: snap.view.thread } : null);
        snap.route = (!hadSnap && window.WosModels.voiceRoute(id)) || CHATS.modelRoute(pin?.wid, pin?.sid || '');
      }
      if (!snap.route?.model || !snap.route?.provider) throw new Error('Choose a model before sending');
      saveVoiceRoute(id, snap.route); V.snap = snap;
    } catch (e) {
      // The native file remains on disk; no claim, transcription or inference happens on an uncertain route.
      V.native = null; dropHold(); unseal(); setVoice('idle'); txHide();
      toast('!', 'Recording saved · ' + String(e.message || e), 3200); return;
    }
    const dev = DEV(); let meta = null;
    try { meta = JSON.parse(stopped ? dev.recClaim(id) : dev.recStop(id)); } catch (e) {}
    V.native = null;
    if (!meta) { dropHold(); unseal(); setVoice('idle'); txHide(); toast('◌', 'That recording was lost'); return; }
    V.acc = Math.max(V.acc, Number(meta.ms) || 0);
    onRecStop(nativeBlob(id), id);
  }
  const recDone = id => { try { id && DEV()?.recDone(id); if (id) window.WosModels.forgetVoiceRoute(id); } catch (e) {} };
  /* The page was reloaded or recreated while the native take kept going: pick the orb back up. */
  function nativeResume(a) {
    if (V.state !== 'idle' || !a?.id) return false;
    Object.assign(V, { native: a.id, kind: a.kind === 'command' ? 'command' : 'auto', target: null, snap: null, seal: null, replyTo: replyTake(a.id), chunks: [], acc: Number(a.ms) || 0, t0: performance.now(), sim: false, stopAsked: false, cancelled: false, an: null, files: [], pickPaused: false });
    renderVoiceFiles();
    setVoice(a.paused ? 'paused' : 'listen');
    txPill('✦', 'Still recording · tap orb to send', 'agent'); txHide(2600);
    V.raf = requestAnimationFrame(tick);
    return true;
  }
  // Tell the native shell what the orb is doing, so leaving Wizard OS mid-recording shows the floating orb
  // (timer, Pause, Cancel, tap to send). Never auto-sends: going quiet only ever pauses nothing.
  function voiceElapsed() { return Math.round((V.acc || 0) + (V.state === 'listen' || V.state === 'command' ? performance.now() - (V.t0 || performance.now()) : 0)); }
  function reportVoice(s) {
    try { const n = window.WizardOSNative; if (n && typeof n.appVoice === 'function') n.appVoice(s, voiceElapsed()); } catch (e) {}
  }
  // The floating orb's controls while Wizard OS is in the background.
  window.__wosVoiceCmd = cmd => {
    if (V.state !== 'listen' && V.state !== 'paused' && V.state !== 'command') return false;
    if (cmd === 'send') finishVoice();
    else if (cmd === 'cancel') cancelVoice();
    else if (cmd === 'pause') $('#arcPause').click();
    return true;
  };
  let NOMIC = false;
  function setVoice(s) {
    V.state = s; device.dataset.voice = s; tourEv('voice', { state: s });
    CHATS.PW?.paintMic((s === 'listen' || s === 'paused') && !!V.replyTo, V.replyTo?.sid || '');
    reportVoice(s);
    keepAwake(s === 'listen' || s === 'paused' || s === 'command' || s === 'think');
    Orb.setMode({ idle: 'idle', listen: 'listen', command: 'command', paused: 'paused', think: 'think', done: 'done', agent: 'agent' }[s] || 'idle');
    voiceEl.classList.toggle('on', s === 'listen' || s === 'paused');
    voiceEl.classList.toggle('cmd', s === 'command' || (V.kind === 'command' && s !== 'idle'));
    voiceEl.setAttribute('aria-hidden', String(s === 'idle'));
  }
  // The Auto/Agent toggle is gone: the router always decides (commands run, the rest goes to Archimedes).
  V.route = 'auto';
  // Third arc button: attach a photo or file to this take. It rides along with what you say.
  V.files = [];
  const voicePicker = Object.assign(document.createElement('input'), { type: 'file', multiple: true, hidden: true });
  document.body.appendChild(voicePicker);
  function renderVoiceFiles() {
    const n = V.files.length, b = $('#arcAttach');
    b.classList.toggle('has', n > 0); b.classList.toggle('busy', V.files.some(f => f.uploading));
    $('#attachCount').textContent = n ? String(n) : '';
    $('#attachLabel').textContent = V.files.some(f => f.uploading) ? 'Uploading' : n ? (n === 1 ? '1 file' : `${n} files`) : 'Attach';
  }
  voicePicker.addEventListener('change', async () => {
    const list = [...voicePicker.files]; voicePicker.value = '';
    for (const file of list) {
      if (V.state === 'idle') break;
      if (V.files.length >= 8) { toast('!', 'Up to 8 files per message', 2400); break; }
      const f = { name: file.name, mime: file.type, bytes: file.size, uploading: true };
      V.files.push(f); renderVoiceFiles();
      try { Object.assign(f, await CHATS.uploadFile(file), { uploading: false }); }
      catch (e) { V.files = V.files.filter(x => x !== f); toast('!', e.user ? e.message : 'Upload failed · not attached', 3200); }
      renderVoiceFiles();
    }
  });
  // Files that finished uploading, in the shape the outbox sends as wizard_file_ids.
  const takeFiles = () => V.files.filter(f => f.id && !f.uploading).map(f => ({ id: f.id, name: f.name, mime: f.mime, bytes: f.bytes }));
  function txShow(text, label, cls, icon) {
    tx.className = 'transcript ' + (cls || '');
    $('#txRouteIcon').textContent = icon || '✦';
    $('#txRouteText').innerHTML = label || '';
    $('#txText').textContent = text || '';
    $('#txChips').innerHTML = '';
    voiceEl.classList.add('tx');
  }
  // After the orb is tapped to send, the card shrinks to a one-line pill above the orb
  // ("Sending…" → "Sent to Archimedes") and fades. The words James said never cover the screen;
  // they are already in the thread. Timing/router detail rides in data-detail for diagnostics.
  function txPill(icon, label, cls, detail) {
    tx.className = 'transcript brief ' + (cls || '');
    $('#txRouteIcon').textContent = icon || '✦';
    $('#txRouteText').textContent = label || '';
    tx.dataset.detail = detail || '';
    $('#txChips').innerHTML = '';
    voiceEl.classList.add('tx');
  }
  const isPill = () => tx.classList.contains('brief');
  let txHideT = 0;
  // Once the card has faded, drop its choice chips too: a hidden card with chips kept the × "on" and made
  // the next Back silently clear an invisible card instead of navigating.
  function txHide(ms) {
    clearTimeout(txHideT);
    txHideT = setTimeout(() => {
      voiceEl.classList.remove('tx');
      txHideT = setTimeout(() => { if (!voiceEl.classList.contains('tx') && $('#txChips').childElementCount) { $('#txChips').innerHTML = ''; V.holdText = ''; V.holdOpts = null; } }, 320);
    }, ms || 0);
  }
  const fmtT = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function tick() {
    const el = V.acc + (V.state === 'listen' || V.state === 'command' ? performance.now() - V.t0 : 0);
    $('#timer').textContent = fmtT(el);
    if (V.an) {
      const a = new Uint8Array(V.an.fftSize); V.an.getByteTimeDomainData(a);
      let s = 0; for (let k = 0; k < a.length; k++) { const v = (a[k] - 128) / 128; s += v * v; }
      Orb.setLevel(V.state === 'paused' ? 0 : Math.min(1, Math.sqrt(s / a.length) * 4.2));
    } else if (V.native) {
      if (performance.now() - (V.lvlAt || 0) > 90) { V.lvlAt = performance.now(); try { V.lvl = DEV().recLevel() / 100; } catch (e) {} }
      Orb.setLevel(V.state === 'paused' ? 0 : Math.min(1, (V.lvl || 0) * 1.6));
    } else if (V.sim) Orb.setLevel(V.state === 'paused' ? 0 : .25 + .25 * Math.sin(performance.now() / 160) * Math.sin(performance.now() / 410));
    tx.style.setProperty('--lvl', (V.an || V.sim || V.native) ? 0.4 : 0);
    if (V.state !== 'idle' && V.state !== 'think') V.raf = requestAnimationFrame(tick);
  }
  /* The composer mic (#13): start a take that belongs to one thread; tap again (mic or orb) to send it there.
   * The pin survives a page reload during a native take (keyed by the take id), so it can never land elsewhere. */
  const REPLY_KEY = 'wos.reply-take.v1';
  function replyTake(id, val) {
    try {
      if (id === null) { localStorage.removeItem(REPLY_KEY); return null; }
      if (val) { localStorage.setItem(REPLY_KEY, JSON.stringify({ id, ...val })); return val; }
      const r = JSON.parse(localStorage.getItem(REPLY_KEY) || 'null');
      return r && r.id === id && r.sid ? { wid: W[r.wid] ? r.wid : '', sid: r.sid } : null;
    } catch (e) { return null; }
  }
  window.__wosReplyTake = id => replyTake(id);
  function recordReply(wid, sid) {
    if (V.state === 'think') return 'busy';
    if (V.state === 'listen' || V.state === 'paused') {
      // Tapping a composer mic while a voice reply records sends it, always to the thread it was started in.
      if (V.replyTo) { shock(); finishVoice(); return 'sent'; }
      return 'busy';
    }
    if (V.state !== 'idle' || !sid) return 'busy';
    startVoice('auto');
    V.replyTo = { wid, sid };
    if (V.native) replyTake(V.native, { wid, sid });
    CHATS.PW?.paintMic(true, sid);
    // No pill (James, 10 Oct 2026: "a giant pillbox pops up and covers my orb … I know I'm replying. The orb
    // animates."): the lit mic, the orb and its timer already say a reply is recording.
    return 'recording';
  }
  async function startVoice(kind) {
    V.onAt = performance.now();
    if (V.state !== 'idle') return;
    clearTimeout(txHideT);
    Object.assign(V, { kind, target: null, replyTo: null, snap: null, seal: null, chunks: [], parts: [], acc: 0, t0: performance.now(), sim: false, stopAsked: false, cancelled: false, an: null, simText: '', files: [], pickPaused: false }); renderVoiceFiles();
    // The take belongs where James was when he STARTED talking (James, 10 Oct 2026: "I started a thread on the chat
    // list, I clicked into a thread while I was recording it, and then I hit send and it replied to that thread").
    // Browsing to another thread mid-take, or after the send tap, never moves the message.
    V.snap = sendSnap();
    setVoice(kind === 'command' ? 'command' : 'listen');
    shock();
    // No status card while recording: the orb, timer and arc already say it. Hold-for-command keeps
    // its card (it shows where the command will land). First tap ever: a one-time tip, then never again.
    if (kind === 'command') txShow('', 'Command · release to run', 'command', '⚡');
    else { txHide(0); if (!store.get('voiceTipSeen', false)) { store.set('voiceTipSeen', true); txPill('✦', 'Listening · tap the orb again to send', 'tip'); txHide(3200); } }
    V.raf = requestAnimationFrame(tick);
    V.native = null;
    const dev = DEV();
    if (dev) { let id = ''; try { id = dev.recStart(kind === 'command' ? 'command' : 'auto') || ''; if (id) { const route = CHATS.modelRoute(V.replyTo?.wid || V.snap?.view?.id, V.replyTo?.sid || V.snap?.view?.thread || ''); if (route) saveVoiceRoute(id, route); } } catch (e) {}
      if (id) { V.native = id; reportVoice(V.state); if (V.stopAsked) finishVoice(); return; } } // '' = no mic permission yet: the page asks below
    try {
      if (!(await openRec())) return;
      if (V.stopAsked) finishVoice();
    } catch (err) {
      V.sim = true; NOMIC = true; tourEv('nomic', { kind });
      txShow('', '', '', '✦');
      $('#txRouteText').textContent = kind === 'command' ? 'No mic here · tap a command' : 'No mic here · tap a line to simulate';
      const ex = kind === 'command'
        ? ['Open CineQueue', 'Zoom out', 'Next desk', 'Directions to the airport']
        : ['Show me yesterday', 'Directions to Iconsiam', 'Play something chill', 'What did we ship on Wizard this week?'];
      $('#txChips').innerHTML = `<span class="lbl">Try</span>` + ex.map(x => `<button data-sim="${esc(x)}">${esc(x)}</button>`).join('');
      if (V.stopAsked) { cancelVoice(true); }
    }
  }
  $('#txChips').addEventListener('click', e => { const b = e.target.closest('[data-sim]'); if (!b) return; const k = V.kind; cancelVoice(true); runUtterance(b.dataset.sim, k); });
  // Only a tap (or Cancel) ends a take. If Android takes the mic away (a call, another app, the system), the
  // part recorded so far is kept and the take pauses: tap the orb to send it, or Pause to carry on recording.
  async function openRec() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('nomic');
    V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (V.cancelled || V.state === 'idle') { stopStream(); return false; }
    const AC = window.AudioContext || window.webkitAudioContext; V.ac = new AC();
    const src = V.ac.createMediaStreamSource(V.stream); V.an = V.ac.createAnalyser(); V.an.fftSize = 1024; src.connect(V.an);
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    const rec = V.rec = new MediaRecorder(V.stream, mime ? { mimeType: mime } : undefined);
    V.mime = rec.mimeType || mime || 'audio/webm';
    rec.ondataavailable = e => { if (e.data && e.data.size) V.chunks.push(e.data); };
    rec.onstop = () => (V.state === 'think' ? onRecStop() : onRecInterrupted(rec));
    // A track ended by the system stops the recorder too; onstop handles it.
    V.stream.getAudioTracks().forEach(tr => tr.addEventListener('ended', () => { try { rec.state !== 'inactive' && rec.stop(); } catch (e) {} }));
    rec.start(250);
    return true;
  }
  function onRecInterrupted(rec) {
    if (V.cancelled || V.rec !== rec || (V.state !== 'listen' && V.state !== 'paused' && V.state !== 'command')) return;
    if (V.chunks.length) V.parts.push(new Blob(V.chunks, { type: V.mime || 'audio/webm' }));
    V.chunks = [];
    if (V.state !== 'paused') V.acc += performance.now() - V.t0;
    stopStream(); V.rec = null; Orb.setLevel(0);
    setVoice('paused');
    $('#txRouteText').textContent = 'Mic interrupted · kept · tap the orb to send';
    toast('⏸', 'Mic interrupted · your recording is kept');
  }
  function stopStream() { try { V.stream && V.stream.getTracks().forEach(t => t.stop()); } catch (e) {} try { V.ac && V.ac.close(); } catch (e) {} V.stream = null; V.ac = null; V.an = null; }
  /* Send and go for the orb (James, 10 Oct 2026: "it sits at this screen for like 10 seconds… process this in the
   * background, send them back out… allow them to keep using their phone"). The send tap steps a phone thread
   * back to the list at once, like a typed send; transcription, routing and delivery carry on behind the pill
   * above the orb. The snapshot already pins the destination, so leaving can't move the message.
   * Stays put for a hold-command, an aimed desk, a composer-mic reply (already instant), or a composer tray with
   * files (those ride with the words when they land in the thread). */
  function leaveOnSend(snap) {
    const v = snap?.view;
    if (V.kind === 'command' || V.replyTo || V.target != null || v?.kind !== 'chat thread') return false;
    const w = W[v.id]; if (!w || w.thread !== v.thread) return false;
    // The composer (words, photos, files) was taken at this tap (V.seal) and rides with the take.
    CHATS.saveDraft(v.id);
    if (!CHATS.leaveAfterSend(v.id, v.thread, v.thread === '__new__', 'voice')) return false;
    // ...and the thread is under Working before the list paints, never in Ready (live.js holdSend).
    V.hold = LIVE.holdSend?.(v.thread) || null;
    CHATS.renderChats(w); applyLayout(deskOf(v.id));
    return true;
  }
  // The thread a take is sent into (and whose composer rides with it): a composer-mic take's pinned thread, or the
  // thread open when an orb take started. A held command, or a take aimed at another desk, has none.
  function sealTarget() {
    if (V.replyTo) return { wid: V.replyTo.wid, sid: V.replyTo.sid };
    const v = V.snap?.view;
    return V.kind !== 'command' && V.target == null && v?.kind === 'chat thread' && v.thread && W[v.id] ? { wid: v.id, sid: v.thread } : null;
  }
  // A take that sends nothing gives the composer it took back (words, photos, files: chats.js takeComposer).
  function unseal(seal) { const t = seal || V.seal; if (!seal) V.seal = null; try { t?.putBack(); } catch (e) { console.error(e); } }
  function dropHold() { if (V.hold) { LIVE.releaseSend?.(V.hold); V.hold = null; } }
  function saveVoiceRoute(id, route) {
    try { window.WosModels.keepVoiceRoute(id, route); } catch (e) { throw new Error('Could not save the recording’s model route'); }
  }
  function finishVoice() {
    if (V.state === 'idle' || V.state === 'think') return;
    V.snap = V.snap || sendSnap(); // pinned when the take started; browsing since can't move it
    if (V.sim) { if (V.kind === 'command') cancelVoice(true); else toast('✦', 'No mic here · nothing recorded'); return; }
    if (V.files.some(f => f.uploading)) { toast('…', 'Still uploading · tap again when it finishes', 2000); return; }
    // Text, photos and voice go as ONE message (legacy H4; James, 10 Oct 2026: "when I paste a link in the text
    // box and I send you a voice note … they should both be sent together"). The composer of the thread this take
    // goes into is taken now, at the tap, and rides with the recording (chats.js takeComposer).
    const sealAt = sealTarget();
    if (sealAt && CHATS.composerBusy(sealAt.wid, sealAt.sid)) { toast('…', 'Still uploading · tap again when it finishes', 2000); return; }
    try {
      const pin = sealAt || (V.snap.view?.thread ? { wid: V.snap.view.id, sid: V.snap.view.thread } : null);
      V.snap.route = CHATS.modelRoute(pin?.wid, pin?.sid || '');
      if (!V.snap.route) { toast('!', 'Choose a model before sending', 2200); return; }
      if (V.native) saveVoiceRoute(V.native, V.snap.route);
    } catch (e) { toast('!', String(e.message || e), 2200); return; }
    if (sealAt && !V.seal) { const t = CHATS.takeComposer(sealAt.wid, sealAt.sid); V.seal = t.text || t.files.length ? t : null; }
    leaveOnSend(V.snap);
    if (V.native) {
      if (V.state !== 'paused') V.acc += performance.now() - V.t0;
      setVoice('think'); txPill(V.kind === 'command' ? '⚡' : '✦', 'Sending…', V.kind === 'command' ? 'command' : 'agent', 'Transcribing · Wizard Voice Core');
      return nativeFinish(V.native, false);
    }
    if (!V.rec && V.parts.length) { setVoice('think'); txPill(V.kind === 'command' ? '⚡' : '✦', 'Sending…', V.kind === 'command' ? 'command' : 'agent', 'Transcribing · Wizard Voice Core'); onRecStop(); return; }
    if (!V.rec) { V.stopAsked = true; return; }
    if (V.state !== 'paused') V.acc += performance.now() - V.t0;
    setVoice('think'); txPill(V.kind === 'command' ? '⚡' : '✦', 'Sending…', V.kind === 'command' ? 'command' : 'agent', 'Transcribing · Wizard Voice Core');
    try { V.rec.state !== 'inactive' && V.rec.stop(); } catch (e) { onRecStop(); }
  }
  function cancelVoice(quiet) {
    V.cancelled = true; if (V.replyTo) { replyTake(null); V.replyTo = null; }
    unseal();
    // A long take cancelled by accident is kept (Settings → Cancelled recordings, James 11 Oct); a quick one is gone.
    // Native takes are kept by the app's recorder on recCancel (0.9.5+); the page keeps the ones it recorded itself.
    const heldMs = voiceElapsed();
    const long = !V.sim && heldMs >= (window.WosCancelled?.KEEP_FROM_MS || 15000);
    const nativeKeeps = !!V.native && typeof DEV()?.cancelledList === 'function';
    if (V.native) { try { DEV().recCancel(V.native); } catch (e) {} V.native = null; }
    const rec = V.rec, mime = V.mime || rec?.mimeType || 'audio/webm';
    const keepWeb = parts => { const b = new Blob(parts, { type: mime }); window.WosCancelled?.keepWeb(b, heldMs).then(k => k && window.WosCancelled.repaint()); };
    if (long && rec && window.WosCancelled) {
      // Stop the web recorder and keep what it heard (the last chunk arrives with the stop).
      const parts = V.parts.slice(), chunks = V.chunks;
      try {
        if (rec.state !== 'inactive') { rec.onstop = () => keepWeb(parts.concat(chunks)); rec.stop(); }
        else keepWeb(parts.concat(chunks));
      } catch (e) { keepWeb(parts.concat(chunks)); }
    } else {
      if (long && !rec && V.parts.length && window.WosCancelled) keepWeb(V.parts.slice());
      try { rec && rec.state !== 'inactive' && (rec.onstop = null, rec.stop()); } catch (e) {}
    }
    stopStream(); V.rec = null; V.sim = false; cancelAnimationFrame(V.raf); Orb.setLevel(0);
    setVoice('idle'); txHide(quiet ? 0 : 0);
    const kept = long && (nativeKeeps || !!rec || !!V.parts.length);
    if (!quiet || kept) { toast('✕', kept ? 'Cancelled · kept in Settings → Cancelled recordings' : 'Discarded', kept ? 3200 : 2200); vib(12); }
  }
  async function onRecStop(nblob, nid) {
    // A native take (Android RecorderService) arrives as one blob + its id; a web take is the parts + current chunks.
    const isNative = nblob instanceof Blob; nid = isNative ? nid : '';
    const last = !isNative && V.chunks.length ? new Blob(V.chunks, { type: V.mime || V.rec?.mimeType || 'audio/webm' }) : null;
    const blobs = isNative ? [nblob] : V.parts.concat(last && last.size ? [last] : []);
    V.parts = []; V.chunks = [];
    const blob = blobs[0] || new Blob([], { type: V.mime || 'audio/webm' });
    const size = blobs.reduce((n, b) => n + b.size, 0);
    stopStream(); V.rec = null; Orb.setLevel(0);
    if (V.cancelled) { recDone(nid); dropHold(); unseal(); return; }
    if (V.acc < 450 || size < 1200) { recDone(nid); dropHold(); unseal(); V.replyTo = null; replyTake(null); setVoice('idle'); txHide(); toast('◌', V.kind === 'command' ? 'Hold, speak, release' : 'Didn’t catch that'); tourEv('nospeech'); return; }
    // A voice reply from a thread's composer goes to that thread, as recorded: no routing, no commands,
    // straight into the durable outbox (which transcribes it and keeps the recording as a voice note).
    const snap = V.snap || sendSnap(); V.snap = null;
    snap.seal = V.seal || null; V.seal = null; // the composer read at the send tap (finishVoice)
    const kind = V.kind, aimAt = V.target;
    // Released a moment after this take is handled: by then its outbox item (if any) has replaced the hold.
    const hold = V.hold; V.hold = null;
    const unhold = () => { if (hold) setTimeout(() => LIVE.releaseSend?.(hold), 1500); };
    if (V.replyTo) {
      const rt = V.replyTo, files = takeFiles(); V.replyTo = null; replyTake(null);
      setVoice('idle'); txPill('✦', 'Voice reply · saved to this thread', 'agent'); txHide(1800);
      Promise.all(blobs.map((part, i) => Promise.resolve(CHATS.sendVoiceTo(rt.wid, rt.sid, part, i === 0 ? files : [], i === 0 ? snap.seal || false : false, snap.route)).catch(() => {}))).finally(() => recDone(nid));
      return;
    }
    try {
      const words = []; const j = { ms: 0 };
      const prompt = window.WizConfig.voicePrompt(APPS.map(a => a.name).slice(0, 40));
      // No network: straight to the outbox (it transcribes and sends when Wizard is back), no waiting on a dead line.
      if (navigator.onLine === false) throw new Error('offline');
      for (const part of blobs) {   // more than one part only after the mic was interrupted mid-take
        // A flaky line can hang a request for a long time: past this bound the take goes to the outbox instead.
        const limit = 12000 + Math.round(part.size / 20);
        const jj = await Promise.race([window.WizConfig.transcribe(part, { prompt, language: 'en' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('transcription timed out')), limit))]);
        words.push((jj.text || '').trim()); j.ms += jj.ms || 0;
      }
      const text = words.filter(Boolean).join(' ').trim();
      if (!text) { recDone(nid); unhold(); unseal(snap.seal); setVoice('idle'); txHide(); toast('◌', snap.seal ? 'No speech detected · your text is back in the thread' : 'No speech detected'); tourEv('nospeech'); return; }
      // The words are what gets sent from here; the native take is deleted once they are handled (or in the outbox).
      Promise.resolve(handleText(text, kind, false, j.ms, aimAt, snap)).finally(() => { recDone(nid); unhold(); });
    } catch (err) {
      // A held command that can't be heard is dropped with a note, never queued for the agent as a message.
      if (kind === 'command') { recDone(nid); unhold(); unseal(snap.seal); setVoice('idle'); txPill('⚡', 'Command not heard · nothing sent', 'command', String(err?.message || err)); txHide(2400); return; }
      // Never lose a recording: it goes to the outbox, which transcribes and sends it when Wizard is back.
      setVoice('idle');
      const aim = V.target, sv = snap.view;
      const files = takeFiles();
      const queued = (blobs.length ? blobs : [blob]).map((part, i) => {
        const fl = i === 0 ? files : [];   // attached files ride with the first part only
        if (aim == null && sv?.review) return sendReview(sv, '', part, fl, snap.route);
        if (aim == null && sv?.kind === 'chat thread' && W[sv.id]) return sendChat(sv.id, '', 'voice, aimed at this thread', part, { sid: sv.thread, route: snap.route, files: fl, seal: i === 0 ? snap.seal || false : false, instructions: viewContext(sv.id, 'voice, aimed at this thread', snap) });
        const sl = i === 0 ? snap.seal : null; // the window is gone: the taken composer still rides with it
        return toAgent('', 'Saved · sends when Wizard is reachable', { audio: part, desk: aim, source: 'orb', files: [...fl, ...(sl ? sl.files : [])].slice(0, 8), typed: sl?.text || '', snap })
          .then(() => sl?.done(), e => { sl?.putBack(); throw e; });
      });
      Promise.all(queued.map(q => Promise.resolve(q).catch(() => {}))).then(() => { recDone(nid); unhold(); });
      txPill('↻', 'Saved · sends when Wizard is back', 'agent', 'Couldn’t reach Wizard · recording saved, will send'); txHide(2600);
    }
  }
  // The tap that starts recording must not also press an arc button: the arc fans out
  // from under the finger, so the same tap's click would land on it mid-animation.
  $('#voice').addEventListener('click', e => { if (e.target.closest('.arc') && performance.now() - (V.onAt || 0) < 450) { e.stopPropagation(); e.preventDefault(); } }, true);
  $('#arcCancel').addEventListener('click', () => cancelVoice());
  $('#arcPause').addEventListener('click', () => {
    if (V.state === 'listen') { V.acc += performance.now() - V.t0; try { V.rec && V.rec.pause(); } catch (e) {} try { V.native && DEV().recPause(true); } catch (e) {} setVoice('paused'); vib(6); }
    else if (V.state === 'paused' && !V.native && !V.rec && V.parts.length) {   // after a mic interruption: carry on with a fresh part
      V.t0 = performance.now(); setVoice('listen'); V.raf = requestAnimationFrame(tick); vib(6);
      openRec().catch(() => { V.acc += performance.now() - V.t0; setVoice('paused'); toast('⏸', 'The mic is busy · tap the orb to send what you have'); });
    }
    else if (V.state === 'paused') { V.t0 = performance.now(); try { V.rec && V.rec.resume(); } catch (e) {} try { V.native && DEV().recPause(false); } catch (e) {} setVoice('listen'); V.raf = requestAnimationFrame(tick); vib(6); }
  });
  // The file picker is a separate screen on Android: pause the take while it is open, resume on return.
  $('#arcAttach').addEventListener('click', () => {
    if (V.state !== 'listen' && V.state !== 'paused') return;
    if (V.state === 'listen') { $('#arcPause').click(); V.pickPaused = true; }
    voicePicker.click();
  });
  const pickerBack = () => { if (!V.pickPaused) return; V.pickPaused = false; if (V.state === 'paused') $('#arcPause').click(); };
  voicePicker.addEventListener('change', pickerBack); voicePicker.addEventListener('cancel', pickerBack);

  /* Typed or simulated utterance, same pipeline as voice */
  async function runUtterance(text, kind, typed) {
    // "help" (tapped or held) opens the gestures sheet on the phone; it never goes to the agent.
    if (window.WosTour?.isHelp(text) && (kind === 'command' || sendSnap().view?.kind !== 'chat thread')) { setVoice('idle'); txHide(0); return window.WosTour.openHelp(); }
    clearTimeout(txHideT); V.kind = kind || 'auto';
    const snap = sendSnap();
    txShow('', typed ? 'Typed' : 'Heard', kind === 'command' ? 'command' : '', kind === 'command' ? '⚡' : '✦');
    setVoice('think'); shock();
    const el = $('#txText'); let k = 0;
    await new Promise(res => { const step = () => { k += Math.max(1, Math.round(text.length / 18)); el.textContent = text.slice(0, k); if (k < text.length) setTimeout(step, 22); else res(); }; step(); });
    handleText(text, kind, typed, 0, null, snap);
  }
  /* ---------------- view-aware voice ----------------
   * The orb always knows which window is in front. A view can
   *  - capture: everything said with a tap goes to that view (hold still forces a command);
   *  - auto: the fast router decides whether James is talking to the view or to Archimedes;
   *  - say nothing: the utterance goes to Archimedes, who is told what was on screen.
   * Chats threads are auto. Framed apps opt in with <meta name="wizard-os-voice" content="capture|auto">
   * and receive {type:'wizard-os:voice', text} by postMessage. */
  function viewOf(id) {
    const w = W[id]; if (!w) return null;
    if (w.app === 'chats' && w.thread) return { id, mode: 'auto', kind: 'chat thread', thread: w.thread, name: w.thread === '__new__' ? 'New chat' : `Chats thread “${winTitle(w)}”` };
    if (w.app === 'frame' && w.from && w.from.sid) return { id, mode: '', kind: 'review', review: true, thread: w.from.sid, threadTitle: w.from.title || '', name: `Review of ${winTitle(w)}`, url: frameHref(id) || w.url };
    if (w.app === 'frame') { const m = frameVoiceMode(id); return { id, mode: m, kind: 'app', name: winApp(w).name, url: frameHref(id) || winApp(w).url }; }
    if (w.app === 'chats') return { id, mode: '', kind: 'thread list', name: 'Chats' };
    if (w.app === 'review') return { id, mode: '', kind: 'review', name: winTitle(w), z: w.z };
    if (w.app === 'maps') return { id, mode: '', kind: 'maps', name: winTitle(w) };
    return { id, mode: '', kind: 'app', name: winTitle(w) };
  }
  // Rides as the run's ephemeral system note: the agent knows the view, the thread stays clean.
  /* Where James was at the moment he sent (the orb tap that ends a take, a typed send). Transcription and
   * routing take seconds; by then he may have opened another thread. Everything downstream (which thread,
   * new or reply, the context note) is decided from this snapshot, never from what is in front later. */
  function sendSnap(id) {
    const d = desks[idx], fid = id || d.focus;
    const view = viewOf(fid);
    // The words on screen at that moment, so "this step" or "that button" resolves. A chat thread's text is
    // already the conversation, so it is not repeated.
    const screen = view && view.kind !== 'chat thread' ? (window.WizScreen?.read(winEl(fid)) || '') : '';
    return { id: fid, desk: idx, view, screen, others: d.wins.filter(x => x !== fid).map(x => winTitle(W[x])) };
  }
  function viewContext(id, how = 'voice', snap = null) {
    const S = snap || sendSnap(id), v = S.view, others = S.others;
    const z = v?.z ? ` at ${v.z.level} level${v.z.day ? ` (${v.z.day})` : v.z.week ? ` (week of ${v.z.week})` : ''}` : '';
    return [
      `[Wizard OS context] ${window.WizConfig.owner() || 'The user'} sent this by ${how} from Wizard UX on their phone.`,
      v ? `Window in front: ${v.name} (${v.kind}${v.url ? `, ${v.url}` : ''})${z}.` : `They were on desk ${S.desk + 1} with no window open.`,
      S.screen ? `Visible on screen: ${S.screen}` : '',
      others.length ? `Also open on this desk: ${others.join(', ')}.` : '',
      'When they say "this", "here", or "it", they likely mean that window. Use this as background only.',
    ].filter(Boolean).join(' ');
  }
  // Review mode: what James says about the page goes to the thread that linked it, sent through a Chats window.
  function reviewSink(v) {
    const src = W[W[v.id]?.from?.win]; if (src && src.app === 'chats') return src.id;
    return Object.keys(W).find(k => W[k].app === 'chats') || '';
  }
  function reviewContext(v) {
    return [`[Wizard OS context] ${window.WizConfig.owner() || 'The user'} sent this by voice from Wizard UX on their phone while reviewing a page this thread linked.`,
      `Page under review: ${v.name.replace(/^Review of /, '')} (${v.url}).`,
      (s => s ? `Visible on screen: ${s}` : '')(window.WizScreen?.read(winEl(v.id)) || ''),
      'Treat the message as feedback on that page; "this", "here" and "it" mean that page.'].filter(Boolean).join(' ');
  }
  function sendReview(v, text, audio, files = [], route = null) {
    const wid = reviewSink(v); if (!wid) return false;
    window.__ovLog = (window.__ovLog || []).concat('review-send:' + v.thread).slice(-30);
    sendChat(wid, text, 'voice, aimed at the page under review', audio, { sid: v.thread, route, files, instructions: reviewContext(v), away: true });
    return true;
  }
  function deliverToView(v, text, snap) {
    if (v.review) return sendReview(v, text, null, [], snap?.route);
    const w = W[v.id]; if (!w) return false;
    // The thread that was open when James sent, even if the window shows another one by now.
    if (w.app === 'chats' && (v.thread || w.thread)) { sendChat(v.id, text, 'voice, aimed at this thread', null, { sid: v.thread || w.thread, route: snap?.route, seal: snap?.seal || false, instructions: viewContext(v.id, 'voice, aimed at this thread', snap) }); return true; }
    if (w.app === 'frame') {
      try { const f = winEl(v.id).querySelector('iframe'); f.contentWindow.postMessage({ type: 'wizard-os:voice', text }, location.origin); return true; } catch (e) { return false; }
    }
    return false;
  }

  /* ---------------- routing ---------------- */
  /* On the Chats list, a held orb (or a tap) can filter and search it (James + Claude Fable, 11 Oct):
   *   clear filter | all chats | show everything      → chips off
   *   filter [by] X | only X | show [me] [only] X [only] → chip X (status or subject), else search X
   *   search [for] X | find X                          → search text
   * A held orb with any other words on the list keeps doing what it always did (open apps, etc.). */
  function chatsVoice(t, snap, kind) {
    const v = snap?.view; if (!v || v.kind !== 'thread list') return null;
    const s = norm(t).replace(/^(hey |ok |okay )?(wizard|archimedes)[, ]*/, '').replace(/ please$/, '').trim();
    if (/^(clear|remove|reset|turn off|drop) (the |all )?(filters?|chips?)$|^(show )?(all|every) (chats|threads)$|^show everything$|^no filters?$/.test(s)) return { action: 'chats_filter', clear: true };
    let m = s.match(/^(?:filter|filtered) (?:by |to |for |on )?(.+)$/) || s.match(/^only (?:show )?(.+)$/) || s.match(/^show (?:me )?(?:only |just )?(?:the |my )?(.+?)(?: only| chats| threads)?$/);
    if (m) {
      const want = m[1].replace(/ (chats|threads|messages|ones)$/, '').trim();
      const f = CHATS.matchFilters(want, 1)[0];
      if (f) return { action: 'chats_filter', f };
      if (/^(?:filter|filtered)/.test(s)) return { action: 'chats_search', q: want };
      return null; // "show me …" with no filter match is not ours
    }
    // A tap keeps "find me a …" for the agent; only "search …" searches the list. A held orb takes both.
    m = s.match(kind === 'command' ? /^(?:search|find|look for)(?: (?:my |the )?(?:chats|threads|messages))?(?: for)? (.+)$/ : /^search(?: (?:my |the )?(?:chats|threads|messages))?(?: for)? (.+)$/);
    if (m) return { action: 'chats_search', q: m[1] };
    return null;
  }
  function localParse(t, snap, kind) {
    // The music search spell ("music search Home Tides") wins everywhere, even over the Chats list's "search …".
    { const ms = window.WosMusic?.available() && window.WosMusic.parse(t, false, false); if (ms && ms.op === 'search') return { action: 'music', cmd: ms }; }
    { const cv = chatsVoice(t, snap || sendSnap(), kind); if (cv) return cv; }
    // Food spells (James, 12 Oct): "order food" / "order grab" / "order lunch" open Grab for a new order; "order kra pao"
    // or "order my usual kra pao" runs a saved one; "food" on its own opens the Food app. All on the phone, nothing to Wizard.
    const us = window.WosUsuals?.match(t); if (us) return { action: 'usual', id: us };
    if (window.WosUsuals?.available()) {
      const fs = window.WosUsuals.spell(t);
      if (fs === 'new') return { action: 'usual', id: '+new' };
      if (fs === 'open' && (kind === 'command' || (snap || sendSnap()).view?.kind !== 'chat thread')) return { action: 'open_app', app: (APP.usuals || {}).name || 'Food' };
    }
    // A bare app name opens that app, no "open" needed (James, 12 Oct: "If I say the name of an app, it should just
    // open that app"). Held: anywhere, even over Wizard Music or a thread. Tapped: off a thread, so a one-word reply
    // inside a thread stays a reply. Exact names and aliases only (appByName), never a fuzzy guess.
    if (kind === 'command' || (snap || sendSnap()).view?.kind !== 'chat thread') { const an = appByName(t); if (an) return { action: 'open_app', app: an.name }; }
    // Music (play …, pause, next, louder, I like this): on-device, straight to Wizard Music. A held orb takes any
    // music phrase; a tap only the unmistakable ones ("play …", "pause the music"), so chat words stay chat.
    // In front of Wizard Music a held orb is always for the player ("Guy Barato Trap" = play it).
    if (window.WosMusic?.available()) {
      const front = W[(snap || sendSnap()).id]?.appId === 'wizard-music';
      const inMusic = kind === 'command' && front;
      const mc = window.WosMusic.parse(t, inMusic, front);
      const v0 = (snap || sendSnap()).view;
      const tapOk = mc && (mc.strong || (mc.op === 'play' && v0?.kind !== 'chat thread' && norm(t).split(' ').length <= 8));
      if (mc && (kind === 'command' || tapOk)) return { action: 'music', cmd: mc };
    }
    // The quick-search spell ("image search …", "search …") opens the search sheet on-device, even over a thread.
    // A held orb is always a command, so there even the plain "search for …" form is the search app's.
    const qs = quickSearch(t);
    if (qs && (qs.strong || kind === 'command' || (snap || sendSnap()).view?.kind !== 'chat thread')) return { action: 'quick_search', query: qs.query, tab: qs.tab };
    const s = norm(t).replace(/^(hey |ok |okay )?(wizard|archimedes)[, ]*/, '').replace(/ please$/, '');
    if (/^(zoom|go|dive) (in|deeper|down)\b/.test(s)) return { action: 'zoom', dir: 'in' };
    if (/^(zoom|back|go|pull) (out|up|back)\b|^zoom out\b/.test(s)) {
      const lv = /month/.test(s) ? 'month' : /week/.test(s) ? 'week' : null;
      return lv ? { action: 'open_view', view: lv } : { action: 'zoom', dir: 'out' };
    }
    if (/^(next|right) desk|^desk (right|next)/.test(s)) return { action: 'desk', to: 'next' };
    if (/^(previous|prev|left|last) desk|^desk (left|back)/.test(s)) return { action: 'desk', to: 'prev' };
    if (/^(go )?home( screen| desk)?$/.test(s)) return { action: 'desk', to: 'home' };
    if (/^(clear|close) (this |the )?desk$/.test(s)) return { action: 'clear_desk' };
    if (/^(close|quit|kill) (this |the )?(window|app)$/.test(s)) return { action: 'close_window' };
    if (/^(go |make (it|this) )?full ?screen$|^(maximi[sz]e|expand)( (it|this))?$/.test(s)) return { action: 'fullscreen', on: true };
    if (/^(exit full ?screen|tile( it| this)?|un ?maximi[sz]e|shrink( it| this)?)$/.test(s)) return { action: 'fullscreen', on: false };
    let m = s.match(/^move (?:this|it|the window)(?: window| app)? (?:to )?(?:the )?(left|right|next|previous|prev)(?: desk)?$/);
    if (m) return { action: 'move_window', to: /left|prev/.test(m[1]) ? 'prev' : 'next' };
    if (/^(show |open )?(my )?(inbox|notifications)$/.test(s)) return { action: 'open_view', view: 'inbox' };
    if (/^((change|switch|pick|choose|open|show) )?(the |my |a )?(skins?|themes?)$|^change (the |my )?look$/.test(s)) return { action: 'open_view', view: 'skin' };
    if (/^(show |open )?(my )?(apps|app list|launcher|all apps)$/.test(s)) return { action: 'open_view', view: 'apps' };
    m = s.match(/^(?:open|launch|show|start|go to|switch to)\s+(?:me\s+)?(.+)$/);
    if (m) {
      const q = m[1];
      if (/^(yesterday|yesterdays review|yesterday s review)$/.test(q)) return { action: 'open_view', view: 'day', date: YESTERDAY };
      if (/^today$/.test(q)) return { action: 'open_view', view: 'day', date: TODAY };
      if (/^(the |this )?week( in review)?$/.test(q)) return { action: 'open_view', view: 'week' };
      if (/^(the |this )?month( in review)?$/.test(q)) return { action: 'open_view', view: 'month' };
      const a = findApp(q); if (a) return { action: 'open_app', app: a.name };
    }
    return null;
  }
  async function handleText(text, kind, typed, sttMs, target, snap) {
    const sttNote = sttMs ? ` · heard in ${sttMs} ms` : '';
    snap = snap || sendSnap();
    // A bare "help" opens the gestures sheet. Held: always. Tapped: unless a thread is open (there it's a reply).
    if (window.WosTour?.isHelp(text) && (kind === 'command' || snap.view?.kind !== 'chat thread')) { setVoice('idle'); txHide(0); return window.WosTour.openHelp(); }
    const opts = target == null ? { snap } : { desk: target, snap };
    $('#txText').textContent = text;
    const v = snap.view;
    // Attached files mean "look at this": skip command routing and send words + files together. So do words,
    // photos or files waiting in the thread's composer (snap.seal): one message, never a command.
    const files = typed ? [] : takeFiles();
    const seal = typed ? null : snap.seal || null;
    if (files.length || seal) {
      const nf = files.length + (seal ? seal.files.length : 0);
      const with_ = [seal?.text.trim() ? 'your text' : '', nf ? (nf === 1 ? '1 file' : `${nf} files`) : ''].filter(Boolean).join(' + ');
      if (target == null && v?.review) { setVoice('idle'); txPill('✦', 'Feedback sent with ' + (files.length === 1 ? '1 file' : `${files.length} files`), 'agent'); txHide(1400); return sendReview(v, text, null, files, snap.route); }
      if (target == null && v?.kind === 'chat thread' && W[v.id]) { setVoice('idle'); txPill('✦', 'Sent with ' + with_, 'agent'); txHide(1400); return sendChat(v.id, text, 'voice, aimed at this thread', null, { sid: v.thread, route: snap.route, files, seal: seal || false, instructions: viewContext(v.id, 'voice, aimed at this thread', snap) }); }
      const all = [...files, ...(seal ? seal.files : [])].filter((f, i, a) => a.findIndex(x => x.id === f.id) === i).slice(0, 8);
      return toAgent(CHATS.joinWords(seal?.text, text), `To ${window.WizConfig.agent()} · with ${with_}` + sttNote, { ...opts, files: all }).then(() => seal?.done(), e => { seal?.putBack(); throw e; });
    }
    const t0 = performance.now();
    const loc = localParse(text, snap, kind);
    if (loc) {
      const ms = Math.max(1, Math.round(performance.now() - t0));
      showRouted('command', `Command · on-device · ${ms} ms${sttNote}`);
      return finishCmd(loc, text, opts);
    }
    // A capturing view takes a tap utterance as-is.
    if (kind !== 'command' && v?.mode === 'capture' && target == null) return toView(v, text, `To ${v.name}${sttNote}`);
    // An open thread owns what James says: unless it is a phone command (or aimed at another desk), it goes
    // into that thread (steering the live run), never a new thread. New threads start from the list or New chat.
    const intoThread = kind !== 'command' && target == null && (v?.kind === 'chat thread' || v?.review);
    // A held orb is a command for the interface, never a message (James, 10 Oct 2026: "the long press is me
    // saying I want to issue a command that I want the interface to respond to"). When nothing matches, it
    // offers the choices and sends nothing until one is tapped. On a review desk a tap sends feedback to the
    // thread the link came from.
    const toAgentOrThread = label => kind === 'command' && !typed ? holdNoMatch(text, opts)
      : intoThread ? toView(v, text, v.review ? `To “${clip(v.threadTitle || 'the thread', 30)}” · feedback${sttNote}` : `To this thread${sttNote}`, snap) : toAgent(text, label, opts);
    setVoice('think'); if (isPill()) tx.dataset.detail = 'Routing · DeepSeek Flash'; else $('#txRouteText').textContent = 'Routing · DeepSeek Flash';
    try {
      const view = v && v.mode && kind !== 'command' && target == null ? { name: v.name, kind: v.kind } : null;
      const routeUrl = window.WizConfig.endpoint('route');
      if (!routeUrl) return toAgentOrThread(`To ${window.WizConfig.agent()}${sttNote}`);
      const r = await fetch(routeUrl, { method: 'POST', signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, force: kind === 'command' ? 'command' : '', view, apps: APPS.filter(a => a.kind !== 'view').map(a => a.name) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'router');
      const c = j.cmd || {};
      if (c.route === 'view' && view) return toView(v, text, `To ${v.name} · routed in ${j.ms} ms${sttNote}`, snap);
      if (c.route === 'command') {
        showRouted('command', `Command · DeepSeek Flash · ${j.ms} ms${sttNote}`);
        const ran = finishCmd(c, text, opts);
        if (c.then_agent) setTimeout(() => toAgent(String(c.then_agent), `Opened ${c.app || 'app'} · follow-up to ${window.WizConfig.agent()}`, opts), 1500);
        return ran;
      }
      return toAgentOrThread(`To ${window.WizConfig.agent()} · routed in ${j.ms} ms${sttNote}`);
    } catch (e) {
      return toAgentOrThread(`Router offline · sent to ${window.WizConfig.agent()}`);
    }
  }
  /* Hold-command with no command match: a choice card, nothing is sent until James taps. */
  const NOMATCH_MS = 4000;
  function holdNoMatch(text, opts) {
    tourEv('nomatch', { text });
    setVoice('idle'); vib(12);
    txShow(text, 'No command matched · nothing sent', 'command', '⚡');
    const q = String(text || '').trim().replace(/[.!?,\s]+$/, '');
    const btn = (k, label) => `<button data-hold="${k}">${esc(label)}</button>`;
    $('#txChips').innerHTML = (searchUrl(q) ? btn('search', 'Search the web') + btn('images', 'Image search') : '')
      + btn('agent', `Send to ${window.WizConfig.agent()}`);
    V.holdText = q; V.holdOpts = opts;
    window.__backLog = (window.__backLog || []).concat('hold:nomatch').slice(-30);
    txHide(NOMATCH_MS); // James (11 Oct): 9 s lingered far too long; × closes it at once
    return false;
  }
  function showRouted(kind, label) {
    if (isPill()) {
      const short = kind === 'agent' ? (/^Saved/.test(label) ? 'Saved · sends when Wizard is back' : `Sent to ${window.WizConfig.agent()}`)
        : kind === 'view' ? 'Sent ' + label.split(' · ')[0].replace(/^To /, 'to ')
        : ($('#txText').textContent || 'Done');
      return txPill(kind === 'command' ? '⚡' : kind === 'view' ? '◧' : '✦', short, kind, label);
    }
    tx.className = 'transcript ' + kind; $('#txRouteIcon').textContent = kind === 'command' ? '⚡' : kind === 'view' ? '◧' : '✦'; $('#txRouteText').textContent = label;
  }
  function finishCmd(c, text, opts) {
    setVoice('done'); vib([8, 40, 8]);
    const ok = execute(c, text, opts);
    tourEv('command', { ok: !!ok, text });
    if (!ok) { $('#txRouteText').textContent += ' · no match'; }
    setTimeout(() => { if (V.state === 'done') setVoice('idle'); }, 900);
    txHide(ok ? (isPill() ? 1200 : 1300) : 3200);
  }
  function toView(v, text, label, snap) {
    showRouted('view', label); setVoice('done'); vib([8, 40, 8]);
    const ok = deliverToView(v, text, snap);
    if (!ok) return toAgent(text, `${v.name} didn’t take it · sent to ${window.WizConfig.agent()}`, { snap });
    if (!v.thread || W[v.id]?.thread === v.thread) focusWin(v.id); // never pull James back from where he went since
    setTimeout(() => { if (V.state === 'done') setVoice('idle'); }, 900);
    txHide(isPill() ? 1200 : 1500);
  }
  function execute(c, text, opts = {}) {
    const a = String(c.action || '').toLowerCase();
    const arg = c.app || c.target || c.destination || c.query || c.view || '';
    const f = desks[idx].focus;
    if (/direction|navigat|route/.test(a)) { openMaps('dir', c.destination || c.target || c.query || text, opts); return true; }
    if (/maps_search|map/.test(a)) { openMaps('search', c.query || c.target || text, opts); return true; }
    if (a === 'music') return window.WosMusic.run(c.cmd);
    if (/music|play/.test(a)) {
      // The router's play_music: Wizard Music when installed (it fixes misheard names), else Spotify search.
      const q = c.query || c.target || '';
      if (window.WosMusic?.available()) return window.WosMusic.run({ op: 'play', said: q ? `play ${q}` : text });
      closeSheets(); openApp(APP.spotify || { id: 'spotify', name: 'Spotify' }, { query: q }, opts); return true;
    }
    if (a === 'zoom') {
      let id = W[f]?.app === 'review' ? f : desks[idx].wins.find(x => W[x].app === 'review');
      if (!id) { openReview('day', null, opts); return true; }
      focusWin(id); setTimeout(() => (c.dir === 'out' ? zoomOut(id) : zoomIn(id)), 200); return true;
    }
    if (a === 'desk') {
      const to = c.to; closeSheets();
      if (to === 'next') goDesk(idx + 1); else if (to === 'prev') goDesk(idx - 1); else if (to === 'home') goDesk(HOME); else if (+to >= 1) goDesk(+to - 1);
      return true;
    }
    if (a === 'clear_desk') { clearDesk(idx); return true; }
    if (a === 'close_window') { if (!f) return false; closeWin(f); return true; }
    if (a === 'fullscreen') { if (!f) return false; setFull(f, c.on !== false); return true; }
    if (a === 'move_window') { if (!f) return false; const to = c.to === 'prev' || c.to === 'left' ? idx - 1 : c.to === 'next' || c.to === 'right' ? idx + 1 : +c.to - 1; return moveWin(f, to); }
    if (a === 'quick_search') return openSearch(c.query, c.tab);
    if (a === 'chats_filter' || a === 'chats_search') {
      const w = W[f]?.app === 'chats' ? W[f] : null; if (!w) return false;
      closeSheets(true); const cc = CHATS.ch(w.id); cc.fromCard = false; cc.coach = false;
      if (c.clear) { CHATS.clearAll(w); toast('⌯', 'All chats', 1400); return true; }
      if (c.f) { CHATS.addFilter(w, c.f); cc.lastChip = c.f.kind; toast('⌯', `Filter: ${c.f.label}`, 1600); return true; }
      CHATS.setQuery(w, c.q); toast('⌕', `Searching “${clip(c.q, 40)}”`, 1600); return true;
    }
    if (a === 'usual') return window.WosUsuals?.run(c.id) ?? false;
    if (a === 'search') { const q = c.query || text; if (searchUrl(q) && !findApp(q)) return openSearch(q, 'all'); openSheet('launcher', q); return true; }
    if (a === 'open_view' || a === 'view' || a === 'show') {
      const v = String(c.view || arg).toLowerCase();
      if (/inbox|notif/.test(v)) { openSheet('inbox'); return true; }
      if (/skin|theme/.test(v)) { openSettings('look'); return true; }
      if (/apps|launcher/.test(v)) { openSheet('launcher'); return true; }
      closeSheets(); openReview(/month/.test(v) ? 'month' : /week/.test(v) ? 'week' : 'day', c.date, opts); return true;
    }
    if (/open|launch|app/.test(a)) {
      const app = findApp(arg); closeSheets();
      if (app) { openApp(app, {}, opts); return true; }
      openSheet('launcher', arg); return false;
    }
    openSheet('launcher', text); return false;
  }
  /* A new request to Archimedes. It is delegated in the background: James stays exactly where he is
   * (no Chats window opens, no desk switch, no thread takes focus). The new thread shows up in Chats,
   * Working and the Inbox like any other, and he opens it when he chooses. */
  async function toAgent(text, label, opts = {}) {
    tourEv('sent', { text });
    showRouted('agent', label); setVoice('agent'); vib(10);
    setTimeout(() => { setVoice('idle'); }, 1200);
    txHide(isPill() ? 1400 : 2600);
    const ctx = viewContext(desks[idx].focus, opts.how || 'voice', opts.snap);
    // Saved before it is sent: a dropped connection can delay this, never lose it.
    await OUTBOX.enqueue({ kind: 'new', text, typed: opts.typed || '', ...(opts.snap?.route || {}), instructions: ctx, audio: opts.audio || null, source: opts.source || 'orb', files: opts.files || [] });
    renderMoons(); refreshHome(); renderDots();
  }
  OUTBOX?.onSent((it, res) => {
    if (it.kind === 'new' && LIVE && !LIVE.session(it.sessionId)) {
      LIVE.sessions.unshift({ id: it.sessionId, runtime: 'direct', title: (it.text || 'Voice note').slice(0, 60), status: 'running', runId: res.runId, updatedAt: new Date().toISOString(), lastUserAt: new Date().toISOString(), preview: it.text, source: 'wizard-mobile' });
      LIVE.markSeen(it.sessionId);
    } else if (LIVE?.session(it.sessionId)?.synthetic) LIVE.markSeen(it.sessionId);
    // A reply's thread is already held in Working with its live status by live.js (PEND), until Wizard lists the run.
    if (it.attempts) toast('✦', res.steered ? 'Delivered · steering the live run' : `Delivered to ${window.WizConfig.agent()}`, 2000);
    // First-try orb sends were already confirmed by the pill above the orb: no second banner.
    else if (res.steered) toast('✦', 'Sent · steering the live run', 1800);
    LIVE?.emit(); setTimeout(() => LIVE?.refresh(), 3000);
    for (const id of Object.keys(W)) if (W[id].app === 'chats' && W[id].thread === it.sessionId) setTimeout(() => W[id] && loadThread(W[id], true), 1500);
  });

  /* ---------------- orb gestures ----------------
   * Tap: talk. Hold: command (it opens on the desk beside this one). Swipe: left/right desks, up apps, down inbox. */
  const orbWrap = $('#orbWrap');
  let G = null;
  function shock() { const s = $('.orb-shock'); s.classList.remove('go'); void s.offsetWidth; s.classList.add('go'); }
  orbWrap.addEventListener('contextmenu', e => e.preventDefault());
  orbWrap.addEventListener('pointerdown', e => {
    e.preventDefault(); orbWrap.setPointerCapture(e.pointerId); closeMenu();
    G = { x: e.clientX, y: e.clientY, t: performance.now(), mode: 'pending', dx: 0, dy: 0, aim: null };
    Orb.press(true);
    G.corner = device.classList.contains('orb-corner');
    if (V.state === 'idle' && !sheet) G.hold = setTimeout(() => { if (G && G.mode === 'pending') { G.mode = 'hold'; G.holdAt = performance.now(); vib(18); startVoice('command'); } }, 380);
  });
  // Slide-to-aim is retired (James, 11 Oct 2026): a held command already opens on the desk beside this one, so
  // sliding while holding does nothing (no desk label, no aim). A hold that starts travelling at once is a swipe.
  const aimFor = () => null;
  orbWrap.addEventListener('pointermove', e => {
    if (!G) return; G.dx = e.clientX - G.x; G.dy = e.clientY - G.y;
    // A hold that starts travelling right after it fired was really a swipe (slow frame ate the moves).
    if (G.mode === 'hold' && G.holdAt && performance.now() - G.holdAt < 600 && Math.hypot(G.dx, G.dy) > 34) {
      cancelVoice(true); G.mode = 'pending';
    }
    if (G.mode === 'hold') {
      // Aim: slide toward the desk this command should land on.
      G.aim = G.corner ? null : aimFor(G.dx);
      orbWrap.dataset.dir = G.aim == null ? '' : (G.aim < idx ? `← Desk ${G.aim + 1}` : `Desk ${G.aim + 1} →`);
      device.classList.toggle('aiming', G.aim != null);
      $('#txRouteText').textContent = G.aim == null ? 'Command · release to run' : `Command · opens on desk ${G.aim + 1}`;
      return;
    }
    // Swipes work in every voice state: recording or sending never locks navigation.
    if (G.mode === 'pending' && Math.hypot(G.dx, G.dy) > 14 && G.corner) { clearTimeout(G.hold); G.mode = 'still'; }
    if (G.mode === 'still') return; // the corner orb only talks: a slid finger cancels, it never swipes the shell
    if (G.mode === 'pending' && Math.hypot(G.dx, G.dy) > 14) {
      clearTimeout(G.hold); G.mode = Math.abs(G.dx) > Math.abs(G.dy) ? 'h' : 'v'; orbWrap.classList.add('dragging');
    }
    if (G.mode === 'h' && !sheet) {
      let dx = G.dx; if ((idx === 0 && dx > 0) || (atPickerEnd() && dx < 0)) dx *= .28;
      placeTrack(dx * 1.1, false);
      orbWrap.dataset.dir = Math.abs(G.dx) > 50 ? (G.dx < 0 ? (idx < desks.length - 1 ? `${clip(deskName(idx + 1), 16)} →` : atPickerEnd() ? '' : 'New desk →') : (idx > 0 ? `← ${clip(deskName(idx - 1), 16)}` : '')) : '';
    } else if (G.mode === 'v') {
      if (!sheet) {
        const p = Math.min(1, Math.abs(G.dy) / 240);
        const el = G.dy < 0 ? launcher : inboxEl, other = G.dy < 0 ? inboxEl : launcher;
        other.style.transform = ''; other.style.opacity = '';
        el.classList.add('dragging');
        if (G.dy < 0 && !el._rendered) { renderLauncher(''); el._rendered = true; }
        if (G.dy > 0 && !el._rendered) { renderInbox(); el._rendered = true; }
        el.style.transform = G.dy < 0 ? `translateY(calc(${(1 - p) * 100}% + ${(1 - p) * 160}px))` : `translateY(calc(${-(1 - p) * 100}% - ${(1 - p) * 60}px))`;
        el.style.opacity = String(Math.min(1, p * 1.6));
      }
      orbWrap.dataset.dir = Math.abs(G.dy) > 40 ? (sheet ? 'Close' : G.dy < 0 ? '↑ Apps' : '↓ Inbox') : '';
    }
  });
  function endGesture(e, cancelled) {
    if (!G) return; const g = G; G = null;
    clearTimeout(g.hold); Orb.press(false); orbWrap.classList.remove('dragging'); orbWrap.dataset.dir = ''; device.classList.remove('aiming');
    const vt = (performance.now() - g.t) || 1;
    if (g.mode === 'pending' && !cancelled) {
      if (sheet) return closeSheets();
      if (V.state === 'idle') return startVoice('auto');
      if (V.state === 'listen' || V.state === 'paused') { shock(); return finishVoice(); }
      return; // sending: a tap on the orb does nothing until the take is handed off
    } else if (g.mode === 'hold') {
      if (cancelled) return cancelVoice(true);
      V.target = g.aim;
      return finishVoice();
    } else if (g.mode === 'h') {
      if (sheet) return;
      if (cancelled) return placeTrack(0, true);
      const v = g.dx / vt;
      if (g.dx < -60 || v < -.5) { swipeDesk(1); tourEv('desk', { home: idx === HOME }); } else if (g.dx > 60 || v > .5) { swipeDesk(-1); tourEv('desk', { home: idx === HOME }); } else placeTrack(0, true);
    } else if (g.mode === 'v') {
      [launcher, inboxEl].forEach(el => el.classList.remove('dragging'));
      launcher._rendered = inboxEl._rendered = false;
      if (sheet) { if ((sheet === 'launcher' && g.dy > 40) || (sheet === 'inbox' && g.dy < -40) || (sheet === 'settings' && Math.abs(g.dy) > 40)) closeSheets(); else if (Math.abs(g.dy) > 40) openSheet(g.dy < 0 ? 'launcher' : 'inbox'); return; }
      const v = g.dy / vt;
      if (g.dy < -70 || v < -.55) openSheet('launcher');
      else if (g.dy > 70 || v > .55) openSheet('inbox');
      else { [launcher, inboxEl].forEach(el => { el.style.transform = ''; el.style.opacity = ''; }); }
    }
  }
  orbWrap.addEventListener('pointerup', e => endGesture(e, false));
  orbWrap.addEventListener('pointercancel', e => endGesture(e, true));
  orbWrap.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (V.state === 'idle') startVoice('auto'); else finishVoice(); } });
  orbWrap.tabIndex = 0;

  /* ---------------- Back never leaves Wizard OS ----------------
   * Android Back is an in-app back gesture, one step at a time:
   *   recording → menu → sheet → the focused window's own back (thread → list,
   *   framed app history, review dive) → full screen → Home desk.
   * On Home with nothing left to undo, the first Back only warns; a second Back
   * within 2 s exits. Two mechanisms, so it holds on every Chrome:
   *   1. CloseWatcher (Chrome 120+) consumes Back, re-armed after every press,
   *      in this document and in every same-origin framed app;
   *   2. a history guard entry pushed during a user gesture; popstate → one step. */
  const EXIT_MS = 2000;
  let exitUntil = 0, exitT = 0, guardOn = history.state?.wos === 'guard', ignorePop = 0;
  const watchers = new Set();
  // LEGACY-BRIDGE (remove when Legacy Wizard retires, or replace with the spec'd app Back contract — see
  // wizard-os docs/WORK_OUTSTANDING.md "Back button contract"): the hook name and the layout-signature guess below
  // exist only because Legacy Wizard's hook always answers true. A spec'd hook returns handled/not-handled honestly,
  // which deletes frameSig() and the timeout. Regression: qa-hosted-back.cjs.
  // A hosted app that keeps its screens in app state (Legacy Wizard: thread → list, viewers, sheets) has no frame
  // history to walk. It exposes its own Back as window.__wizardCloseOverlay() — the hook its Android app calls.
  // That hook answers true even at its own root, so the shell compares a small layout signature after React
  // settles: if nothing moved, the press was a no-op in the app and the shell takes the step instead.
  function frameSig(win) {
    try { const d = win.document; return [win.location.href, d.querySelectorAll('[role="dialog"],[aria-modal="true"],.open').length,
      [...d.querySelectorAll('h1,[aria-label^="Back"]')].map(e => e.getAttribute('aria-label') || e.textContent).join('|')].join('#'); } catch (e) { return ''; }
  }
  function hostedBack(f) {
    let win; try { win = winEl(f.id)?.querySelector('iframe')?.contentWindow; } catch (e) { return null; }
    let hook; try { hook = win && win.__wizardCloseOverlay; } catch (e) { return null; }
    if (typeof hook !== 'function') return null;
    // Store's canonical hook returns handled/not-handled synchronously; never apply the legacy layout guess.
    if (f.appId === 'app-store' || f.appId === 'system') { try { return hook.call(win) === true ? 'store-card' : null; } catch (_) { return null; } }
    const before = frameSig(win);
    let r; try { r = hook.call(win); } catch (e) { return null; }
    if (r === false) return null;
    const fid = f.id;
    setTimeout(() => {
      if (frameSig(win) !== before) return;
      // The app was already at its root: take the shell step now (without asking the app again).
      const did = backStep(fid);
      window.__backLog = (window.__backLog || []).concat('hosted-noop:' + (did || 'root')).slice(-30);
      if (!did) toast('⌂', "You're home", 1200);
    }, 180);
    return 'hosted';
  }
  function backStep(skipHosted) {
    { const t = window.WosTour?.back(); if (t) return t; } // the first-run tour and the Help sheet sit above everything
    { const sm = window.WosSelMenu?.back(); if (sm) return sm; } // selected words + their menu: Back lets go of them first
    // Recording keeps going: Back navigates like it always does. Only the Cancel button discards a take.
    if (document.querySelector('#txChips [data-handoff], #txChips [data-hold]')) { $('#txChips').innerHTML = ''; V.holdText = ''; txHide(0); return 'draft'; }
    const lm = window.LiveMode?.back?.(); if (lm) return lm;
    if (CHATS.KIT?.viewer?.isOpen() && CHATS.KIT.viewer.close()) return 'viewer'; // an image opened from a link sits above the sheet
    if (LINKS && LINKS.isOpen()) { LINKS.back(); return 'link'; }
    const ov = CHATS.closeOverlay(); if (ov) return ov; // media viewer, then the thread actions sheet
    const dv = window.WosDevice?.back?.(); if (dv) return dv; // share picker, recovered-recording card
    if (window.WosResources?.back()) return 'resources';
    { const fw = W[desks[idx]?.focus]; if (fw?.app === 'usuals') { const u = window.WosUsuals?.back?.(); if (u) return u; } }
    if (closeOverview()) return 'overview';
    if (closeReviewCoach()) return 'review-coach';
    if (menuFor) { closeMenu(); return 'menu'; }
    if (sheet) { closeSheets(); return 'sheet'; }
    const d = desks[idx], f = W[d.focus];
    if (f) {
      if (f.app === 'chats' && f.thread) return CHATS.threadBack(f);
      if (f.app === 'chats' && (CHATS.hasFilter(f) || CHATS.ch(f.id).q)) {
        const c = CHATS.ch(f.id), back = c.filterFrom, did = CHATS.clearFilter(f);
        // A Home card's chip: one Back takes it off and goes back to Home, the way James came.
        if (did === 'chip' && !CHATS.hasFilter(f)) { c.fromCard = false; c.coach = false; c.filterFrom = null; const p = back ? desks.findIndex(x => x.id === back) : -1; if (p >= 0 && p !== idx) goDesk(p); }
        if (did) return did === 'search' ? 'search' : 'filter';
      }
      if (f.app === 'chats' && CHATS.readyBack?.()) return 'ready-order'; // Priority / By subject → Newest
      if (f.app === 'frame' && skipHosted !== f.id) { const h = hostedBack(f); if (h) return h; }
      if (f.app === 'frame') { const nav = frameNav(f.id); if (nav?.canGoBack) { try { selfPop(winEl(f.id).querySelector('iframe').contentWindow); } catch (e) {} nav.back(); return 'frame'; } }
      if (f.app === 'review' && (f.zd || 0) > 0) { zoomOut(f.id); return 'zoom'; }
      if (d.full) { setFull(f.id, false); return 'tile'; }
      // A bound view: Back slides back to its thread; the view stays beside it until James leaves the thread.
      if (f.bound && W[f.bound] && deskOf(f.bound) >= 0) { goDesk(deskOf(f.bound)); return 'bound-back'; }
      if (f.from) { closeWin(f.id); return 'review-close'; } // a link's desk: Back closes it and lands where it came from
    }
    if (idx !== HOME) { goDesk(HOME); return 'home'; }
    return null;
  }
  function onBack() {
    const did = backStep();
    window.__backLog = (window.__backLog || []).concat(did || 'exit-warn').slice(-30);
    if (did) { exitUntil = 0; return; }
    // Nothing left to undo: warn, then let the very next Back leave.
    exitUntil = Date.now() + EXIT_MS; toast('↩', 'Press back again to exit Wizard OS', EXIT_MS);
    disarmAll(); dropGuard();
    clearTimeout(exitT); exitT = setTimeout(() => { exitUntil = 0; armBack(); }, EXIT_MS);
  }
  function makeWatcher(win, rearm) {
    if (!win || !('CloseWatcher' in win) || Date.now() < exitUntil) return null;
    try {
      const w = new win.CloseWatcher();
      w.onclose = () => { watchers.delete(w); onBack(); if (Date.now() >= exitUntil) setTimeout(rearm, 0); };
      watchers.add(w); return w;
    } catch (e) { return null; }
  }
  let topWatcher = null;
  function armBack() {
    if (Date.now() < exitUntil) return;
    if (!topWatcher || !watchers.has(topWatcher)) topWatcher = makeWatcher(window, () => { topWatcher = null; armBack(); });
    ensureGuard();
  }
  function armFrameBack(f, win) {
    if (win._wosWatcher && watchers.has(win._wosWatcher)) return;
    const rearm = () => { try { if (f.contentWindow === win) { win._wosWatcher = null; armFrameBack(f, win); } } catch (e) {} };
    win._wosWatcher = makeWatcher(win, rearm);
  }
  function disarmAll() { for (const w of [...watchers]) { watchers.delete(w); try { w.destroy(); } catch (e) {} } topWatcher = null; $$('iframe.appframe').forEach(f => { try { f.contentWindow._wosWatcher = null; } catch (e) {} }); }
  function rearmFrames() { $$('iframe.appframe').forEach(f => { try { const w = f.contentWindow; if (w && w.document.readyState !== 'loading') armFrameBack(f, w); } catch (e) {} }); }
  // History guard: only pushed during a user gesture, so Chrome never skips it.
  function ensureGuard(force) {
    if (guardOn || Date.now() < exitUntil || (!force && !navigator.userActivation?.isActive)) return;
    history.pushState({ wos: 'guard' }, ''); guardOn = true;
  }
  // Only step back over our own guard entry. If the current entry is not the guard (it was already consumed, or
  // Chrome treats it as skippable), going back would leave the page, so the warning just stays put instead.
  // The pop this causes can land in the top page OR in a hosted frame (Topics, Meetings), and may fire in several
  // frames at once. Every pop inside the next half second is ours, never the user's second Back: worst case a very
  // fast double Back stays in the app, which is the safe direction.
  var dropUntil = 0; // var: frame listeners defined earlier may read it during boot
  function dropGuard() { const g = guardOn && history.state?.wos === 'guard'; guardOn = false; if (g) { ignorePop++; dropUntil = Date.now() + 500; history.back(); } }
  addEventListener('popstate', e => {
    // Landing on a guard entry means the Back key popped something stacked above it (a hosted app's entry or a
    // second guard). We never navigate forward, so every pop is a user Back: never swallow one.
    guardOn = e.state?.wos === 'guard';
    if (ignorePop) { ignorePop--; dropUntil = 0; return; }
    if (Date.now() < dropUntil) { dropUntil = 0; return; } // our own guard drop surfacing late (counts once)
    if (Date.now() < exitUntil) { history.back(); return; } // second Back: leave
    onBack();
    // A consumed step re-arms at once, so the next Back (even with no tap in
    // between) is caught too. After the exit warning nothing is re-armed.
    if (Date.now() >= exitUntil) ensureGuard(true);
  });
  // Every touch is a user activation: refresh the watchers and the guard then.
  // (Touch only grants activation on pointerup/click, so listen to all three.)
  for (const ev of ['pointerdown', 'pointerup', 'click']) addEventListener(ev, () => { if (Date.now() >= exitUntil) { armBack(); rearmFrames(); } }, true);
  addEventListener('keydown', () => { if (Date.now() >= exitUntil) armBack(); }, true);
  if (history.state?.wos !== 'root' && history.state?.wos !== 'guard') history.replaceState({ wos: 'root' }, '');
  if (history.state?.wos === 'guard') guardOn = true;

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !('CloseWatcher' in window)) { onBack(); return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') goDesk(idx + 1);
    else if (e.key === 'ArrowLeft') goDesk(idx - 1);
    else if (e.key === 'ArrowUp') { sheet === 'inbox' ? closeSheets() : openSheet('launcher'); }
    else if (e.key === 'ArrowDown') { sheet === 'launcher' ? closeSheets() : openSheet('inbox'); }
    else if (e.key === '/') { e.preventDefault(); openSheet('launcher'); setTimeout(() => $('#search').focus(), 50); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { LIVE && LIVE.refresh(); markVisibleThreadsSeen(); } });

  // The phone keeps a still resting orb; live voice/agent feedback stays animated.
  // Shared native Everywhere hosts retain their existing cadence.
  Orb.setRestingMotion?.(false);

  /* Starfield + Nebula drift + skin canvases: core/scenery.js (battery-gated decorative motion). */

  /* ---------------- boot ---------------- */
  buildDesks(); setVoice('idle'); armBack();
  // Decorative motion lives only on a visible, recently touched Home with nothing over it (core/scenery.js).
  window.WosScenery?.attach({ device, homeInView: () => idx === HOME && !desks[idx]?.full, deskIdx: () => idx });
  if (LIVE) LIVE.refresh();
  $('#clock').textContent = window.WizConfig.hm();
  window.addEventListener('wizard:config', () => { const t = $('#homeTime'), c = $('#clock'), hm = window.WizConfig.hm(); if (t) t.textContent = hm; if (c) c.textContent = hm; });
  /* First run: the practice tour (core/tour.js). Say "help" or Settings → Gestures & help to see it again. */
  window.WosTour?.attach({
    device, orbWrap, shock, vib, toast,
    setMode: m => Orb.setMode(m),
    goHome: () => { if (idx !== HOME) goDesk(HOME, true); },
    workingCard: () => track.querySelector('.home-desk [data-act="working"]'),
    cmdExample: () => (findApp('calendar') ? 'Open Calendar' : 'Open Day in review'),
    noMic: () => NOMIC,
    closeSheets: () => closeSheets(),
    dismissVoice: () => { $('#txChips').innerHTML = ''; V.holdText = ''; txHide(1200); },
    prepare: () => { if (V.state !== 'idle') cancelVoice(true); closeMenu(); closeOverview(); closeSheets(true); const d = desks[idx]; if (d.full && d.focus) setFull(d.focus, false); },
    say: (t, kind) => runUtterance(t, kind || 'auto'),
  });
  const firstRun = !store.get('coached', false) && !window.WosTour?.done();
  if (firstRun) setTimeout(() => { if (!(window.__deeplinkLog || []).length) window.WosTour?.start('first-run'); else window.WosTour?.mark(); }, 600);
  // Native shell (Wizard OS Android app): the app hands every hardware/gesture Back to the shell. A step that
  // undoes something returns its name; at the true root the shell stays put and says so. The app never exits
  // on Back (James's rule), so there is no "press again to exit" in native mode.
  window.__wosNativeBack = () => {
    const did = backStep();
    window.__backLog = (window.__backLog || []).concat(did ? 'native:' + did : 'native:root').slice(-30);
    if (!did) toast('⌂', "You're home", 1200);
    return did || 'root';
  };
  if (/WizardOS-Android\//.test(navigator.userAgent)) document.documentElement.classList.add('native-app');
  // Assistant handoff (side-key app → Wizard OS). 'listen' opens the orb listening; 'say' shows the words as a
  // draft that James sends with one tap — another app can never make Archimedes act on its own.
  window.__wosHandoff = h => {
    // A side-button handoff means James already knows the gestures: clear the first-run coach so the draft is visible.
    if (window.WosTour?.active) window.WosTour.finish('handoff');
    if (!h || typeof h !== 'object') return false;
    closeSheets(); if (idx !== HOME && h.action !== 'thread') goDesk(HOME);
    if (h.action === 'listen') { if (V.state === 'idle') startVoice('auto'); return true; }
    if (h.action === 'thread' && h.id) { openWizardThread(String(h.id)); LIVE?.refresh(); return true; }
    if (h.action === 'usuals') { openUsuals(); return true; }
    if (h.action === 'unsent' || h.action === 'settings') { onUnsentChange(); openSettings(h.action === 'unsent'); return true; }
    if (h.action === 'side-button') { store.set('sideHidden', false); refreshHome(true); if (SIDE && (SIDE.step === 'mic' || SIDE.step === 'assistant')) sideButtonTap(false); else toast('◉', 'Side button is on. Hold it to talk.', 2600); return true; }
    const text = String(h.text || '').trim().slice(0, 2000);
    if (h.action !== 'say' || !text) return false;
    if (V.state !== 'idle') cancelVoice(true);
    clearTimeout(txHideT);
    // Talking to Wizard is sending: no draft, no confirm — same as the orb.
    window.__backLog = (window.__backLog || []).concat('handoff:say').slice(-30);
    runUtterance(text, 'auto');
    return true;
  };
  $('#txChips').addEventListener('click', e => { if (e.target.closest('[data-handoff="drop"]')) { $('#txChips').innerHTML = ''; txHide(0); } });
  // × on a choice card: clear it now, nothing sent. Touching the card keeps it up while James reads/picks.
  const closeChoice = () => { $('#txChips').innerHTML = ''; V.holdText = ''; V.holdOpts = null; window.__backLog = (window.__backLog || []).concat('tx:close').slice(-30); txHide(0); };
  $('#txClose').addEventListener('click', e => { e.stopPropagation(); closeChoice(); });
  tx.addEventListener('pointerdown', e => { if (!e.target.closest('#txClose') && V.holdText && $('#txChips').childElementCount) txHide(NOMATCH_MS); });
  $('#txChips').addEventListener('click', e => {
    const b = e.target.closest('[data-hold]'); if (!b) return;
    const k = b.dataset.hold, q = V.holdText || '', opts = V.holdOpts || {};
    V.holdText = ''; V.holdOpts = null; $('#txChips').innerHTML = '';
    if (k === 'search' || k === 'images') { txHide(0); openSearch(q, k === 'images' ? 'images' : 'all'); return; }
    if (k === 'agent' && q) { toAgent(q, `To ${window.WizConfig.agent()} · from a held command`, { ...opts, how: 'voice (held command, sent on purpose)' }); return; }
    txHide(0);
  });
  // Native bridge v0 (core/bridge.js): the same events drive the phone and the desktop shell.
  window.WizCore.bridge?.handle({
    orb(d) {
      const a = d.action || 'toggle';
      if (a === 'cancel') { if (V.state !== 'idle') cancelVoice(true); return 'none'; }
      if (V.state === 'think' || V.state === 'agent' || V.state === 'done') return 'busy';
      if (V.state === 'idle') { if (a === 'send') return 'none'; closeSheets(); startVoice('auto'); return 'voice'; }
      if (a === 'start') return 'voice';
      finishVoice(); return 'sent';
    },
    open(path, d) {
      closeSheets();
      const sid = d.thread || (String(path).match(/[?&]session=([^&#]+)/) || [])[1];
      if (sid) { openWizardThread(decodeURIComponent(sid)); return; }
      if (/^\/?apps\/?$/.test(path)) { openSheet('launcher'); return; }
      const a = d.app ? findApp(d.app) || APP[d.app] : /^\/wizard\/?$/.test(path) ? APP.wizard : APPS.find(x => x.url && path && x.url.replace(/[#?].*$/, '') === String(path).replace(/[#?].*$/, ''));
      if (a) openApp(a); else if (path) toast('◇', `No app for ${path}`, 1800);
    },
    dictation(text) {
      const f = W[desks[idx].focus];
      if (f?.app === 'chats' && f.thread && CHATS.insertText(f.id, text)) return;
      const el = document.activeElement; if (el && /^(TEXTAREA|INPUT)$/.test(el.tagName)) { el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); }
    },
    back() { window.__wosNativeBack(); },
  });
  mountLinks();
  // Music by voice (core/music-voice.js): the Wizard Music window is the player it drives.
  window.WosMusic?.install({
    app: () => APP['wizard-music'] || null,
    findWin: () => {
      const mine = id => W[id]?.app === 'frame' && W[id].appId === 'wizard-music';
      return desks[idx].wins.find(mine) || Object.keys(W).find(id => mine(id) && deskOf(id) >= 0) || null;
    },
    openMusic: () => { closeSheets(true); const w = placeApp(x => x.app === 'frame' && x.appId === 'wizard-music' && !x.from, { app: 'frame', appId: 'wizard-music' }); return w ? w.id : null; },
    frameOf: id => winEl(id)?.querySelector('iframe.appframe') || null,
    toast,
  });
  window.__wos = {
    get links() { return LINKS; },
    live: LIVE, openPeek, closePeek, openOverview, closeOverview, mergeDesks, splitDesk, reorderDesks, closeDesk, openLinkDesk, pinWin, openWizardThread, goDesk, openSheet, closeSheets, runUtterance, openApp, openWin, closeWin, moveWin, setFull, focusWin, openChat, sendChat, onBack, viewContext, viewOf, execute, handleText,
    zoomIn: () => { const f = desks[idx].focus; if (W[f]?.app === 'review') zoomIn(f); }, zoomOut: () => { const f = desks[idx].focus; if (W[f]?.app === 'review') zoomOut(f); },
    HOME, get idx() { return idx; }, get desks() { return desks; }, get ovLog() { return window.__ovLog || []; }, get wins() { return W; }, get voice() { return V.state; }, get sheet() { return sheet; },
    get back() { return { watchers: watchers.size, guardOn, exitArmed: Date.now() < exitUntil, log: window.__backLog || [] }; },
    openSearch,
    startVoice, finishVoice, cancelVoice, outbox: OUTBOX, openSettings, unsentAll, renderSettings,
    chats: CHATS, chat: CHATS.KIT, get viewer() { return CHATS.KIT.viewer.state; }, threadAct: CHATS.threadAct, openRowSheet: CHATS.openRowSheet,
    // web/device.js (share, recovery, update banner, hot reload) works through these.
    chatState: ch, addFiles: CHATS.addFiles, uploadFile: CHATS.uploadFile, renderChats, refreshCompose, toAgent, toast, txShow, txHide, setVoice, nativeFinish, nativeResume, get V() { return V; },
    reset() { Object.keys(localStorage).filter(k => k.startsWith('wos.')).forEach(k => localStorage.removeItem(k)); location.reload(); },
  };

  /* ---------------- banners, deep links, voice card (core/status.js, core/deeplink.js, core/voice-status.js) ---------------- */
  const chatsInFront = () => { const f = W[desks[idx].focus]; return f?.app === 'chats' && f.thread && f.thread !== '__new__' ? f.thread : ''; };
  window.WizCore.status?.attach({ openInbox: () => openSheet('inbox'), inboxOpen: () => sheet === 'inbox', current: chatsInFront });
  window.WizCore.voiceStatus?.onChange(() => { if (sheet === 'settings') renderSettings(); });
  // The list may still be loading: wait for the section (up to ~5 s), open it, bring it into view.
  function showSection(k, tries = 50) {
    if (!k) return;
    const sec = track.querySelector(`.win[data-win="${desks[idx].focus}"] [data-sec="${k}"]`);
    if (!sec) { if (tries > 0) setTimeout(() => showSection(k, tries - 1), 100); return; }
    if (!sec.classList.contains('open')) sec.querySelector('[data-sectoggle]')?.click();
    track.querySelector(`.win[data-win="${desks[idx].focus}"] [data-sec="${k}"]`)?.scrollIntoView({ block: 'start' });
  }
  window.WizCore.deeplink?.handle({
    // ?session= takes exactly the path the Android app's ACTION_THREAD intent takes.
    thread: id => window.__wosHandoff({ action: 'thread', id }),
    view(v, section) {
      if (window.WosTour?.active && v !== 'tour') window.WosTour.finish('deeplink');
      if (v === 'tour') return window.WosTour?.start('link');
      if (v === 'help') { closeSheets(true); return window.WosTour?.openHelp(); }
      closeSheets(true);
      if (v === 'home') { window.WosResources?.back(); return goDesk(0, true); }
      if (v === 'inbox') return openSheet('inbox');
      if (v === 'apps') return openSheet('launcher');
      if (v === 'store') return openApp(APP['app-store']);
      if (v === 'system') return openApp(APP.system);
      if (v === 'settings' || v === 'usage') return openSettings();
      if (v === 'skin') return openSettings('look');
      if (v === 'day' || v === 'week' || v === 'month') return openReview(v);
      if (v === 'files') { const a = findApp('files') || APP.files; if (a) return openApp(a); toast('◇', 'Files isn’t on this Wizard', 1800); return; }
      // work / chats: the Chats window, at the asked-for section.
      const here = desks.findIndex(d => d.wins.some(x => W[x].app === 'chats'));
      if (here >= 0 && here !== idx) goDesk(here, true);
      openApp(APP.wizard);
      const cw = W[desks[idx].focus]; if (cw?.app === 'chats' && cw.thread) chatsBack(cw);
      showSection(section);
    },
    app(id, srcEl) {
      // A tapped link inside a window (a Chats thread) remembers where it came from.
      const srcId = srcEl && srcEl.closest ? srcEl.closest('.win')?.dataset.win : '';
      const opts = srcId && W[srcId] ? { from: fromOf(srcId) } : {};
      const a = findApp(id) || APP[id]; if (a) return openApp(a, {}, opts);
      Promise.resolve(window.WizCore.appsLoaded?.()).then(() => { const b = findApp(id) || APP[id]; if (b) openApp(b, {}, opts); });
    },
    video: item => { closeSheets(true); return CHATS.KIT.viewer.open([item]); },
    toast,
  });
  window.WizCore.deeplink?.consume();
})();
