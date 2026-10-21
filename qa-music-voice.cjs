// QA (music by voice): the held orb drives Wizard Music. James, 10 Oct 2026: "I said play music Guy Barato Trap ...
// it just doesn't understand the command. I said open music, it opens Spotify ... make sure that routes to our
// wizard music ... I should be able to long press and tell you to play something and adjust the music."
//
// Real stack: the worktree shell (tools/qa-origin style, writes to Wizard refused) + the real Wizard Music app (:9205)
// + the live music hub. Hub writes made here are plays/skips only (no thumbs), which only feed "Recent".
// Usage: QA_WEB_DIR=<tree> node qa-music-voice.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const http = require('http'), fs = require('fs'), path = require('path');
const WEB = path.resolve(process.env.QA_WEB_DIR || __dirname, 'web');
const FALLBACK = require('node:path').join(require('./tools/qa-paths.cjs').repoRoot, 'web');
const SHOTS = process.env.QA_SHOTS || '';
const PORT = +(process.env.QA_PORT || 18471);
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const writes = [], routes = [];
let ROUTER = null; // {cmd} to answer /wizard/v1/route with; null = record and say agent

// One origin: shell from the worktree, /wizard-music/* → the real app, /wizard/* reads → Agent Service.
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const pipe = (port, rewriteOrigin) => {
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    if (rewriteOrigin && headers.origin) headers.origin = `http://127.0.0.1:${port}`;
    if (!rewriteOrigin) { delete headers.origin; delete headers.referer; }
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, r => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  };
  if (u.pathname.startsWith('/wizard-music/')) return pipe(9205, true);
  if (u.pathname.startsWith('/wizard/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
        writes.push(`${req.method} ${u.pathname}`);
        if (u.pathname === '/wizard/v1/route') { routes.push(JSON.parse(body || '{}')); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ms: 5, cmd: ROUTER || { route: 'agent', summary: 'x' } })); }
        if (u.pathname === '/wizard/thread-seen') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"state":{"threads":{}}}'); }
        res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"qa refuses writes"}');
      });
      return;
    }
    return pipe(8923, false);
  }
  let rel = u.pathname.startsWith('/wizard-os-home/') ? u.pathname.slice(16) : null;
  if (rel == null) { res.writeHead(404); return res.end(); }
  rel = decodeURIComponent(rel) || 'index.html';
  let f = path.join(WEB, rel); if (!fs.existsSync(f)) f = path.join(FALLBACK, rel);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {}
    window.__media = [];
    const P = HTMLMediaElement.prototype, play = P.play, pause = P.pause;
    P.play = function () { window.__media.push({ op: 'play', src: this.src, t: performance.now() }); return play.call(this); };
    P.pause = function () { window.__media.push({ op: 'pause', src: this.src, t: performance.now() }); return pause.call(this); };
  });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(`http://127.0.0.1:${PORT}/wizard-os-home/?shell=phone`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.WizCore.apps('mobile').APPS.some(a => a.id === 'wizard-music'), null, { timeout: 30000 });
  await sleep(1500);

  const hold = text => p.evaluate(t => window.__wos.handleText(t, 'command', false, 300, null), text);
  const tap = text => p.evaluate(t => window.__wos.handleText(t, 'auto', false, 300, null), text);
  const musicWins = () => p.evaluate(() => Object.values(window.__wos.wins).filter(w => w.app === 'frame' && w.appId === 'wizard-music').length);
  const toastText = () => p.evaluate(() => document.querySelector('#toast.show')?.textContent || '');
  const frame = async () => { const el = await p.waitForSelector('iframe.appframe[src*="/wizard-music/"]', { timeout: 15000 }); return el.contentFrame(); };
  const nowPlaying = f => f.evaluate(() => { const a = [...document.querySelectorAll('audio')][0]; return { title: document.querySelector('.music-mini strong')?.textContent || '', artist: document.querySelector('.music-mini small')?.textContent || '' }; });
  const waitToast = async (re, ms = 60000) => { const t0 = Date.now(); let last = ''; while (Date.now() - t0 < ms) { last = await toastText(); if (re.test(last)) return last; await sleep(150); } return last; };
  const agentWrites = () => writes.filter(x => /\/runs|\/sessions|\/upload/.test(x));
  const spotifyOpen = () => p.evaluate(() => Object.values(window.__wos.wins).some(w => w.appId === 'spotify'));

  // 1. Held "Open music" opens Wizard Music; tapped words are messages.
  writes.length = 0; routes.length = 0;
  await hold('Open music.'); await sleep(900);
  ok(await musicWins() === 1 && !(await spotifyOpen()), 'held "Open music" opens Wizard Music, not Spotify', JSON.stringify(await p.evaluate(() => Object.values(window.__wos.wins).map(w => w.appId || w.app))));
  ok(routes.length === 0, '"Open music" resolved on the phone (no router call)', JSON.stringify(routes));
  await p.evaluate(() => { const id = Object.keys(window.__wos.wins).find(k => window.__wos.wins[k].appId === 'wizard-music'); window.__wos.closeWin(id); }); await sleep(500);
  await tap('open music'); await sleep(900);
  ok(await musicWins() === 0 && !(await spotifyOpen()), 'tapped "open music" does not open a player');
  await hold('open music'); await sleep(900);
  const fm = await frame();
  await fm.waitForSelector('.music-chip', { timeout: 60000 });
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'music-voice-open.png') });
  await p.evaluate(() => { const id = Object.keys(window.__wos.wins).find(k => window.__wos.wins[k].appId === 'wizard-music'); window.__wos.closeWin(id); }); await sleep(500);

  // 2. James's exact words, held from home with no player open: opens Wizard Music and plays Gui Boratto "Trap".
  writes.length = 0; routes.length = 0;
  const t0 = Date.now();
  await hold('Play music Guy Barato Trap.');
  const found = await waitToast(/^♫\s*Finding/, 3000);
  ok(/Finding “music Guy Barato Trap”|Finding “Guy Barato Trap”/.test(found) || /Finding/.test(found), 'instant feedback: "Finding …" while the hub looks it up', found);
  const playingToast = await waitToast(/Playing/, 60000);
  const f = await frame();
  const np = await f.waitForFunction(() => { const s = document.querySelector('.music-mini strong')?.textContent; return s ? { title: s, artist: document.querySelector('.music-mini small')?.textContent } : false; }, null, { timeout: 60000 }).then(h => h.jsonValue()).catch(() => ({}));
  ok(/Trap · Gui Boratto/.test(playingToast), 'orb says "Playing Trap · Gui Boratto"', playingToast);
  ok(np.title === 'Trap' && /Gui Boratto/.test(np.artist || ''), '"Guy Barato Trap" plays Gui Boratto – Trap', JSON.stringify(np));
  const audioOn = await f.waitForFunction(() => { const a = document.querySelector('audio') || window.__wmAudio; return true; }).then(() => f.evaluate(() => window.__media.filter(m => m.op === 'play').length));
  ok(audioOn >= 1, 'audio actually started in the player', String(audioOn));
  ok(routes.length === 0 && agentWrites().length === 0, 'nothing went to the router or to Archimedes', JSON.stringify({ routes, w: agentWrites() }));
  console.log('   play resolved in', Date.now() - t0, 'ms');
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'music-voice-playing.png') });

  // 3. Adjust by holding: pause, resume, next, volume, what's playing — on another desk too.
  const audioState = () => f.evaluate(() => { const m = window.__media; return m.length ? m[m.length - 1].op : ''; });
  await hold('Pause the music.'); let t = await waitToast(/Paused/, 6000);
  ok(/Paused/.test(t) && await audioState() === 'pause', 'held "Pause the music" pauses', t);
  await hold('resume'); t = await waitToast(/Playing Trap/, 6000);
  ok(/Playing Trap/.test(t) && await audioState() === 'play', 'held "resume" plays again', t);
  await hold('Next song.'); t = await waitToast(/^♫\s*Next:/, 8000);
  const np2 = await nowPlaying(f);
  ok(/Next:/.test(t) && np2.title && np2.title !== 'Trap', 'held "Next song" skips to the next station track', JSON.stringify({ t, np2 }));
  await hold('Turn it down.'); t = await waitToast(/volume 80%/, 6000);
  ok(/Music volume 80%/.test(t), 'held "Turn it down" lowers the music', t);
  await hold('louder'); t = await waitToast(/volume 100%/, 6000);
  ok(/Music volume 100%/.test(t), 'held "louder" raises it again', t);
  await hold("What's playing?"); t = await waitToast(new RegExp(np2.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 6000);
  ok(t.includes(np2.title), 'held "What\'s playing" names the song', t);
  await p.evaluate(() => window.__wos.goDesk(window.__wos.idx + 1)); await sleep(800);
  await hold('pause'); t = await waitToast(/Paused/, 6000);
  ok(/Paused/.test(t), 'works from another desk (finds the player window)', t);
  ok(await musicWins() === 1, 'never opens a second player', String(await musicWins()));
  await p.evaluate(() => window.__wos.goDesk(window.__wos.idx - 1)); await sleep(800);

  // 4. In front of Wizard Music, a held name alone plays it.
  await hold('Bono bo'); t = await waitToast(/Playing Bonobo/, 60000);
  ok(/Playing Bonobo/.test(t), 'held "Bono bo" over Wizard Music plays Bonobo', t);

  // 5. Router's play_music (a phrase the phone grammar misses) also lands in Wizard Music, not Spotify.
  //    Asked from an empty desk: in front of Wizard Music a held phrase goes straight to the player instead.
  await p.evaluate(() => window.__wos.goDesk(window.__wos.idx + 1)); await sleep(800);
  ROUTER = { route: 'command', action: 'play_music', query: 'Kerri Chandler Rain' }; routes.length = 0;
  await hold('I was hoping for that kerry chandler rain track'); t = await waitToast(/Playing Rain.* · Kerri Chandler/, 60000);
  ok(routes.length === 1 && /Playing Rain.* · Kerri Chandler/.test(t) && !(await spotifyOpen()), 'router play_music plays in Wizard Music', JSON.stringify({ t, routes: routes.length }));
  ROUTER = null;
  await hold('throw on some bonobo'); t = await waitToast(/Playing Bonobo/, 60000);
  ok(/Playing Bonobo/.test(t), 'held "throw on some bonobo" from another desk plays Bonobo', t);
  await p.evaluate(() => window.__wos.goDesk(window.__wos.idx - 1)); await sleep(800);

  // 7. Search shows results and never plays (James, 12 Oct 2026: "I said search for Home Tides … it put on Tides by
  //    Lingua Lustra … I didn't say pick the first one and start playing it. It should show me the search results.")
  const sends = () => p.evaluate(() => (window.__musicLog || []).filter(x => x === 'send:search').length);
  const results = fr => fr.waitForFunction(() => { const h = document.querySelector('.music-results h3')?.textContent || ''; const rows = [...document.querySelectorAll('.music-results .music-row-text')]; return !/Searching/.test(h) && rows.length ? { h, rows: rows.slice(0, 3).map(r => `${r.querySelector('strong').textContent} · ${r.querySelector('small').textContent}`) } : false; }, null, { timeout: 60000 }).then(h => h.jsonValue()).catch(() => ({}));
  const before = await nowPlaying(f); const plays0 = await f.evaluate(() => window.__media.filter(m => m.op === 'play').length);
  routes.length = 0; writes.length = 0;
  await hold('Search for Home Tides.'); t = await waitToast(/results? for “Home Tides”|Nothing matched/, 60000);
  let r = await results(f);
  ok(/results? for “Home Tides”/.test(t), 'held "Search for Home Tides." over Music: orb says "N results for “Home Tides”"', t);
  ok(/Results for “Home Tides”/.test(r.h || '') && /^Tides · Home/.test((r.rows || [])[0] || ''), 'results list shows, exact match "Tides · Home" first', JSON.stringify(r));
  const after = await nowPlaying(f); const plays1 = await f.evaluate(() => window.__media.filter(m => m.op === 'play').length);
  ok(after.title === before.title && plays1 === plays0, 'search did not change or start the song', JSON.stringify({ before, after, plays0, plays1 }));
  ok(routes.length === 0 && agentWrites().length === 0, 'search resolved on the phone (no router, no agent)', JSON.stringify({ routes, w: agentWrites() }));
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'music-voice-search.png') });
  // The spell from another desk and from Chats: "Music search …" reaches the existing player.
  await f.evaluate(() => document.querySelector('.music-clear')?.click()); await sleep(300);
  await p.evaluate(() => window.__wos.goDesk(0)); await sleep(800);
  await hold('Music search Home Tides.'); t = await waitToast(/results? for “Home Tides”/, 60000);
  r = await results(f);
  ok(/results? for “Home Tides”/.test(t) && /^Tides · Home/.test((r.rows || [])[0] || '') && await musicWins() === 1, 'spell "Music search Home Tides" from Home searches the open player', JSON.stringify({ t, r }));
  // With no player open, the HELD spell opens Wizard Music straight onto the results.
  await p.evaluate(() => { const id = Object.keys(window.__wos.wins).find(k => window.__wos.wins[k].appId === 'wizard-music'); window.__wos.closeWin(id); }); await sleep(600);
  await hold('Open Wizard Music and search for Home Tides.'); t = await waitToast(/results? for “Home Tides”/, 60000);
  const f2 = await frame(); r = await results(f2);
  // Catalogue artist labels can hydrate after the search acknowledgement; guard the query and song title here.
  ok(await musicWins() === 1 && /^Results for “Home Tides”$/.test(r.h) && /^Tides ·/.test((r.rows || [])[0] || ''), 'held "Open Wizard Music and search for Home Tides" opens Music on the results', JSON.stringify({ t, r }));
  // (Reopening Music may resume the last session by design; the search itself must not start a result.)
  const np3 = await nowPlaying(f2); const srcs = await f2.evaluate(() => window.__media.map(m => m.src).join(' '));
  ok(np3.title !== 'Tides' && !/1pHgLmKhu0Y|GnTA0XlE2n0/.test(srcs), 'search on a fresh player did not play a result', JSON.stringify({ np3, srcs: srcs.slice(0, 200) }));
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'music-voice-search-fresh.png') });
  // Tapped "search for X" away from Music stays an agent message.
  await p.evaluate(() => window.__wos.goDesk(0)); await sleep(800);
  const s0 = await sends(); await tap('search for home tides'); await sleep(800);
  ok(await sends() === s0, 'plain "search for …" away from Music is not hijacked', String(await sends() - s0));
  await p.evaluate(() => window.__wos.closeSheets?.(true)); await sleep(300);

  // 6. Chat stays chat: no router, even for music-ish words.
  routes.length = 0;
  await tap('remind me to pause the newsletter next week'); await sleep(800);
  ok(routes.length === 0, 'tapped non-command sentence bypasses routing', JSON.stringify(routes.map(r => r.text)));
  await hold('pause'); await sleep(1500); // leave it quiet

  ok(!errs.length, 'no page errors', errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
