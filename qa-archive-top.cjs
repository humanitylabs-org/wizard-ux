// Chats section order (James, 6 Nov 2026: Archive back at the bottom, desktop and phone). Stock: Archive is the last
// section in By status and By day. Miguel's "Archive on top" tweak (miguel/archive-top) is the only way to put it first.
// Renders the real core/chats.css (+ obsidian skin on phone, + the tweak's css) against a minimal list DOM; no network, no writes.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const WEB = process.env.QA_WEB_DIR ? path.join(process.env.QA_WEB_DIR, 'web') : path.join(__dirname, 'web');
const css = fs.readFileSync(path.join(WEB, 'core/chats.css'), 'utf8');
const obsidian = fs.readFileSync(path.join(WEB, 'skins/obsidian/skin.css'), 'utf8');
const tweak = fs.readFileSync(path.join(WEB, 'tweaks/miguel/archive-top/tweak.css'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n, x)); };
// The DOM order core/chats.js renders (SECTIONS_STATUS / SECTIONS_DAY), Pinned first when present.
const STATUS = ['pinned', 'errors', 'working', 'ready', 'deferred', 'archive'];
const DAY = ['pinned', 'errors', 'working', 'ready', 'yesterday', 'pastWeek', 'deferred', 'archive'];
const page = ({ shell, skin, extra = '', tweaks = '', byStatus }) => `<!doctype html><html${shell ? ` data-shell="${shell}"` : ''}${skin ? ` data-skin="${skin}"` : ''}${tweaks ? ` data-tweaks="${tweaks}"` : ''}><style>:root{--ink:#fff;--bg:#000;--line:#333}body{margin:0}.ch-list{height:800px;display:flex;flex-direction:column}${css}${extra}</style><body><div class="ch-list${byStatus ? ' by-status' : ''}"><div class="ch-scroll">${(byStatus ? STATUS : DAY).map(k => `<section class="ch-sec" data-sec="${k}"><div class="ch-sec-h" style="height:40px">${k}</div><div class="ch-sec-b" style="height:30px"></div></section>`).join('')}</div></div></body></html>`;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  const cases = [];
  for (const [label, vp, shell, skin, skinCss] of [['desktop', { width: 1200, height: 900 }, 'desktop', '', ''], ['phone', { width: 390, height: 844 }, 'phone', '', ''], ['phone, obsidian skin', { width: 390, height: 844 }, 'phone', 'obsidian', obsidian]])
    for (const byStatus of [true, false]) for (const on of [false, true]) cases.push({ label: `${label}, ${byStatus ? 'By status' : 'By day'}, archive-top ${on ? 'on' : 'off'}`, vp, shell, skin, byStatus, on, extra: skinCss + (on ? tweak : ''), tweaks: on ? 'wizard/unified-inbox miguel/archive-top' : 'wizard/unified-inbox' });
  for (const c of cases) {
    const ctx = await b.newContext({ viewport: c.vp }), p = await ctx.newPage();
    await p.setContent(page(c));
    const ys = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ch-sec')].map(e => [e.dataset.sec, e.getBoundingClientRect().top])));
    const order = Object.keys(ys).sort((a, z) => ys[a] - ys[z]);
    if (c.on) ok(order[0] === 'archive', `${c.label}: Archive first`, order.join('>'));
    else ok(order.at(-1) === 'archive', `${c.label}: Archive last`, order.join('>'));
    if (c.byStatus) ok(order.indexOf('working') < order.indexOf('ready'), `${c.label}: Working above Ready (unchanged)`, order.join('>'));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
})();
