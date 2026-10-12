/* Wizard Music sample: the shipped MusicApp / MiniPlayer / NowPlaying anatomy (src/music/MusicApp.tsx) over a
 * fixture library of twelve invented records with CSS-drawn art. The player is a local clock only: Play, Pause,
 * Next, Previous, Seek, thumbs and Play next change this page's state. No audio element, no microphone, no
 * network, nothing stored. Back closes Now Playing; at the music home the shell takes the step. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = ms => { const t = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const m = (min, sec) => (min * 60 + sec) * 1000;

  /* ---------------- glyphs (shipped SVGs) ---------------- */
  const PlayGlyph = (s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5L7 4.5Z" fill="currentColor"/></svg>`;
  const PauseGlyph = (s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h3.6v16H7zM13.4 4H17v16h-3.6z" fill="currentColor"/></svg>`;
  const NextGlyph = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14l10-7L5 5Zm11 0h2.5v14H16z" fill="currentColor"/></svg>';
  const PrevGlyph = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 5v14L9 12l10-7ZM5.5 5H8v14H5.5z" fill="currentColor"/></svg>';
  const THUMB = 'M7.5 10.5 11 3.6c.3-.6 1-.9 1.6-.6 1.2.5 1.9 1.8 1.6 3.1L13.6 9h5.2c1.3 0 2.3 1.2 2 2.5l-1.5 7c-.2.9-1 1.5-1.9 1.5H7.5m0-9.5v9.5m0-9.5H4.2c-.4 0-.7.3-.7.7v8.1c0 .4.3.7.7.7h3.3';
  const ThumbUp = (filled = false, s = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><path d="${THUMB}" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  const ThumbDown = (s = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(180deg)"><path d="${THUMB}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  const SearchGlyph = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m15.5 15.5 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const PlayNextGlyph = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h11M4 11h11M4 16h6M17 13v8m-4-4h8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  const ChevronDown = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------------- fixture library (invented artists, drawn art) ---------------- */
  const T = (id, title, artist, album, ms, a1, a2, a3, motif) => ({ id, title, artist, album, durationMs: ms, art: { a1, a2, a3, motif } });
  const TRACKS = [
    T('t1', 'Lanterns on the Water', 'Night Ferry', 'Harbour Lights', m(3, 42), '#1b2a4a', '#c0563a', '#f2c14e', 1),
    T('t2', 'Slow Arithmetic', 'Lumen Quartet', 'Small Hours', m(4, 5), '#2d1b3d', '#6b4fa0', '#e8d5a3', 0),
    T('t3', 'Paper Moons', 'Odile & the Kites', 'Paper Moons', m(2, 58), '#f0e6d2', '#d98c5f', '#2f4858', 5),
    T('t4', 'Copper Rain', 'Mareike Sol', 'Weathering', m(3, 31), '#3a1f12', '#b5652b', '#f6d6a8', 2),
    T('t5', 'Tidewater', 'The Glass Orchard', 'Tidewater', m(5, 12), '#0d3b3f', '#2a8c82', '#bfe3d0', 3),
    T('t6', 'Northbound, 6 a.m.', 'Halvard Lee', 'Platforms', m(3, 18), '#20262e', '#5c7a99', '#ffb347', 4),
    T('t7', 'Quiet Engine', 'Lumen Quartet', 'Small Hours', m(4, 44), '#101820', '#3d5a80', '#98c1d9', 1),
    T('t8', 'Saltlight', 'Night Ferry', 'Harbour Lights', m(3, 6), '#2b193d', '#e26d5c', '#ffe1a8', 0),
    T('t9', 'Lowercase', 'Odile & the Kites', 'Paper Moons', m(2, 41), '#e9d8a6', '#94d2bd', '#005f73', 2),
    T('t10', 'Embers & Snow', 'Mareike Sol', 'Weathering', m(4, 20), '#1a0f0a', '#8c2f1b', '#f5cb5c', 5),
    T('t11', 'Open Field', 'The Glass Orchard', 'Tidewater', m(3, 55), '#283618', '#606c38', '#fefae0', 4),
    T('t12', 'Small Hours', 'Lumen Quartet', 'Small Hours', m(6, 1), '#0b0c2a', '#4b3f72', '#ffc857', 3),
  ];
  const byId = id => TRACKS.find(t => t.id === id);
  const HOME = {
    sources: [{ id: 'sample', name: 'Sample library', detail: '12 invented records · drawn art', ok: true }, { id: 'audio', name: 'Sound', detail: 'Off · this preview never plays audio', ok: false }],
    vibes: ['Late-night focus', 'Rainy walk', 'Warm & slow', 'Bright morning', 'Deep work'],
    recent: ['t5', 't3', 't10', 't6', 't2', 't11'].map(byId),
    liked: ['t1', 't7', 't9', 't4'].map(byId),
    library: TRACKS.slice(0, 8),
  };
  const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const mix = (seed, first) => { const rest = TRACKS.filter(t => t !== first).sort((a, b) => hash(seed + a.id) - hash(seed + b.id)); return first ? [first, ...rest] : rest; };

  /* ---------------- local player clock ---------------- */
  const S = { queue: [], index: 0, playing: false, pos: 0, station: null, now: false, showPlayed: false, query: '', results: null, likes: {}, avoid: [], scrub: null };
  let clock = 0;
  const current = () => S.queue[S.index];
  function setPlaying(on) {
    S.playing = on; clearInterval(clock); clock = 0;
    if (on) clock = setInterval(tick, 1000);
  }
  function tick() {
    if (document.hidden || !S.playing) return;
    const t = current(); if (!t) return;
    S.pos += 1000;
    if (S.pos >= t.durationMs) { next(false); return; }
    paintProgress();
  }
  function load(tracks, i, station, play = true) { S.queue = tracks.slice(); S.index = i; S.pos = 0; S.station = station; setPlaying(play); paint(); }
  function next(user = true) { if (S.index < S.queue.length - 1) { S.index++; S.pos = 0; } else { S.queue = S.queue.concat(mix(String(S.queue.length), null).slice(0, 6)); S.index++; S.pos = 0; } if (!user && !S.playing) setPlaying(true); paint(); }
  function previous() { if (S.pos > 3000 || S.index === 0) S.pos = 0; else { S.index--; S.pos = 0; } paint(); }
  function jump(i) { S.index = i; S.pos = 0; setPlaying(true); paint(); }

  /* ---------------- templates (shipped markup) ---------------- */
  const Art = (t, size, tag = '') => `<span class="music-art music-art-${size}">${t ? `<span class="music-art-fixture" data-motif="${t.art.motif}" style="--a1:${t.art.a1};--a2:${t.art.a2};--a3:${t.art.a3}" role="img" aria-label="Sample cover art for ${esc(t.album)}"></span>${tag}` : '<span class="music-art-fallback">♪</span>'}</span>`;
  function TrackRow(t, { active = false, played = false, play = `data-play="${t.id}"`, playNext = true } = {}) {
    return `<div class="music-row${active ? ' active' : ''}${played ? ' played' : ''}"${active ? ' aria-current="true"' : ''}><button type="button" class="music-row-main" ${play}>${Art(t, 'row')}<span class="music-row-text"><strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></span><span class="music-row-time">${time(t.durationMs)}</span></button>${playNext ? `<button type="button" class="music-icon-button" aria-label="Play ${esc(t.title)} next" data-playnext="${t.id}">${PlayNextGlyph}</button>` : ''}</div>`;
  }
  function workspaceBody() {
    const cur = current();
    if (S.results !== null) {
      const q = S.query.trim();
      return `<div class="music-results"><div class="music-section-head"><h3>Results for “${esc(q)}”</h3>${q ? `<button type="button" class="music-chip" data-act="station-query">Station from this</button>` : ''}</div>${S.results.length ? '' : '<p class="music-empty">Nothing in the sample library matched. Try an artist, a song, or a mood.</p>'}${S.results.map(t => TrackRow(t, { active: t.id === cur?.id })).join('')}</div>`;
    }
    return `<div class="music-sources" aria-label="Music sources">${HOME.sources.map(s => `<span class="music-source${s.ok ? ' ok' : ''}"><b>${esc(s.name)}</b><small>${esc(s.detail)}</small></span>`).join('')}</div>
      ${S.avoid.length ? `<p class="music-taste" aria-label="Music you turned down">Playing less: ${esc(S.avoid.join(' · '))}</p>` : ''}
      <section class="music-section" aria-label="Start a station"><div class="music-section-head"><h3>Start a station</h3><small>From the sample library</small></div><div class="music-chips">${HOME.vibes.map(v => `<button type="button" class="music-chip" data-vibe="${esc(v)}">${esc(v)}</button>`).join('')}</div></section>
      <section class="music-section" aria-label="Recently played"><div class="music-section-head"><h3>Recently played</h3><small>Sample</small></div><div class="music-shelf">${HOME.recent.map(t => `<button type="button" class="music-tile" data-play="${t.id}">${Art(t, 'card')}<strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></button>`).join('')}</div></section>
      <section class="music-section" aria-label="Liked songs"><div class="music-section-head"><h3>Liked</h3><button type="button" class="music-chip" data-act="play-all">Play all</button></div>${HOME.liked.map(t => TrackRow(t, { active: t.id === cur?.id })).join('')}</section>
      <section class="music-section" aria-label="Your library"><div class="music-section-head"><h3>On your Wizard</h3><button type="button" class="music-chip" data-act="shuffle">Shuffle</button></div>${HOME.library.map(t => TrackRow(t, { active: t.id === cur?.id })).join('')}</section>
      <p class="music-status">Sample library for the Wizard OS preview: invented records, drawn covers, no sound.</p>`;
  }
  function mini() {
    const t = current(); if (!t) return '';
    const p = t.durationMs ? Math.min(1, S.pos / t.durationMs) : 0;
    return `<div class="music-mini" role="region" aria-label="Now playing"><button type="button" class="music-mini-open" data-act="open-now" aria-label="Open player: ${esc(t.title)} by ${esc(t.artist)}">${Art(t, 'mini')}<span class="music-row-text"><strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></span></button><button type="button" class="music-mini-down" data-act="down" aria-label="Thumbs down: skip this song">${ThumbDown(22)}</button><button type="button" class="music-mini-toggle" data-act="toggle" aria-label="${S.playing ? 'Pause' : 'Play'}">${S.playing ? PauseGlyph() : PlayGlyph()}</button><button type="button" class="music-mini-next" data-act="next" aria-label="Next song">${NextGlyph}</button><span class="music-mini-progress" style="transform:scaleX(${p})"></span></div>`;
  }
  function nowPlaying() {
    const t = current(); if (!t || !S.now) return '';
    const liked = S.likes[t.id] ?? HOME.liked.includes(t);
    const pos = S.scrub ?? S.pos;
    const played = S.queue.slice(0, S.index).map((item, at) => ({ item, at }));
    const upNext = S.queue.slice(S.index + 1, S.index + 40).map((item, k) => ({ item, at: S.index + 1 + k }));
    return `<div class="music-now" role="dialog" aria-modal="true" aria-label="Now playing">
      <header class="music-now-head"><button type="button" class="icon-button" aria-label="Close player" data-act="close-now">${ChevronDown}</button><div><small>${S.station ? 'Station' : 'Playing'}</small><strong>${esc(S.station || 'Sample library')}</strong></div><span class="music-now-spacer"></span></header>
      <div class="music-now-body">
        ${Art(t, 'hero', '<span class="music-art-tag">Sample art</span>')}
        <div class="music-now-meta"><div><h2>${esc(t.title)}</h2><p>${esc(t.artist)}${t.album ? ` · ${esc(t.album)}` : ''}</p></div></div>
        <div class="music-seek"><input type="range" min="0" max="${Math.max(1, t.durationMs)}" step="1000" value="${Math.min(pos, t.durationMs)}" aria-label="Seek"><div class="music-seek-times"><span data-pos>${time(pos)}</span><span>Sample · silent</span><span>${time(t.durationMs)}</span></div></div>
        <div class="music-controls">
          <button type="button" class="music-icon-button music-thumb music-thumb-down" data-act="down" aria-label="Thumbs down: skip this song">${ThumbDown()}</button>
          <button type="button" class="music-icon-button big" data-act="prev" aria-label="Previous">${PrevGlyph}</button>
          <button type="button" class="music-play" data-act="toggle" aria-label="${S.playing ? 'Pause' : 'Play'}">${S.playing ? PauseGlyph(30) : PlayGlyph(30)}</button>
          <button type="button" class="music-icon-button big" data-act="next" aria-label="Next">${NextGlyph}</button>
          <button type="button" class="music-icon-button music-thumb music-like${liked ? ' on' : ''}" data-act="like" aria-pressed="${liked}" aria-label="${liked ? 'Thumbs up (on)' : 'Thumbs up'}">${ThumbUp(liked)}</button>
        </div>
        <section class="music-upnext" aria-label="Queue">
          ${played.length ? `<button type="button" class="music-played-toggle${S.showPlayed ? ' open' : ''}" aria-expanded="${S.showPlayed}" data-act="played-toggle"><span>${S.showPlayed ? 'Hide played' : `Played · ${played.length}`}</span>${ChevronDown}</button>` : ''}
          ${S.showPlayed && played.length ? `<div class="music-played" aria-label="Played">${played.map(({ item, at }) => TrackRow(item, { played: true, play: `data-jump="${at}"`, playNext: false })).join('')}${TrackRow(t, { active: true, play: 'data-noop', playNext: false })}</div>` : ''}
          <div class="music-section-head"><h3>Up next</h3>${S.station ? '<small>Endless · keeps going</small>' : ''}</div>
          ${upNext.map(({ item, at }) => TrackRow(item, { play: `data-jump="${at}"`, playNext: false })).join('')}
          ${upNext.length ? '' : `<p class="music-empty">${S.station ? 'Finding more…' : 'End of queue.'}</p>`}
        </section>
      </div>
    </div>`;
  }

  /* ---------------- paint ---------------- */
  function paint() {
    const body = $('#music-body'), y = $('.music-shell-main').scrollTop;
    body.innerHTML = workspaceBody();
    $('#music-mini').innerHTML = mini();
    const nowEl = $('#music-now'), keep = nowEl.querySelector('.music-now-body')?.scrollTop || 0;
    nowEl.innerHTML = nowPlaying();
    const nb = nowEl.querySelector('.music-now-body'); if (nb) nb.scrollTop = keep;
    $('.music-shell-main').scrollTop = y;
    $('#clear').hidden = !S.query;
    bindSeek();
  }
  function paintProgress() {
    const t = current(); if (!t) return;
    const p = Math.min(1, S.pos / t.durationMs);
    const bar = $('.music-mini-progress'); if (bar) bar.style.transform = `scaleX(${p})`;
    if (S.scrub === null) { const r = $('.music-seek input'); if (r) r.value = String(S.pos); const l = $('[data-pos]'); if (l) l.textContent = time(S.pos); }
  }
  function bindSeek() {
    const r = $('.music-seek input'); if (!r) return;
    r.oninput = () => { S.scrub = +r.value; const l = $('[data-pos]'); if (l) l.textContent = time(S.scrub); };
    r.onchange = () => { if (S.scrub !== null) { S.pos = S.scrub; S.scrub = null; paintProgress(); } };
  }
  function toast(text) { const el = $('#music-toast'); el.textContent = text; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 2600); }
  function openNow(on) { S.now = on; paint(); if (on) $('.music-now .icon-button')?.focus({ preventScroll: true }); }

  /* ---------------- actions ---------------- */
  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.vibe) { load(mix(d.vibe, null), 0, d.vibe); openNow(true); return; }
    if (d.play) { const t = byId(d.play); load(mix(t.id, t), 0, `${t.title} radio`); openNow(true); return; }
    if (d.jump) { jump(+d.jump); return; }
    if (d.playnext) {
      const t = byId(d.playnext);
      if (!S.queue.length) { load(mix(t.id, t), 0, `${t.title} radio`); openNow(true); return; }
      S.queue.splice(S.index + 1, 0, t); paint(); toast(`${t.title} plays next`); return;
    }
    switch (d.act) {
      case 'toggle': setPlaying(!S.playing); paint(); break;
      case 'next': next(); break;
      case 'prev': previous(); break;
      case 'open-now': openNow(true); break;
      case 'close-now': openNow(false); $('.music-mini-open')?.focus({ preventScroll: true }); break;
      case 'played-toggle': S.showPlayed = !S.showPlayed; paint(); break;
      case 'like': { const t = current(); const was = S.likes[t.id] ?? HOME.liked.includes(t); S.likes[t.id] = !was; if (!was) toast('Liked. More like this (sample only).'); paint(); break; }
      case 'down': {
        const t = current(); if (!t) break;
        S.queue = S.queue.filter((x, i) => i <= S.index || x.artist !== t.artist);
        S.queue.splice(S.index, 1); if (S.index >= S.queue.length) S.queue = S.queue.concat(mix(t.id, null).filter(x => x.artist !== t.artist).slice(0, 5));
        S.pos = 0; if (!S.avoid.includes(t.artist)) S.avoid.push(t.artist);
        toast(`Skipped. Less ${t.artist} (this page only).`); paint(); break;
      }
      case 'station-query': { const q = S.query.trim(); load(S.results.length ? mix(q, S.results[0]) : mix(q, null), 0, q); openNow(true); break; }
      case 'play-all': load(HOME.liked, 0, null); openNow(true); break;
      case 'shuffle': load(mix('shuffle' + Date.now(), null).filter(t => HOME.library.includes(t)), 0, null); openNow(true); break;
      case 'clear': S.query = ''; S.results = null; $('#q').value = ''; paint(); break;
    }
  });
  function runSearch() {
    const q = S.query.trim().toLowerCase();
    S.results = q ? TRACKS.filter(t => [t.title, t.artist, t.album].join(' ').toLowerCase().includes(q)) : null;
    paint();
  }

  /* ---------------- mount ---------------- */
  $('#root').innerHTML = `<div class="music-shell"><header class="music-shell-head"><h1>Music</h1></header><main class="music-shell-main"><section class="music-workspace" aria-label="Wizard Music">
      <form class="music-search" role="search" id="search">${SearchGlyph}<input id="q" type="search" placeholder="Song, artist, or vibe" aria-label="Search the sample library" enterkeyhint="search" autocomplete="off"><button type="button" class="music-clear" id="clear" data-act="clear" aria-label="Clear search" hidden>×</button></form>
      <div id="music-body"></div></section></main><div id="music-mini"></div></div><div id="music-now"></div><div id="music-toast" class="music-toast" role="status" aria-live="polite" hidden></div>`;
  $('#search').addEventListener('submit', e => { e.preventDefault(); runSearch(); $('#q').blur(); });
  $('#q').addEventListener('input', () => { S.query = $('#q').value; $('#clear').hidden = !S.query; if (!S.query) { S.results = null; paint(); } else runSearch(); });

  // A paused sample station is loaded at start, so the persistent player is part of the first view.
  load(mix('Late-night focus', byId('t2')), 0, 'Late-night focus', false); S.pos = m(1, 12); paint();

  window.WzFixture?.init({
    back() { if (S.now) { openNow(false); return true; } return false; },
    toast,
  });
})();
