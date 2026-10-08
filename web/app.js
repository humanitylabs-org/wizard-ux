/* Wizard OS — home shell prototype */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vib = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
  const D = window.WIZ_DATA || { threads: [], projects: {} };
  const S = window.WIZ_SUMM || { days: {}, weeks: {}, month: '' };
  const device = $('#device');
  const TODAY = (D.generated || '2026-10-08').slice(0, 10);
  const DESKS_N = 5, HOME = 2;

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
  const P = 'https://private.wizard001.com';
  const APPS = [
    // Wizard OS views
    { id: 'v-day', kind: 'view', name: 'Day in review', icon: '☀', g: ['#ff8a5c', '#ff5ccf'], view: 'day', desc: 'What we did yesterday, by project, person and call' },
    { id: 'v-week', kind: 'view', name: 'Week in review', icon: '◐', g: ['#8f63ff', '#ff5ccf'], view: 'week', desc: 'Seven days, one compression level up' },
    { id: 'v-month', kind: 'view', name: 'Month in review', icon: '◯', g: ['#3f6bff', '#8f63ff'], view: 'month', desc: 'The arc of the last four weeks' },
    { id: 'v-inbox', kind: 'view', name: 'Inbox', icon: '⬇', g: ['#ffbe55', '#ff6b86'], view: 'inbox', desc: 'Needs you, ready for review, working' },
    // Wizard apps (live private apps)
    { id: 'wizard', kind: 'wizard', name: 'Wizard', icon: '✦', g: ['#6b46ff', '#c04dff'], url: P + '/wizard/', desc: 'Threads with Archimedes' },
    { id: 'cinequeue', kind: 'wizard', name: 'CineQueue', icon: '🎬', g: ['#ff5c7a', '#7a2bff'], url: P + '/cinequeue/', desc: 'Your watch queue' },
    { id: 'signal-feed', kind: 'wizard', name: 'Signal Feed', icon: '◎', g: ['#ff5ccf', '#5c3bff'], url: P + '/signal-feed/', desc: 'High-signal feed' },
    { id: 'wizard-signal', kind: 'wizard', name: 'Wizard Signal', icon: '📡', g: ['#a74dff', '#ff5ccf'], url: P + '/wizard-signal/', desc: 'Social signal' },
    { id: 'reader', kind: 'wizard', name: 'Reader', icon: '📖', g: ['#e9b46b', '#8a4dff'], url: P + '/reader/', desc: 'Long-form reading' },
    { id: 'recall', kind: 'wizard', name: 'Recall', icon: '◉', g: ['#3fe0ff', '#3f6bff'], url: P + '/recall/', desc: 'Voice memory' },
    { id: 'capture', kind: 'wizard', name: 'Capture', icon: '✚', g: ['#4ff0b0', '#2f8cff'], url: P + '/capture/', desc: 'Drop anything in' },
    { id: 'idea-queue', kind: 'wizard', name: 'Idea Queue', icon: '💡', g: ['#ffd65c', '#ff8a5c'], url: P + '/idea-queue/', desc: 'Ideas waiting their moment' },
    { id: 'files', kind: 'wizard', name: 'Files', icon: '🗂', g: ['#8aa0c8', '#4a5a8a'], url: P + '/files/', desc: 'Browse the server' },
    { id: 'iching', kind: 'wizard', name: 'I Ching', icon: '☯', g: ['#d8c39a', '#6a4a2a'], url: P + '/iching/', desc: 'Cast and read' },
    { id: 'trackhunt', kind: 'wizard', name: 'TrackHunt', icon: '♫', g: ['#4ff0b0', '#0d8a6a'], url: P + '/trackhunt/', desc: 'Find tracks' },
    { id: 'thai-cram', kind: 'wizard', name: 'Thai Cram', icon: 'ก', g: ['#ff6b86', '#3f6bff'], url: P + '/thai-cram/', desc: 'Thai flashcards' },
    { id: 'console', kind: 'wizard', name: 'Console', icon: '⌘', g: ['#3a3f58', '#151827'], url: P + '/console/', desc: 'Terminals' },
    { id: 'model-performance', kind: 'wizard', name: 'Model Perf', icon: '📈', g: ['#3fe0ff', '#8f63ff'], url: P + '/model-performance/', desc: 'Model routing and cost' },
    { id: 'shopping', kind: 'wizard', name: 'Shopping', icon: '🛍', g: ['#ff8a5c', '#ff5ccf'], url: P + '/shopping-assistant/', desc: 'Researched buys' },
    { id: 'storyboard', kind: 'wizard', name: 'Storyboards', icon: '🎞', g: ['#ffbe55', '#8f63ff'], url: P + '/storyboard-review/', desc: 'Storyboard review' },
    { id: 'golden-frog', kind: 'wizard', name: 'Golden Frog', icon: '🐸', g: ['#ffd65c', '#4ff0b0'], url: P + '/golden-frog-review/', desc: 'Golden Frog review' },
    { id: 'live', kind: 'wizard', name: 'Archimedes Live', icon: '🎙', g: ['#ff5ccf', '#3fe0ff'], url: P + '/archimedes-live/', desc: 'Realtime voice' },
    { id: 'social', kind: 'wizard', name: 'Wizard Social', icon: '⚇', g: ['#7c5cff', '#3fe0ff'], url: P + '/wizard-social/', desc: 'Private social' },
    { id: 'alerts', kind: 'wizard', name: 'Alerts', icon: '⚠', g: ['#ff6b86', '#8a2b4a'], url: P + '/alerts/', desc: 'System alerts' },
    // Android natives (real intents on Android Chrome)
    { id: 'maps', kind: 'native', name: 'Maps', icon: '📍', g: ['#34a853', '#4285f4'], href: 'https://www.google.com/maps', desc: 'Google Maps' },
    { id: 'camera', kind: 'native', name: 'Camera', icon: '📷', g: ['#4a4f63', '#1b1e2b'], href: 'intent:#Intent;action=android.media.action.STILL_IMAGE_CAMERA;end', desc: 'Camera' },
    { id: 'phone', kind: 'native', name: 'Phone', icon: '📞', g: ['#4ff0b0', '#13805a'], href: 'tel:', desc: 'Dialer' },
    { id: 'messages', kind: 'native', name: 'Messages', icon: '💬', g: ['#3f8cff', '#1b4ab8'], href: 'sms:', desc: 'SMS' },
    { id: 'spotify', kind: 'native', name: 'Spotify', icon: '🎧', g: ['#1ed760', '#0b5c2b'], href: 'intent://#Intent;package=com.spotify.music;end', desc: 'Music' },
    { id: 'telegram', kind: 'native', name: 'Telegram', icon: '✈', g: ['#2aabee', '#1868a8'], href: 'intent://#Intent;package=org.telegram.messenger;end', desc: 'Telegram' },
    { id: 'line', kind: 'native', name: 'LINE', icon: 'L', g: ['#06c755', '#04773a'], href: 'intent://#Intent;package=jp.naver.line.android;end', desc: 'LINE' },
    { id: 'grab', kind: 'native', name: 'Grab', icon: 'G', g: ['#00b14f', '#0a5c32'], href: 'intent://#Intent;package=com.grabtaxi.passenger;end', desc: 'Rides and food' },
    { id: 'chrome', kind: 'native', name: 'Chrome', icon: '◍', g: ['#fbbc05', '#ea4335'], href: 'https://www.google.com/', desc: 'Browser' },
    { id: 'settings', kind: 'native', name: 'Settings', icon: '⚙', g: ['#6a7088', '#2a2f42'], href: 'intent:#Intent;action=android.settings.SETTINGS;end', desc: 'Android settings' },
  ];
  const APP = Object.fromEntries(APPS.map(a => [a.id, a]));
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9ก-๙ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  function findApp(q) {
    q = norm(q).replace(/^(the|my) /, '').replace(/ (app|application|view)$/, '');
    if (!q) return null;
    const alias = { 'google maps': 'maps', map: 'maps', 'cine queue': 'cinequeue', movies: 'cinequeue', 'i ching': 'iching', 'yesterday': 'v-day', 'day review': 'v-day', 'day in review': 'v-day', 'week review': 'v-week', 'month review': 'v-month', notifications: 'v-inbox', inbox: 'v-inbox', terminal: 'console', music: 'spotify', ideas: 'idea-queue' };
    if (alias[q]) return APP[alias[q]];
    let best = null, bs = 0;
    for (const a of APPS) {
      const n = norm(a.name);
      let s = n === q ? 100 : n.startsWith(q) ? 80 : n.includes(q) ? 60 : q.includes(n) && n.length > 3 ? 50 : 0;
      if (s > bs) { bs = s; best = a; }
    }
    return bs >= 50 ? best : null;
  }

  /* ---------------- state ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('wos.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('wos.' + k, JSON.stringify(v)); } catch (e) {} },
  };
  const defaultDesks = () => [
    { kind: 'wizard' },
    { kind: 'review', z: { level: 'day', day: YESTERDAY } },
    { kind: 'home' },
    { kind: 'maps', dest: 'ICONSIAM, Bangkok', mode: 'dir' },
    { kind: 'empty' },
  ];
  let desks = store.get('desks', null);
  if (!Array.isArray(desks) || desks.length !== DESKS_N || desks[HOME]?.kind !== 'home') desks = defaultDesks();
  let idx = store.get('idx', HOME); if (!(idx >= 0 && idx < DESKS_N)) idx = HOME;
  const save = () => { store.set('desks', desks); store.set('idx', idx); };

  // Inbox seeded from real recent thread titles; states are simulated for the prototype.
  const recent = D.threads.filter(t => t.day >= YESTERDAY).sort((a, b) => (b.day + b.t).localeCompare(a.day + a.t));
  const pick = (i, fb) => recent[i] || { title: fb, id: null, p: 'wizard-os', t: '09:00', day: TODAY };
  let inbox = [
    { id: 'n1', g: 'needs', ...seedThread(pick(1, 'Approve release')), sub: 'Your call: which variant ships' },
    { id: 'n2', g: 'needs', ...seedThread(pick(4, 'Review draft')), sub: 'Draft ready; one decision left' },
    { id: 'r1', g: 'ready', ...seedThread(pick(2, 'Report ready')), sub: 'Verified result ready to read' },
    { id: 'r2', g: 'ready', ...seedThread(pick(5, 'Preview ready')), sub: 'Preview published privately' },
    { id: 'r3', g: 'ready', ...seedThread(pick(7, 'Summary ready')), sub: 'Summary finished' },
    { id: 'w1', g: 'working', title: 'Wizard OS home — this prototype', sub: 'Archimedes is building and testing', p: 'wizard-os', tm: 'now', thread: null },
    { id: 'p1', g: 'phone', src: 'Calendar', icon: '📅', gr: ['#3f8cff', '#8f63ff'], title: 'Nothing else today after 19:00', sub: 'Your evening is clear', tm: '18:00' },
    { id: 'p2', g: 'phone', src: 'Grab', icon: 'G', gr: ['#00b14f', '#0a5c32'], title: 'Your food is 8 min away', sub: 'Simulated Android notification', tm: '17:52' },
    { id: 'p3', g: 'phone', src: 'Telegram', icon: '✈', gr: ['#2aabee', '#1868a8'], title: 'Archimedes', sub: 'Morning projects brief delivered', tm: '07:02' },
  ];
  function seedThread(t) { return { title: t.title, p: t.p, tm: t.t, thread: t.id, src: D.projects[t.p] || 'Wizard' }; }

  /* ---------------- desks ---------------- */
  const track = $('#track');
  function deskTitle(d) {
    switch (d.kind) {
      case 'home': return 'Home';
      case 'review': return { month: 'Month in review', week: 'Week in review', day: 'Day in review', group: 'Day in review', thread: 'Thread' }[d.z?.level] || 'Review';
      case 'wizard': return 'Wizard';
      case 'app': return APP[d.app]?.name || 'App';
      case 'maps': return 'Maps';
      case 'agent': return 'Archimedes';
      default: return 'Empty';
    }
  }
  function head(glyph, g1, g2, title, sub) {
    return `<div class="dhead"><span class="glyph" style="--g1:${g1};--g2:${g2}">${glyph}</span><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div>
      <button class="x" data-act="clear" aria-label="Clear this desk"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;
  }
  function renderDesk(i) {
    const d = desks[i];
    switch (d.kind) {
      case 'home': return renderHome();
      case 'review': return renderReviewShell(i);
      case 'wizard': return renderWizard();
      case 'app': return renderApp(d);
      case 'maps': return renderMaps(d);
      case 'agent': return renderAgent(d);
      default: return renderEmpty(i);
    }
  }
  function buildDesks() {
    track.innerHTML = desks.map((d, i) => `<section class="desk" data-desk="${i}" aria-label="Desk ${i + 1}: ${esc(deskTitle(d))}">${renderDesk(i)}</section>`).join('');
    desks.forEach((d, i) => { if (d.kind === 'review') mountReview(i, null); });
    placeTrack(0, false); renderDots(); renderMoons();
  }
  function refreshDesk(i) {
    const el = track.children[i]; if (!el) return;
    el.innerHTML = renderDesk(i); el.setAttribute('aria-label', `Desk ${i + 1}: ${deskTitle(desks[i])}`);
    if (desks[i].kind === 'review') mountReview(i, null);
    renderDots(); save();
  }
  function placeTrack(dx, anim) {
    track.classList.toggle('anim', !!anim);
    track.style.transform = `translate3d(calc(${-idx * 100}% + ${dx}px),0,0)`;
    $('.nebula').style.transform = `translate3d(${(-idx + 2) * -3 + dx * .01}%,0,0)`;
  }
  let labelT = 0;
  function goDesk(n, silent) {
    n = Math.max(0, Math.min(DESKS_N - 1, n));
    const moved = n !== idx; idx = n; placeTrack(0, true); renderDots(); save();
    if (moved) vib(8);
    if (!silent) {
      const L = $('#deskLabel'); L.innerHTML = `Desk ${idx + 1} · <b>${esc(deskTitle(desks[idx]))}</b>`; L.classList.add('show'); document.body.classList.add('labeling');
      clearTimeout(labelT); labelT = setTimeout(() => { L.classList.remove('show'); document.body.classList.remove('labeling'); }, 1300);
    }
  }
  function renderDots() {
    const mk = i => `<button class="ddot ${desks[i].kind !== 'empty' ? 'filled' : ''} ${desks[i].busy ? 'live' : ''}" data-goto="${i}" aria-label="Desk ${i + 1}: ${esc(deskTitle(desks[i]))}"></button>`;
    $('#dotsL').innerHTML = Array.from({ length: idx }, (_, i) => mk(i)).join('');
    $('#dotsR').innerHTML = Array.from({ length: DESKS_N - 1 - idx }, (_, k) => mk(idx + 1 + k)).join('');
  }
  $('#dock').addEventListener('click', e => { const b = e.target.closest('[data-goto]'); if (b) goDesk(+b.dataset.goto); });

  /* Open something on a desk. Home stays home: opening from Home lands on the nearest empty desk. */
  function openOnDesk(obj) {
    let target = idx;
    if (desks[idx].kind === 'home') {
      const order = [3, 4, 1, 0];
      target = order.find(i => desks[i].kind === 'empty');
      if (target == null) target = 3;
    }
    desks[target] = obj; refreshDesk(target); goDesk(target);
    return target;
  }
  function openApp(a, extra) {
    if (!a) return false;
    if (a.kind === 'view') {
      if (a.view === 'inbox') { openSheet('inbox'); return true; }
      openReview(a.view, extra?.date); return true;
    }
    if (a.id === 'maps') { openOnDesk({ kind: 'maps', dest: extra?.query || '', mode: extra?.query ? 'search' : 'home' }); return true; }
    if (a.id === 'wizard') { openOnDesk({ kind: 'wizard' }); return true; }
    openOnDesk({ kind: 'app', app: a.id, query: extra?.query || '' });
    return true;
  }
  function openReview(level, date) {
    const z = level === 'month' ? { level: 'month' } : level === 'week' ? { level: 'week', week: weekOf(date || YESTERDAY) } : { level: 'day', day: date || YESTERDAY };
    let i = desks.findIndex(d => d.kind === 'review');
    if (i < 0) i = openOnDesk({ kind: 'review', z });
    else { desks[i].z = z; refreshDesk(i); goDesk(i); }
  }

  /* ---------------- home desk ---------------- */
  function renderHome() {
    const needs = inbox.filter(n => n.g === 'needs').length, working = inbox.filter(n => n.g === 'working').length, ready = inbox.filter(n => n.g === 'ready').length;
    const yd = byDay[YESTERDAY] || [];
    const now = new Date();
    return `<div class="home">
      <div class="home-top">
        <div class="home-date" id="homeDate">${DOWL[now.getDay()]} · ${now.getDate()} ${MON[now.getMonth()]}</div>
        <div class="home-time" id="homeTime">${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}</div>
        <div class="home-line"><b>${needs} need you</b>, ${ready} ready for review, ${working} agent${working === 1 ? '' : 's'} working.</div>
      </div>
      <div class="home-spacer"></div>
      <div class="constellation">
        <button class="now-card" style="--c:var(--amber)" data-act="inbox"><span class="pip"></span><span class="meta"><span class="k">Needs you</span><span class="v">${esc(inbox.find(n => n.g === 'needs')?.title || 'Nothing waiting')}</span></span><span class="n">${needs}</span></button>
        <button class="now-card" style="--c:var(--violet-2)" data-act="inbox"><span class="pip pulse"></span><span class="meta"><span class="k">Working</span><span class="v">${esc(inbox.find(n => n.g === 'working')?.title || 'Idle')}</span></span><span class="n">${working}</span></button>
        <button class="now-card" style="--c:var(--pink)" data-act="yesterday"><span class="pip"></span><span class="meta"><span class="k">Yesterday</span><span class="v">${esc(clip(S.days[YESTERDAY] || `${yd.length} threads`, 70))}</span></span><span class="n">${yd.length}</span></button>
      </div>
      <div class="hint-row">
        <button class="say" data-say="Give me directions to Iconsiam">Directions to Iconsiam</button>
        <button class="say" data-say="Show me last week">Show me last week</button>
        <button class="say" data-say="Open CineQueue">Open CineQueue</button>
        <button class="say" data-say="What did we ship on Wizard this week?">What did we ship this week?</button>
      </div>
    </div>`;
  }
  setInterval(() => {
    const now = new Date(), t = $('#homeTime'), c = $('#clock');
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (t) t.textContent = hm; if (c) c.textContent = hm;
  }, 5000);

  /* ---------------- other desks ---------------- */
  function renderEmpty(i) {
    return `<div class="empty-desk"><div><div class="ring"><span class="num">${i + 1}</span></div>
      <h3>Empty desk</h3><p>Tap the orb and say what belongs here.<br>Hold it for a quick command.</p>
      <button class="say" data-say="Open Signal Feed">Open Signal Feed</button><button class="say" data-say="Zoom out to the month">Zoom out to the month</button></div></div>`;
  }
  function renderWizard() {
    const t = D.threads.filter(x => x.day === TODAY && /launcher|wizard os|home/i.test(x.title))[0];
    return `<div class="desk-scroll thread">${head('✦', '#6b46ff', '#c04dff', 'Wizard', 'App · one thread open')}
      <div class="bubble u"><span class="who">You · ${esc(t?.t || '17:40')}</span>Mock me up an extremely sick UX for this. Floating orb, arc controls, desks, swipe up for apps, down for the inbox, pinch to zoom the reviews. Impress me.</div>
      <div class="bubble a"><span class="who">Archimedes</span>Built it. You’re standing in it: this desk is the Wizard app, running as one app inside Wizard OS. Swipe the orb left or right to change desks. Tap it and speak.</div>
      <div class="bubble a"><span class="typing"><i></i><i></i><i></i></span></div></div>`;
  }
  function renderApp(d) {
    const a = APP[d.app] || {};
    const native = a.kind === 'native';
    let href = a.url || a.href;
    if (a.id === 'spotify' && d.query) href = `spotify:search:${encodeURIComponent(d.query)}`;
    return `<div class="desk-scroll">${head(a.icon, a.g[0], a.g[1], a.name, native ? 'Android app' : 'Wizard app')}
      <div class="appcard"><div class="hero" style="--g1:${a.g[0]};--g2:${a.g[1]}"><span class="big">${a.icon}</span></div>
      <div class="body"><h3>${esc(a.name)}${d.query ? ` · “${esc(d.query)}”` : ''}</h3><p>${esc(a.desc)}${native ? '. Opens the real Android app.' : '. Live private app over Tailscale.'}</p>
      <a class="cta" href="${esc(href)}" target="${native ? '_self' : '_blank'}" rel="noopener">Open ${esc(a.name)}</a>
      <button class="cta ghost" data-act="clear">Clear this desk</button></div></div></div>`;
  }
  function renderMaps(d) {
    const q = d.dest || '';
    const link = d.mode === 'dir' ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=driving`
      : q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : 'https://www.google.com/maps';
    const roads = Array.from({ length: 9 }, (_, i) => `<path d="M${-20 + i * 55} -10 L${40 + i * 48} 360" stroke="rgba(120,140,200,.16)" stroke-width="${i % 3 ? 2 : 6}"/>`).join('') +
      Array.from({ length: 8 }, (_, i) => `<path d="M-10 ${20 + i * 46} L420 ${-10 + i * 52}" stroke="rgba(120,140,200,.13)" stroke-width="${i % 3 ? 2 : 5}"/>`).join('');
    return `<div class="desk-scroll">${head('📍', '#34a853', '#4285f4', 'Maps', d.mode === 'dir' ? 'Directions' : 'Search')}
      <div class="map"><svg viewBox="0 0 360 330" preserveAspectRatio="xMidYMid slice">
        <path d="M-10 250 C 80 230, 120 300, 210 270 S 330 250, 380 300 L380 340 L-10 340Z" fill="rgba(63,120,255,.13)"/>
        ${roads}
        ${d.mode === 'dir' ? '<path class="route" d="M70 260 C 110 210, 120 190, 170 170 S 250 120, 282 82" fill="none" stroke="#3fe0ff" stroke-width="5" stroke-linecap="round" stroke-dasharray="7 9"><animate attributeName="stroke-dashoffset" from="64" to="0" dur="1.4s" repeatCount="indefinite"/></path>' : ''}
      </svg>
      ${d.mode === 'dir' ? '<span class="me" style="left:62px;top:252px"></span>' : ''}<span class="pin" style="left:${d.mode === 'dir' ? 274 : 170}px;top:${d.mode === 'dir' ? 64 : 140}px"></span>
      <div class="eta"><b>${d.mode === 'dir' ? 'Route ready' : q ? 'Found' : 'Maps'}</b><span>${d.mode === 'dir' ? 'Live ETA comes from Google Maps' : 'Preview'}</span></div></div>
      <div class="map-dest"><span class="routebadge">⚡ Voice command</span><h3>${esc(q || 'Google Maps')}</h3><p>${d.mode === 'dir' ? 'Driving directions' : 'Search results'} · opens the real Maps app on Android</p></div>
      <a class="cta" href="${esc(link)}" rel="noopener">${d.mode === 'dir' ? 'Start navigation in Maps' : 'Open in Maps'}</a>
      <button class="cta ghost" data-act="clear">Clear this desk</button></div>`;
  }
  function renderAgent(d) {
    return `<div class="desk-scroll thread">${head('✦', '#8f63ff', '#ff5ccf', 'Archimedes', 'New thread from voice')}
      <div class="bubble u"><span class="who">You · just now</span>${esc(d.text)}</div>
      ${d.reply ? `<div class="bubble a"><span class="who">Archimedes</span>${esc(d.reply)}</div>` : '<div class="bubble a"><span class="typing"><i></i><i></i><i></i></span></div>'}</div>`;
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
        ${t.u ? `<div class="bubble u"><span class="who">You</span>${esc(t.u)}</div>` : ''}${t.a ? `<div class="bubble a"><span class="who">Archimedes</span>${esc(t.a)}</div>` : ''}
        ${!t.u && !t.a ? '<div class="bubble a"><span class="who">Archimedes</span>The transcript lives in Hermes. The real build streams it in here, one more zoom level down.</div>' : '<div class="sec-title"><span>Opening exchange · full transcript lives in Hermes</span></div>'}`;
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
  function mountReview(i, dir, origin) {
    const root = track.children[i]?.querySelector('.review'); if (!root) return;
    const z = desks[i].z || { level: 'day', day: YESTERDAY };
    const stage = $('.zstage', root);
    const li = LEVELS.indexOf(z.level);
    $$('.lvl', root).forEach((b, k) => { b.classList.toggle('on', k === li); b.classList.toggle('past', k < li); });
    const ch = chain(z);
    const crumbEl = $('.crumb', root); crumbEl.innerHTML = ch.map((c, k) => `${k ? '<i>›</i>' : ''}<button data-crumb="${k}">${esc(crumbLabel(c))}</button>`).join(''); crumbEl.scrollLeft = crumbEl.scrollWidth;
    root._chain = ch;
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
    bindPinch(stage, i);
  }
  function setZ(i, z, dir, origin) {
    desks[i].z = z; save(); mountReview(i, dir, origin);
    track.children[i].setAttribute('aria-label', `Desk ${i + 1}: ${deskTitle(desks[i])}`);
    vib(dir === 'in' ? 10 : 6);
  }
  function zoomIn(i, card) {
    const stage = track.children[i].querySelector('.zstage');
    card = card || stage.querySelector('.zlayer:last-child [data-z]');
    if (!card) return bounce(stage);
    const r = card.getBoundingClientRect(), s = stage.getBoundingClientRect();
    setZ(i, JSON.parse(card.dataset.z), 'in', { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 });
  }
  function zoomOut(i) {
    const p = parentOf(desks[i].z);
    if (!p) return bounce(track.children[i].querySelector('.zstage'));
    setZ(i, p, 'out');
  }
  function bounce(stage) { const l = stage.querySelector('.zlayer:last-child'); if (!l) return; l.animate([{ transform: 'scale(1)' }, { transform: 'scale(.96)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' }); }

  function bindPinch(stage, i) {
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
      if (q.s > 1.22) { q.layer.style.transform = ''; q.layer.style.opacity = ''; zoomIn(i, q.card); }
      else if (q.s < .82) { q.layer.style.transform = ''; q.layer.style.opacity = ''; zoomOut(i); }
      else { q.layer.animate([{ transform: q.layer.style.transform }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.2,.9,.25,1)' }); q.layer.style.transform = ''; q.layer.style.opacity = ''; }
      const h = stage.parentElement.querySelector('.pinch-hint'); if (h) h.classList.add('gone');
    };
    stage.addEventListener('touchend', e => { if (p && e.touches.length < 2) end(); });
    stage.addEventListener('touchcancel', end);
    // trackpad pinch / ctrl+wheel on desktop
    let acc = 0, wt = 0;
    stage.addEventListener('wheel', e => {
      if (!e.ctrlKey) return; e.preventDefault(); acc += -e.deltaY;
      clearTimeout(wt); wt = setTimeout(() => {
        if (acc > 40) { const el = document.elementFromPoint(e.clientX, e.clientY); zoomIn(i, el && el.closest('.zlayer:last-child [data-z]')); }
        else if (acc < -40) zoomOut(i);
        acc = 0;
      }, 90);
    }, { passive: false });
  }

  /* ---------------- desk clicks ---------------- */
  track.addEventListener('click', e => {
    const deskEl = e.target.closest('.desk'); if (!deskEl) return; const i = +deskEl.dataset.desk;
    const zc = e.target.closest('[data-z]'); if (zc) return zoomIn(i, zc);
    const rail = e.target.closest('[data-rail]');
    if (rail) { const want = LEVELS.indexOf(rail.dataset.rail); const ch = track.children[i].querySelector('.review')._chain; if (want < ch.length - 1) setZ(i, ch[want], 'out'); else if (want > ch.length - 1) zoomIn(i); return; }
    const cr = e.target.closest('[data-crumb]');
    if (cr) { const ch = track.children[i].querySelector('.review')._chain; const k = +cr.dataset.crumb; if (k < ch.length - 1) setZ(i, ch[k], 'out'); return; }
    const say = e.target.closest('[data-say]'); if (say) return runUtterance(say.dataset.say, 'auto');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') { desks[i] = { kind: 'empty' }; refreshDesk(i); toast('◌', 'Desk cleared'); }
    else if (act === 'inbox') openSheet('inbox');
    else if (act === 'yesterday') openReview('day', YESTERDAY);
  });

  /* ---------------- sheets ---------------- */
  const launcher = $('#launcher'), inboxEl = $('#inbox');
  let sheet = null;
  const sheetOpen = () => !!sheet;
  function openSheet(which, q) {
    closeSheets(true);
    sheet = which; device.classList.add('sheet-open');
    if (which === 'launcher') { renderLauncher(q || ''); launcher.classList.add('open'); const s = $('#search'); s.value = q || ''; }
    else { renderInbox(); inboxEl.classList.add('open'); }
    [launcher, inboxEl].forEach(el => { el.style.transform = ''; el.style.opacity = ''; });
    vib(6);
  }
  function closeSheets(quiet) {
    if (!sheet && quiet) return;
    sheet = null; device.classList.remove('sheet-open');
    launcher.classList.remove('open'); inboxEl.classList.remove('open');
    [launcher, inboxEl].forEach(el => { el.style.transform = ''; el.style.opacity = ''; });
    $('#search').blur();
  }
  $('#scrim').addEventListener('click', () => closeSheets());

  function appTile(a) { return `<button class="lapp" data-app="${a.id}"><span class="ic" style="--g1:${a.g[0]};--g2:${a.g[1]}">${a.icon}${a.kind === 'native' ? '<span class="badge">APK</span>' : ''}</span><span class="nm">${esc(a.name)}</span></button>`; }
  function appRow(a, sel) { const k = a.kind === 'view' ? 'view' : a.kind === 'native' ? 'native' : 'app'; return `<button class="lrow ${sel ? 'sel' : ''}" data-app="${a.id}"><span class="ic" style="--g1:${a.g[0]};--g2:${a.g[1]}">${a.icon}</span><span class="nm">${esc(a.name)}<small>${esc(a.desc)}</small></span><span class="kind ${k}">${k === 'native' ? 'Android' : k === 'view' ? 'View' : 'Wizard'}</span></button>`; }
  function renderLauncher(q) {
    const body = $('#launcherBody');
    q = q.trim();
    if (!q) {
      const recentIds = store.get('recent', ['v-day', 'cinequeue', 'maps', 'signal-feed']).filter(id => APP[id]).slice(0, 4);
      body.innerHTML = `
        <div class="lgroup"><h4>Recent</h4><div class="lgrid">${recentIds.map(id => appTile(APP[id])).join('')}</div></div>
        <div class="lgroup"><h4>Views <span>zoomable</span></h4><div class="lgrid">${APPS.filter(a => a.kind === 'view').map(appTile).join('')}</div></div>
        <div class="lgroup"><h4>Wizard apps <span>${APPS.filter(a => a.kind === 'wizard').length}</span></h4><div class="lgrid">${APPS.filter(a => a.kind === 'wizard').map(appTile).join('')}</div></div>
        <div class="lgroup"><h4>Android <span>native</span></h4><div class="lgrid">${APPS.filter(a => a.kind === 'native').map(appTile).join('')}</div></div>`;
      body.scrollTop = body.scrollHeight;
      return;
    }
    const n = norm(q);
    const hits = APPS.map(a => { const nm = norm(a.name), ds = norm(a.desc); const s = nm.startsWith(n) ? 3 : nm.includes(n) ? 2 : ds.includes(n) ? 1 : 0; return [s, a]; }).filter(x => x[0]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    const th = D.threads.filter(t => norm(t.title).includes(n)).slice(-4).reverse();
    body.innerHTML = `${hits.length ? `<div class="lgroup"><h4>Apps &amp; views</h4>${hits.slice(0, 7).map((a, k) => appRow(a, k === 0)).join('')}</div>` : ''}
      ${th.length ? `<div class="lgroup"><h4>Threads</h4>${th.map(t => `<button class="lrow" data-thread="${t.id}"><span class="ic" style="--g1:${PCOL[t.p]};--g2:#2a1a5a">${PICON[t.p]}</span><span class="nm">${esc(t.title)}<small>${fmtDay(t.day)} · ${esc(D.projects[t.p])}</small></span><span class="kind view">Thread</span></button>`).join('')}</div>` : ''}
      <div class="lgroup"><h4>Command</h4><button class="lrow ${hits.length ? '' : 'sel'}" data-cmd="${esc(q)}"><span class="ic" style="--g1:#0fb8d8;--g2:#2a3a8a">⚡</span><span class="nm">“${esc(q)}”<small>Run through the fast router</small></span><span class="kind cmd">Run</span></button></div>`;
    body.scrollTop = body.scrollHeight;
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
    const t = e.target.closest('[data-thread]'); if (t) { closeSheets(); return openThread(t.dataset.thread); }
    const c = e.target.closest('[data-cmd]'); if (c) { closeSheets(); runUtterance(c.dataset.cmd, 'command', true); }
  });
  function openThread(id) {
    const t = byId[id]; if (!t) return;
    let i = desks.findIndex(d => d.kind === 'review');
    const z = { level: 'thread', day: t.day, id, from: { type: 'project', key: t.p } };
    if (i < 0) i = openOnDesk({ kind: 'review', z }); else { desks[i].z = z; refreshDesk(i); goDesk(i); }
  }

  const GROUPS = [
    { g: 'phone', name: 'Phone', c: '#8aa0c8' },
    { g: 'working', name: 'Working', c: 'var(--violet-2)' },
    { g: 'ready', name: 'Ready for review', c: 'var(--green)' },
    { g: 'needs', name: 'Needs you', c: 'var(--amber)' },
  ];
  function renderInbox() {
    // Most urgent sits lowest: closest to the thumb and the orb.
    $('#inboxBody').innerHTML = `<div class="push"></div>` + GROUPS.map(G => {
      const items = inbox.filter(n => n.g === G.g); if (!items.length) return '';
      return `<div class="ibx-h" style="--c:${G.c}"><h4><i></i>${G.name}</h4><span>${items.length}</span></div>` + items.map(n =>
        `<button class="note ${n.g === 'working' ? 'working' : ''} ${n.fresh ? 'fresh' : ''}" data-note="${n.id}"><span class="ic" style="--g1:${n.gr ? n.gr[0] : PCOL[n.p] || '#6b46ff'};--g2:${n.gr ? n.gr[1] : '#2a1a5a'}">${n.icon || PICON[n.p] || '✦'}</span>
          <span class="bd"><span class="tp"><span class="src">${esc(n.src || D.projects[n.p] || 'Wizard')}</span><span class="tm">${esc(n.tm || '')}</span></span><span class="ti">${esc(n.title)}</span><span class="sb">${esc(n.sub || '')}</span></span></button>`).join('');
    }).join('') + `<div class="sec-title" style="justify-content:center;margin:10px 0 4px"><span>Swipe right to clear · states simulated</span></div>`;
    inbox.forEach(n => n.fresh = false);
    const b = $('#inboxBody'); b.scrollTop = b.scrollHeight;
  }
  // tap opens, swipe right dismisses
  let ns = null;
  inboxEl.addEventListener('pointerdown', e => { const el = e.target.closest('.note'); if (el) ns = { el, x: e.clientX, y: e.clientY, dx: 0 }; });
  inboxEl.addEventListener('pointermove', e => { if (!ns) return; ns.dx = e.clientX - ns.x; if (Math.abs(e.clientY - ns.y) > 20 && Math.abs(ns.dx) < 20) { ns.el.style.transform = ''; ns = null; return; } if (ns.dx > 0) ns.el.style.transform = `translateX(${ns.dx}px)`; });
  inboxEl.addEventListener('pointerup', () => {
    if (!ns) return; const { el, dx } = ns; ns = null;
    const id = el.dataset.note;
    if (dx > 90) { el.classList.add('gone'); vib(8); setTimeout(() => { inbox = inbox.filter(n => n.id !== id); renderInbox(); renderMoons(); refreshHome(); }, 240); return; }
    el.style.transform = '';
    if (Math.abs(dx) < 8) {
      const n = inbox.find(x => x.id === id); if (!n) return;
      if (n.thread) { closeSheets(); openThread(n.thread); }
      else if (n.agentDesk != null) { closeSheets(); goDesk(n.agentDesk); }
    }
  });
  inboxEl.addEventListener('pointercancel', () => { if (ns) ns.el.style.transform = ''; ns = null; });
  const refreshHome = () => { if (desks[HOME].kind === 'home') { const el = track.children[HOME]; if (el) el.innerHTML = renderHome(); } };

  function renderMoons() {
    const m = inbox.filter(n => n.g === 'working' || n.g === 'needs').slice(0, 6);
    $('#moons').innerHTML = m.map((n, k) => { const a = (k / Math.max(m.length, 1)) * Math.PI * 2 - Math.PI / 2, r = 74; const c = n.g === 'working' ? 'var(--violet-2)' : 'var(--amber)';
      return `<i style="--c:${c};transform:translate(${(Math.cos(a) * r).toFixed(1)}px,${(Math.sin(a) * r).toFixed(1)}px)"></i>`; }).join('');
  }

  /* ---------------- toast ---------------- */
  let toastT = 0;
  function toast(icon, text, ms = 2200) {
    const t = $('#toast'); t.innerHTML = `<span class="ti">${icon}</span><span>${text}</span>`; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ---------------- voice ---------------- */
  const V = { state: 'idle', kind: 'auto', route: store.get('route', 'auto'), rec: null, stream: null, chunks: [], ac: null, an: null, t0: 0, acc: 0, raf: 0, sim: false, stopAsked: false, cancelled: false, simText: '' };
  const voiceEl = $('#voice'), tx = $('#transcript');
  function setVoice(s) {
    V.state = s; device.dataset.voice = s;
    Orb.setMode({ idle: 'idle', listen: 'listen', command: 'command', paused: 'paused', think: 'think', done: 'done', agent: 'agent' }[s] || 'idle');
    voiceEl.classList.toggle('on', s === 'listen' || s === 'paused');
    voiceEl.classList.toggle('cmd', s === 'command' || (V.kind === 'command' && s !== 'idle'));
    voiceEl.setAttribute('aria-hidden', String(s === 'idle'));
  }
  function setRouteBtn() {
    const b = $('#arcRoute'); b.dataset.route = V.route;
    $('#routeGlyph').textContent = V.route === 'auto' ? 'A' : '✦';
    $('#routeLabel').textContent = V.route === 'auto' ? 'Auto' : 'Agent';
  }
  setRouteBtn();
  function txShow(text, label, cls, icon) {
    tx.className = 'transcript ' + (cls || '');
    $('#txRouteIcon').textContent = icon || '✦';
    $('#txRouteText').innerHTML = label || '';
    $('#txText').textContent = text || '';
    $('#txChips').innerHTML = '';
    voiceEl.classList.add('tx');
  }
  let txHideT = 0;
  function txHide(ms) { clearTimeout(txHideT); txHideT = setTimeout(() => { voiceEl.classList.remove('tx'); }, ms || 0); }
  const fmtT = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function tick() {
    const el = V.acc + (V.state === 'listen' || V.state === 'command' ? performance.now() - V.t0 : 0);
    $('#timer').textContent = fmtT(el);
    if (V.an) {
      const a = new Uint8Array(V.an.fftSize); V.an.getByteTimeDomainData(a);
      let s = 0; for (let k = 0; k < a.length; k++) { const v = (a[k] - 128) / 128; s += v * v; }
      Orb.setLevel(V.state === 'paused' ? 0 : Math.min(1, Math.sqrt(s / a.length) * 4.2));
    } else if (V.sim) Orb.setLevel(V.state === 'paused' ? 0 : .25 + .25 * Math.sin(performance.now() / 160) * Math.sin(performance.now() / 410));
    tx.style.setProperty('--lvl', (V.an || V.sim) ? 0.4 : 0);
    if (V.state !== 'idle' && V.state !== 'think') V.raf = requestAnimationFrame(tick);
  }
  async function startVoice(kind) {
    if (V.state !== 'idle') return;
    clearTimeout(txHideT);
    Object.assign(V, { kind, chunks: [], acc: 0, t0: performance.now(), sim: false, stopAsked: false, cancelled: false, an: null, simText: '' });
    setVoice(kind === 'command' ? 'command' : 'listen');
    shock();
    const label = kind === 'command' ? 'Command · release to run' : V.route === 'agent' ? 'To Archimedes · tap orb to send' : 'Listening · tap orb to send';
    txShow('', label, kind === 'command' ? 'command' : '', kind === 'command' ? '⚡' : '✦');
    V.raf = requestAnimationFrame(tick);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('nomic');
      V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (V.cancelled || V.state === 'idle') { stopStream(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; V.ac = new AC();
      const src = V.ac.createMediaStreamSource(V.stream); V.an = V.ac.createAnalyser(); V.an.fftSize = 1024; src.connect(V.an);
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m)) || '';
      V.rec = new MediaRecorder(V.stream, mime ? { mimeType: mime } : undefined);
      V.rec.ondataavailable = e => { if (e.data && e.data.size) V.chunks.push(e.data); };
      V.rec.onstop = onRecStop;
      V.rec.start(250);
      if (V.stopAsked) finishVoice();
    } catch (err) {
      V.sim = true;
      $('#txRouteText').textContent = kind === 'command' ? 'No mic here · tap a command' : 'No mic here · tap a line to simulate';
      const ex = kind === 'command'
        ? ['Open CineQueue', 'Zoom out', 'Next desk', 'Directions to Bangkok airport']
        : ['Show me yesterday', 'Directions to Iconsiam', 'Play something chill on Spotify', 'What did we ship on Wizard this week?'];
      $('#txChips').innerHTML = `<span class="lbl">Try</span>` + ex.map(x => `<button data-sim="${esc(x)}">${esc(x)}</button>`).join('');
      if (V.stopAsked) { cancelVoice(true); }
    }
  }
  $('#txChips').addEventListener('click', e => { const b = e.target.closest('[data-sim]'); if (!b) return; const k = V.kind; cancelVoice(true); runUtterance(b.dataset.sim, k); });
  function stopStream() { try { V.stream && V.stream.getTracks().forEach(t => t.stop()); } catch (e) {} try { V.ac && V.ac.close(); } catch (e) {} V.stream = null; V.ac = null; V.an = null; }
  function finishVoice() {
    if (V.state === 'idle' || V.state === 'think') return;
    if (V.sim) { if (V.kind === 'command') cancelVoice(true); else toast('✦', 'Tap a line above to simulate'); return; }
    if (!V.rec) { V.stopAsked = true; return; }
    if (V.state !== 'paused') V.acc += performance.now() - V.t0;
    setVoice('think'); $('#txRouteText').textContent = 'Transcribing · Wizard Voice Core';
    try { V.rec.state !== 'inactive' && V.rec.stop(); } catch (e) { onRecStop(); }
  }
  function cancelVoice(quiet) {
    V.cancelled = true;
    try { V.rec && V.rec.state !== 'inactive' && (V.rec.onstop = null, V.rec.stop()); } catch (e) {}
    stopStream(); V.rec = null; V.sim = false; cancelAnimationFrame(V.raf); Orb.setLevel(0);
    setVoice('idle'); txHide(quiet ? 0 : 0);
    if (!quiet) { toast('✕', 'Discarded'); vib(12); }
  }
  async function onRecStop() {
    const blob = new Blob(V.chunks, { type: V.rec?.mimeType || 'audio/webm' });
    stopStream(); V.rec = null; Orb.setLevel(0);
    if (V.cancelled) return;
    if (V.acc < 450 || blob.size < 1200) { setVoice('idle'); txHide(); toast('◌', V.kind === 'command' ? 'Hold, speak, release' : 'Didn’t catch that'); return; }
    try {
      const fd = new FormData();
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      fd.append('file', blob, `voice.${ext}`); fd.append('language', 'en');
      fd.append('prompt', 'Wizard OS voice command. Names: Archimedes, Wizard, Hermes, Iconsiam, Siam Paragon, Sukhumvit, Suvarnabhumi, Don Mueang, Thonglor, Asok, Grab, LINE, ' + APPS.map(a => a.name).slice(0, 40).join(', '));
      const r = await fetch('api/transcribe', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      const text = (j.text || '').trim();
      if (!text) { setVoice('idle'); txHide(); toast('◌', 'No speech detected'); return; }
      handleText(text, V.kind, false, j.ms);
    } catch (err) {
      setVoice('idle');
      txShow('', 'Transcription failed', 'agent', '!'); $('#txText').textContent = String(err.message || err).slice(0, 120); txHide(3200);
    }
  }
  $('#arcCancel').addEventListener('click', () => cancelVoice());
  $('#arcPause').addEventListener('click', () => {
    if (V.state === 'listen') { V.acc += performance.now() - V.t0; try { V.rec && V.rec.pause(); } catch (e) {} setVoice('paused'); $('#txRouteText').textContent = 'Paused'; vib(6); }
    else if (V.state === 'paused') { V.t0 = performance.now(); try { V.rec && V.rec.resume(); } catch (e) {} setVoice('listen'); $('#txRouteText').textContent = V.route === 'agent' ? 'To Archimedes · tap orb to send' : 'Listening · tap orb to send'; V.raf = requestAnimationFrame(tick); vib(6); }
  });
  $('#arcRoute').addEventListener('click', () => {
    V.route = V.route === 'auto' ? 'agent' : 'auto'; store.set('route', V.route); setRouteBtn(); vib(6);
    if (V.state === 'listen' || V.state === 'paused') $('#txRouteText').textContent = V.route === 'agent' ? 'Straight to Archimedes' : 'Auto: commands run, the rest goes to Archimedes';
  });

  /* Typed or simulated utterance, same pipeline as voice */
  async function runUtterance(text, kind, typed) {
    clearTimeout(txHideT); V.kind = kind || 'auto';
    txShow('', typed ? 'Typed' : 'Heard', kind === 'command' ? 'command' : '', kind === 'command' ? '⚡' : '✦');
    setVoice('think'); shock();
    const el = $('#txText'); let k = 0;
    await new Promise(res => { const step = () => { k += Math.max(1, Math.round(text.length / 18)); el.textContent = text.slice(0, k); if (k < text.length) setTimeout(step, 22); else res(); }; step(); });
    handleText(text, kind, typed);
  }

  /* ---------------- routing ---------------- */
  function localParse(t) {
    const s = norm(t).replace(/^(hey |ok |okay )?(wizard|archimedes)[, ]*/, '').replace(/ please$/, '');
    if (/^(zoom|go|dive) (in|deeper|down)\b/.test(s)) return { action: 'zoom', dir: 'in' };
    if (/^(zoom|back|go|pull) (out|up|back)\b|^zoom out\b/.test(s)) {
      const lv = /month/.test(s) ? 'month' : /week/.test(s) ? 'week' : null;
      return lv ? { action: 'open_view', view: lv } : { action: 'zoom', dir: 'out' };
    }
    if (/^(next|right) desk|^desk (right|next)/.test(s)) return { action: 'desk', to: 'next' };
    if (/^(previous|prev|left|last) desk|^desk (left|back)/.test(s)) return { action: 'desk', to: 'prev' };
    if (/^(go )?home( screen| desk)?$/.test(s)) return { action: 'desk', to: 'home' };
    if (/^(clear|close) (this |the )?(desk|app|screen)$/.test(s)) return { action: 'clear_desk' };
    if (/^(show |open )?(my )?(inbox|notifications)$/.test(s)) return { action: 'open_view', view: 'inbox' };
    if (/^(show |open )?(my )?(apps|app list|launcher|all apps)$/.test(s)) return { action: 'open_view', view: 'apps' };
    let m = s.match(/^(?:open|launch|show|start|go to|switch to)\s+(?:me\s+)?(.+)$/);
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
  async function handleText(text, kind, typed, sttMs) {
    const sttNote = sttMs ? ` · heard in ${sttMs} ms` : '';
    $('#txText').textContent = text;
    if (kind !== 'command' && V.route === 'agent') return toAgent(text, 'Straight to Archimedes' + sttNote);
    const t0 = performance.now();
    const loc = localParse(text);
    if (loc) {
      const ms = Math.max(1, Math.round(performance.now() - t0));
      showRouted('command', `Command · on-device · ${ms} ms${sttNote}`);
      return finishCmd(loc, text);
    }
    setVoice('think'); $('#txRouteText').textContent = 'Routing · DeepSeek Flash';
    try {
      const r = await fetch('api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, force: kind === 'command' ? 'command' : '', apps: APPS.filter(a => a.kind !== 'view').map(a => a.name) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'router');
      const c = j.cmd || {};
      if (c.route === 'command') {
        showRouted('command', `Command · DeepSeek Flash · ${j.ms} ms${sttNote}`);
        const ran = finishCmd(c, text);
        if (c.then_agent) setTimeout(() => toAgent(String(c.then_agent), `Opened ${c.app || 'app'} · follow-up to Archimedes`, String(c.then_agent)), 1500);
        return ran;
      }
      return toAgent(text, `To Archimedes · routed in ${j.ms} ms${sttNote}`, c.summary);
    } catch (e) {
      return toAgent(text, 'Router offline · sent to Archimedes');
    }
  }
  function showRouted(kind, label) {
    tx.className = 'transcript ' + kind; $('#txRouteIcon').textContent = kind === 'command' ? '⚡' : '✦'; $('#txRouteText').textContent = label;
  }
  function finishCmd(c, text) {
    setVoice('done'); vib([8, 40, 8]);
    const ok = execute(c, text);
    if (!ok) { $('#txRouteText').textContent += ' · no match'; }
    setTimeout(() => { if (V.state === 'done') setVoice('idle'); }, 900);
    txHide(ok ? 1300 : 3200);
  }
  function execute(c, text) {
    const a = String(c.action || '').toLowerCase();
    const arg = c.app || c.target || c.destination || c.query || c.view || '';
    if (/direction|navigat|route/.test(a)) { closeSheets(); openOnDesk({ kind: 'maps', dest: c.destination || c.target || c.query || text, mode: 'dir' }); return true; }
    if (/maps_search|map/.test(a)) { closeSheets(); openOnDesk({ kind: 'maps', dest: c.query || c.target || text, mode: 'search' }); return true; }
    if (/music|play/.test(a)) { closeSheets(); openOnDesk({ kind: 'app', app: 'spotify', query: c.query || c.target || '' }); return true; }
    if (a === 'zoom') {
      let i = desks.findIndex((d, k) => k === idx && d.kind === 'review');
      if (i < 0) { i = desks.findIndex(d => d.kind === 'review'); if (i < 0) { openReview('day'); return true; } goDesk(i); }
      setTimeout(() => (c.dir === 'out' ? zoomOut(i) : zoomIn(i)), 200); return true;
    }
    if (a === 'desk') {
      const to = c.to; closeSheets();
      if (to === 'next') goDesk(idx + 1); else if (to === 'prev') goDesk(idx - 1); else if (to === 'home') goDesk(HOME); else if (+to >= 1) goDesk(+to - 1);
      return true;
    }
    if (a === 'clear_desk') { if (idx !== HOME) { desks[idx] = { kind: 'empty' }; refreshDesk(idx); } return true; }
    if (a === 'search') { openSheet('launcher', c.query || text); return true; }
    if (a === 'open_view' || a === 'view' || a === 'show') {
      const v = String(c.view || arg).toLowerCase();
      if (/inbox|notif/.test(v)) { openSheet('inbox'); return true; }
      if (/apps|launcher/.test(v)) { openSheet('launcher'); return true; }
      closeSheets(); openReview(/month/.test(v) ? 'month' : /week/.test(v) ? 'week' : 'day', c.date); return true;
    }
    if (/open|launch|app/.test(a)) {
      const app = findApp(arg); closeSheets();
      if (app) { openApp(app); return true; }
      openSheet('launcher', arg); return false;
    }
    openSheet('launcher', text); return false;
  }
  function toAgent(text, label, summary) {
    showRouted('agent', label); setVoice('agent'); vib(10);
    const id = 'a' + Date.now();
    let deskI = null;
    if (desks[idx].kind === 'empty') { deskI = idx; desks[idx] = { kind: 'agent', text, busy: true }; refreshDesk(idx); }
    inbox.push({ id, g: 'working', title: summary || clip(text, 60), sub: 'Archimedes is on it', p: 'wizard-os', tm: 'now', fresh: true, agentDesk: deskI });
    renderMoons(); refreshHome(); renderDots();
    setTimeout(() => { setVoice('idle'); }, 1200);
    txHide(2400);
    toast('✦', 'Sent to Archimedes · <b>prototype, not delivered</b>', 2600);
    setTimeout(() => {
      const n = inbox.find(x => x.id === id); if (!n) return;
      n.g = 'ready'; n.sub = 'Prototype reply ready'; n.fresh = true; n.tm = 'just now';
      if (deskI != null && desks[deskI].kind === 'agent') { desks[deskI].busy = false; desks[deskI].reply = 'In the real build this request goes to me in Wizard and this desk becomes our thread. Here it stayed on your phone.'; refreshDesk(deskI); }
      renderMoons(); refreshHome(); renderDots(); if (sheet === 'inbox') renderInbox();
      toast('✓', 'Ready for review · swipe down on the orb', 2400);
    }, 6500);
  }

  /* ---------------- orb gestures ---------------- */
  const orbWrap = $('#orbWrap');
  let G = null;
  function shock() { const s = $('.orb-shock'); s.classList.remove('go'); void s.offsetWidth; s.classList.add('go'); }
  orbWrap.addEventListener('contextmenu', e => e.preventDefault());
  orbWrap.addEventListener('pointerdown', e => {
    if (V.state === 'think' || V.state === 'agent' || V.state === 'done') return;
    e.preventDefault(); orbWrap.setPointerCapture(e.pointerId);
    G = { x: e.clientX, y: e.clientY, t: performance.now(), mode: 'pending', dx: 0, dy: 0 };
    Orb.press(true);
    if (V.state === 'idle' && !sheet) G.hold = setTimeout(() => { if (G && G.mode === 'pending') { G.mode = 'hold'; G.holdAt = performance.now(); vib(18); startVoice('command'); } }, 380);
  });
  orbWrap.addEventListener('pointermove', e => {
    if (!G) return; G.dx = e.clientX - G.x; G.dy = e.clientY - G.y;
    // A hold that starts travelling soon after it fired was really a swipe (slow frame ate the moves).
    if (G.mode === 'hold' && G.holdAt && performance.now() - G.holdAt < 900 && Math.hypot(G.dx, G.dy) > 34) {
      cancelVoice(true); G.mode = 'pending';
    }
    if (G.mode === 'pending' && Math.hypot(G.dx, G.dy) > 14 && V.state === 'idle') {
      clearTimeout(G.hold); G.mode = Math.abs(G.dx) > Math.abs(G.dy) ? 'h' : 'v'; orbWrap.classList.add('dragging');
    }
    if (G.mode === 'h' && !sheet) {
      let dx = G.dx; if ((idx === 0 && dx > 0) || (idx === DESKS_N - 1 && dx < 0)) dx *= .28;
      placeTrack(dx * 1.1, false);
      orbWrap.dataset.dir = Math.abs(G.dx) > 50 ? (G.dx < 0 ? (idx < DESKS_N - 1 ? `Desk ${idx + 2} →` : '') : (idx > 0 ? `← Desk ${idx}` : '')) : '';
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
    clearTimeout(g.hold); Orb.press(false); orbWrap.classList.remove('dragging'); orbWrap.dataset.dir = '';
    const vt = (performance.now() - g.t) || 1;
    if (g.mode === 'pending' && !cancelled) {
      if (sheet) return closeSheets();
      if (V.state === 'idle') return startVoice('auto');
      if (V.state === 'listen' || V.state === 'paused') { shock(); return finishVoice(); }
    } else if (g.mode === 'hold') {
      // Stalled frames can let the hold timer win a swipe; big travel right after the hold fired means swipe.
      if (!cancelled && g.holdAt && performance.now() - g.holdAt < 900 && Math.hypot(g.dx, g.dy) > 60) {
        cancelVoice(true);
        if (Math.abs(g.dx) > Math.abs(g.dy)) { if (!sheet) goDesk(idx + (g.dx < 0 ? 1 : -1)); }
        else if (!sheet) openSheet(g.dy < 0 ? 'launcher' : 'inbox');
        return;
      }
      return cancelled ? cancelVoice(true) : finishVoice();
    } else if (g.mode === 'h') {
      if (sheet) return;
      const v = g.dx / vt;
      if (g.dx < -60 || v < -.5) goDesk(idx + 1); else if (g.dx > 60 || v > .5) goDesk(idx - 1); else placeTrack(0, true);
    } else if (g.mode === 'v') {
      [launcher, inboxEl].forEach(el => el.classList.remove('dragging'));
      launcher._rendered = inboxEl._rendered = false;
      if (sheet) { if ((sheet === 'launcher' && g.dy > 40) || (sheet === 'inbox' && g.dy < -40)) closeSheets(); else if (Math.abs(g.dy) > 40) openSheet(g.dy < 0 ? 'launcher' : 'inbox'); return; }
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

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') closeSheets(); return; }
    if (e.key === 'ArrowRight') goDesk(idx + 1);
    else if (e.key === 'ArrowLeft') goDesk(idx - 1);
    else if (e.key === 'ArrowUp') { sheet === 'inbox' ? closeSheets() : openSheet('launcher'); }
    else if (e.key === 'ArrowDown') { sheet === 'launcher' ? closeSheets() : openSheet('inbox'); }
    else if (e.key === 'Escape') { if (V.state !== 'idle') cancelVoice(); else closeSheets(); }
    else if ((e.key === '+' || e.key === '=') && desks[idx].kind === 'review') zoomIn(idx);
    else if (e.key === '-' && desks[idx].kind === 'review') zoomOut(idx);
    else if (e.key === '/') { e.preventDefault(); openSheet('launcher'); setTimeout(() => $('#search').focus(), 50); }
  });

  /* ---------------- starfield ---------------- */
  (function stars() {
    const c = $('#stars'), x = c.getContext('2d'); let W, H, pts = [];
    function size() { const r = Math.min(devicePixelRatio || 1, 2); W = c.width = c.clientWidth * r; H = c.height = c.clientHeight * r;
      pts = Array.from({ length: 170 }, () => ({ x: Math.random() * W * 1.4, y: Math.random() * H, r: Math.random() * 1.3 * r + .2, p: Math.random() * 6.28, s: .4 + Math.random() * 1.4, d: Math.random() })); }
    size(); addEventListener('resize', size);
    let last = 0;
    (function f(t) {
      requestAnimationFrame(f); if (t - last < 33) return; last = t;
      x.clearRect(0, 0, W, H);
      const off = -idx * W * .05;
      for (const p of pts) {
        const a = .25 + .75 * Math.abs(Math.sin(p.p + t / 1000 * p.s));
        x.globalAlpha = a * (.35 + p.d * .65); x.fillStyle = p.d > .85 ? '#d9c8ff' : '#ffffff';
        const px = ((p.x + off * (p.d + .2)) % (W * 1.4) + W * 1.4) % (W * 1.4) - W * .2;
        x.beginPath(); x.arc(px, p.y, p.r, 0, 6.28); x.fill();
      }
    })(0);
  })();

  /* ---------------- boot ---------------- */
  buildDesks(); setVoice('idle');
  { const n = new Date(); $('#clock').textContent = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`; }
  if (!store.get('coached', false)) { $('#coach').hidden = false; }
  $('#coachGo').addEventListener('click', () => { $('#coach').hidden = true; store.set('coached', true); shock(); });
  window.__wos = { goDesk, openSheet, closeSheets, runUtterance, zoomIn: () => zoomIn(idx), zoomOut: () => zoomOut(idx), get idx() { return idx; }, get desks() { return desks; }, get voice() { return V.state; }, startVoice, finishVoice, cancelVoice, execute, reset() { localStorage.clear(); location.reload(); } };
})();
