// Smoke QA of the share-agents staging preview with the real agent registry (read-only origin: every write 403s).
// Phone context: open the first thread with an answer, Share → Agents row names come from the live registry,
// tap Philosopher → a new Philosopher chat with the quote staged; no write is attempted (receipt.refused unchanged).
// Usage: QA_PLAYWRIGHT=<module> QA_OUT=<dir> node tools/qa-share-agents-preview.cjs <preview origin>
const { chromium } = require('./qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const BASE = (process.argv[2] || '').replace(/\/$/, '');
const OUT = process.env.QA_OUT || path.join(process.cwd(), 'out-preview');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, JSON.stringify(e).slice(0, 600)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', bypassCSP: true, // Playwright's waitForFunction needs eval under the preview CSP
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    const writes = [];
    ctx.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.method() + ' ' + new URL(r.url()).pathname); });
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => errors.push(String(e)));
    const r0 = await (await ctx.request.get(BASE + '/__preview/receipt')).json();
    await p.goto(BASE + '/wizard-os-home/?open=chats&shell=phone', { waitUntil: 'load' });
    // The live list read can exceed the client's 30 s deadline when the box is loaded; the share sheet does not
    // need it. Use a real thread when the list is up, else share an answer from Home through the same entry point.
    await p.waitForFunction(() => window.__wos && window.WosChat && (window.WosAgents?.list || []).length > 0, null, { timeout: 60000 });
    await p.waitForFunction(() => window.__wos.live.ok, null, { timeout: 45000 }).catch(() => {});
    const reg = await p.evaluate(() => window.WosAgents.visible().map(a => a.label));
    const sid = await p.evaluate(() => window.__wos.live.ok ? ((window.__wos.live.sessions || []).find(s => s.latest_message?.role === 'assistant' && !window.__wos.live.isPrivate?.(s.id))?.id || '') : '');
    let hasMsg = false, wid = '';
    if (sid) {
      wid = await p.evaluate(sid => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); if (__wos.chats.winAgent(w)) __wos.chats.setFocus(w, null); __wos.openChat(w.id, sid); __wos.focusWin(w.id); return w.id; }, sid);
      hasMsg = await p.waitForSelector(`[data-chats="${wid}"] .msg.a [data-mshare]`, { timeout: 20000 }).then(() => true, () => false);
    }
    console.log('INFO path:', hasMsg ? 'real thread' : 'Home share (live list read too slow)');
    hasMsg = true;
    if (hasMsg) {
      if (wid && await p.$(`[data-chats="${wid}"] .msg.a [data-mshare]`)) await p.locator(`[data-chats="${wid}"] .msg.a [data-mshare]`).last().evaluate(el => el.click());
      else await p.evaluate(() => { window.WosChat.shareAssistantText('Preview check: an answer to pass on to another agent.'); });
      await p.waitForSelector('.wos-share.on'); await sleep(1000);
      const s = await p.evaluate(() => ({ subs: [...document.querySelectorAll('.wos-share .shs-sub')].map(x => x.textContent), agents: [...document.querySelectorAll('.wos-share [data-shs-agent] .shs-nm')].map(x => x.textContent), apps: [...document.querySelectorAll('.wos-share [data-shs-app]')].map(x => x.dataset.shsApp), preview: document.querySelector('.wos-share .shs-prev')?.textContent || '' }));
      ok(s.subs[0] === 'Agents' && JSON.stringify(s.agents) === JSON.stringify(reg), 'preview: Agents row matches the live registry (visible agents, main first)', { s, reg });
      ok(s.apps.includes('messenger') && !s.subs.includes('People'), 'preview: Messenger under Apps, no People row', s);
      ok(/^From \S/.test(s.preview), 'preview: attribution line kept', s.preview);
      await p.screenshot({ path: path.join(OUT, 'preview-phone-sheet.png') });
      const target = await p.evaluate(() => (window.WosAgents.visible().find(a => !a.is_default && a.privacy !== 'private') || window.WosAgents.visible()[0]).id);
      const b = await p.locator(`[data-shs-agent="${target}"]`).boundingBox();
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      const st = await (async () => { for (let i = 0; i < 80; i++) { const v = await p.evaluate(t => { const w = Object.values(__wos.wins).find(x => x.app === 'chats' && (__wos.chats.winAgent(x) === t || (!__wos.chats.winAgent(x) && t === window.WosAgents.defaultId()))); const ta = w && document.querySelector(`[data-chats="${w.id}"] .ch-compose textarea`); return ta?.value ? { thread: w.thread, text: ta.value, empty: document.querySelector(`[data-chats="${w.id}"] .ch-empty`)?.innerText || '' } : null; }, target); if (v) return v; await sleep(100); } return null; })();
      ok(st && st.thread === '__new__' && /^From [^\n]+:\n> /.test(st.text), `preview: tapping ${target} opens a new chat with the quote staged`, st);
      await sleep(1500);
      await p.screenshot({ path: path.join(OUT, 'preview-phone-staged.png') });
    }
    const r1 = await (await ctx.request.get(BASE + '/__preview/receipt')).json();
    ok(r1.sha === r0.sha && !writes.some(w => /runs|messages|chat/.test(w)), 'preview: nothing was sent', { writes, r0, r1 });
    ok(errors.length === 0, 'preview: no page errors', errors);
  } catch (e) { console.error(e); fail++; }
  finally { await browser.close(); }
  console.log(`${pass} pass, ${fail} fail`); process.exitCode = fail ? 1 : 0;
})();
