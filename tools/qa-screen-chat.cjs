// Screen page QA (no device), chat-app case: a Telegram-like screen whose message text has no word positions and
// whose accessibility box is the whole chat row (wallpaper doodles, gradient bubbles, timestamps, a long message
// running off the bottom). Words must still sit on their real lines so a drag selects what it crosses.
// usage: node tools/qa-screen-chat.cjs [screen.html] [outdir]
const { chromium } = require('./qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '../android/app/src/main/assets/assist/screen.html'));
const OUT = process.argv[3] || '/tmp/qa-screen-chat';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 400) : '')); };
const DPR = 2.625, W = 411, H = 891;
const MSGS = [
  { out: true, y: 120, text: "Maybe hold on a second. I'm in the process of refactoring the way Nostr IDs are handled. It might affect the public IDs we use on Messenger.", time: '00:08' },
  { out: false, y: 0, text: 'cool!', time: '00:09' },
  { out: true, y: 0, text: "From the garden helper:\n\nYes, Rosa's right, and our plan already works that way. Tomato seedlings and basil start on the sunny porch shelf because the kitchen window gets too little light. The greenhouse only holds the big pots and gets water through a drip hose.\n\nHer layout fits our plan. When the new raised bed exists, it has to sit somewhere warm like the porch. Herbs in the greenhouse would get water the same way the pots do now, through a hose or the rain barrel. One thing to settle with her: the weekly watering moves to a timer, and the old watering can retires once that lands.\n\nUntil then, the spare hose stays on the porch hook and the seed trays get turned every morning so the stems grow straight toward the light.", time: '00:15' },
];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true });
  const app = await ctx.newPage();
  await app.setContent(`<body style="margin:0"><canvas id=c width=${W * DPR} height=${H * DPR} style="width:${W}px;height:${H}px"></canvas></body>`);
  const scr = await app.evaluate(({ MSGS, DPR, W, H }) => {
    const c = document.getElementById('c').getContext('2d'); c.scale(DPR, DPR);
    c.fillStyle = '#17212b'; c.fillRect(0, 0, W, H);
    // wallpaper doodles
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1.4;
    for (let i = 0; i < 160; i++) { const x = rnd() * W, y = rnd() * H, r = 4 + rnd() * 9; c.beginPath(); c.arc(x, y, r, 0, Math.PI * (1 + rnd())); c.stroke(); }
    const F = 16.5, LH = 20.5, blocks = [], truth = [];
    let y = 110;
    c.font = F + 'px sans-serif';
    const wrap = (t, maxW) => {
      const lines = [];
      for (const para of t.split('\n')) {
        if (!para) { lines.push(''); continue; }
        let cur = '';
        for (const w of para.split(' ')) { const nx = cur ? cur + ' ' + w : w; if (c.measureText(nx).width > maxW && cur) { lines.push(cur); cur = w; } else cur = nx; }
        lines.push(cur);
      }
      return lines;
    };
    for (const m of MSGS) {
      const maxW = W * .72, lines = wrap(m.text, maxW);
      const tw = Math.max(...lines.map(l => c.measureText(l).width)), bw = Math.min(W - 24, tw + 74), bh = lines.length * LH + 22;
      const bx = m.out ? W - bw - 8 : 10, by = y;
      if (m.out) { const g = c.createLinearGradient(0, by, 0, by + bh); g.addColorStop(0, '#7b3fbf'); g.addColorStop(1, '#3b5bd9'); c.fillStyle = g; } else c.fillStyle = '#232e3c';
      c.beginPath(); c.roundRect(bx, by, bw, bh, 16); c.fill();
      c.fillStyle = '#f2f2f2'; c.font = F + 'px sans-serif';
      lines.forEach((l, i) => {
        const ly = by + 11 + (i + 1) * LH - 5;
        c.fillText(l, bx + 12, ly);
        if (l) truth.push({ t: l, x0: bx + 12, x1: bx + 12 + c.measureText(l).width, y: ly - F * .35 });
      });
      c.font = '12px sans-serif'; c.fillStyle = 'rgba(255,255,255,.6)';
      c.fillText(m.time, bx + bw - 42, by + bh - 8); c.font = F + 'px sans-serif';
      // what the chat app reports: the whole row, text with the time, no word positions
      const words = []; const re = /(\S+)(\s*)/g; let mm; const full = m.text;
      while ((mm = re.exec(full))) words.push([mm[1], mm[2].includes('\n') ? '\n' : mm[2] ? ' ' : '']);
      blocks.push({ t: full, x: 0, y: by * DPR, w: W * DPR, h: Math.min(bh, H - by) * DPR, l: false, ex: false, wd: words });
      y += bh + 10;
    }
    return { blocks, truth, jpeg: document.getElementById('c').toDataURL('image/jpeg', .9).split(',')[1] };
  }, { MSGS, DPR, W, H });
  await app.close();

  const p = await ctx.newPage();
  const logs = [];
  p.on('pageerror', e => console.log('  pageerror:', e.message));
  await p.addInitScript(({ jpeg }) => {
    window.__calls = [];
    const rec = (k, ...a) => window.__calls.push([k, ...a]);
    window.ScreenNative = { close: () => rec('close'), copy: t => rec('copy', t), search: q => rec('search', q), sheet: f => rec('sheet', f),
      closeSearch: () => {}, ask: t => rec('ask', t), shot: () => jpeg, log: s => rec('log', s), picture: () => {}, translate: () => {} };
  }, { jpeg: scr.jpeg });
  await p.goto('file://' + PAGE);
  await p.evaluate(({ blocks, DPR, W, H }) => window.S.open({ mode: 'select', dpr: DPR, ox: 0, oy: 0, sw: W * DPR, sh: H * DPR, top: 24, bot: 0, shot: true, few: false, blocks }), { blocks: scr.blocks, DPR, W, H });
  await p.waitForTimeout(600);
  const fitLog = (await p.evaluate(() => window.__calls)).filter(c => c[0] === 'log' && /fit/.test(c[1])).map(c => c[1]);
  console.log('  ' + fitLog.join(' | '));
  if (process.env.DBG) for (const bl of scr.blocks) { const ps = await p.evaluate(b => window.S.pieces(b.x, b.y, b.w, b.h), bl); for (const q of (ps || []).slice(-3)) console.log('  piece', Math.round(q.x0), Math.round(q.y0), Math.round(q.x1), Math.round(q.y1), q.gaps, JSON.stringify(q.wide), q.cuts.map(Math.round).join(',')); }
  let k = await p.evaluate(() => window.S.peek());
  const css = v => v / DPR;
  // every visible line: the words whose centres sit on it are exactly that line's words
  const norm = s => s.replace(/\s+/g, ' ').trim();
  let good = 0; const bad = [];
  for (const L of scr.truth) {
    if (L.y > H - 10) continue;
    const on = k.words.filter(w => Math.abs(css(w.y) - L.y) < 7 && css(w.x) > L.x0 - 4 && css(w.x) < L.x1 + 4).map(w => w.t).join(' ');
    if (norm(on) === norm(L.t)) good++; else bad.push([L.t, on]);
  }
  const visible = scr.truth.filter(L => L.y <= H - 10).length;
  check('every visible line of a chat message holds exactly its own words', good === visible, { good, visible, bad: bad.slice(0, 3) });
  // word edges sit on the real ink
  const line = scr.truth.find(L => L.t.startsWith('Her layout'));
  const first = k.words.find(w => w.t === 'Her'), lastW = k.words.find(w => w.t === 'new' && Math.abs(css(w.y) - line.y) < 7 && css(w.r) > line.x1 - 30);
  check('the first and last word of a line start and end on the real text', first && lastW && Math.abs(css(first.l) - line.x0) < 4 && Math.abs(css(lastW.r) - line.x1) < 5,
    first && lastW && [css(first.l) - line.x0, css(lastW.r) - line.x1]);
  // drag from "sunny" to "window" across two lines
  const wa = k.words.find(w => w.t === 'sunny'), wb = k.words.find(w => w.t === 'window');
  const cdp = await ctx.newCDPSession(p);
  const drag = async (a, z) => {
    const pt = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(a[0], a[1]) });
    for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(a[0] + (z[0] - a[0]) * i / 12, a[1] + (z[1] - a[1]) * i / 12) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(300);
  };
  await drag([css(wa.l) + 2, css(wa.y)], [css(wb.r) - 2, css(wb.y)]);
  k = await p.evaluate(() => window.S.peek());
  check('a drag across two lines of a chat bubble selects exactly what it crossed', k.selText === 'sunny porch shelf because the kitchen window', k.selText);
  await p.screenshot({ path: OUT + '/01-chat-drag.png' });
  // drag inside the first message only
  const wc = k.words.find(w => w.t === 'refactoring'), wd = k.words.find(w => w.t === 'handled.');
  await drag([css(wc.l) + 2, css(wc.y)], [css(wd.r) - 2, css(wd.y)]);
  k = await p.evaluate(() => window.S.peek());
  check('a drag in another bubble selects its words', k.selText === 'refactoring the way Nostr IDs are handled.', k.selText);
  check('a one-word message sits on its bubble', (() => { const w = k.words.find(x => x.t === 'cool!'), L = scr.truth.find(x => x.t === 'cool!'); return w && Math.abs(css(w.y) - L.y) < 7 && Math.abs(css(w.l) - L.x0) < 4; })());
  await p.screenshot({ path: OUT + '/02-chat-drag2.png' });
  await b.close();
  console.log(`${pass}/${pass + fail} passed · ${OUT}`);
  process.exit(fail ? 1 : 0);
})();
