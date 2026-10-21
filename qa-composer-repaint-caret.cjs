// Thales-only: a live thread repaint must not move the composer's scroll, caret or focus while the owner types.
// James, 21 Oct 2026: replying on desktop in a working thread, the reply box kept jumping to the top of the text.
// Candidate assets at the real origin, SW blocked, every non-GET/HEAD request fulfilled locally (no sends).
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright-core');
const fs = require('fs'), path = require('path');
const ORIGIN = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const OUT = process.env.QA_OUT || path.join(__dirname, 'qa-composer-caret');
const EXEC = process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0, revision = 1;
const writes = [], now = Date.now() / 1000, SID = 'qa_caret_live';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ok(v, name, ev = {}) { if (v) { pass++; console.log('PASS', name, JSON.stringify(ev)); } else { fail++; console.log('FAIL', name, JSON.stringify(ev)); } }
function rows() {
  const a = [];
  for (let i = 0; i < 8; i++) a.push({ id: i + 1, session_id: SID, role: i % 2 ? 'assistant' : 'user', content: `Launch note ${i}. ` + 'Status words. '.repeat(10), timestamp: now - 600 + i });
  for (let i = 1; i <= revision; i++) { a.push({ id: 100 + i * 2, session_id: SID, role: 'assistant', content: '', timestamp: now - 100 + i, tool_calls: [{ id: 's' + i, type: 'function', function: { name: 'tool', arguments: '{}' }, display_label: 'Launch step ' + i }] }); a.push({ id: 101 + i * 2, session_id: SID, role: 'tool', content: '{"ok":true}', timestamp: now - 99 + i, tool_call_id: 's' + i }); }
  return a;
}
function session(i) { return { id: i === 0 ? SID : 'qa_caret_' + i, source: 'wizard-mobile', title: i === 0 ? 'Launch Status' : `Other ${i}`, status: i === 0 ? 'running' : 'idle', archived: false, hidden: false, message_count: rows().length, started_at: now - 600, last_active: now - i + revision, wizard_last_user_at: now - 300, wizard_last_assistant_at: now - i + revision, wizard_activity_at: now - i + revision, wizard_run_id: i === 0 ? 'qa-caret-run' : undefined, latest_message: { role: 'tool', content: 'Revision ' + revision, timestamp: now + revision }, last_user_message: { role: 'user', content: 'Status?', timestamp: now - 300 } }; }
(async () => {
  let b;
  try {
    b = await chromium.launch({ executablePath: EXEC });
    const ctx = await b.newContext({ viewport: { width: 1512, height: 920 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', serviceWorkers: 'block' });
    await ctx.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), m = q.method();
      const json = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (m !== 'GET' && m !== 'HEAD') { writes.push({ method: m, path: u.pathname }); return json({ ok: true, state: { initializedAt: Date.now(), threads: {} } }); }
      if (process.env.QA_LIVE !== '1' && u.pathname.startsWith('/wizard-os-home/')) {
        const f = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
        if (!f.includes('..')) { const fp = path.join(WEB, 'web', f); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : undefined, body: fs.readFileSync(fp) }); }
      }
      if (u.pathname === '/wizard/hermes/api/sessions') { const off = +(u.searchParams.get('offset') || 0), all = Array.from({ length: 12 }, (_, i) => session(i)), lim = +(u.searchParams.get('limit') || 100), page = all.slice(off, off + lim); return json({ object: 'list', data: page, has_more: false, pagination: { limit: lim, offset: off, returned: page.length, has_more: false } }); }
      if (u.pathname === `/wizard/hermes/api/sessions/${SID}/messages`) { const all = rows(), off = +(u.searchParams.get('offset') || 0), lim = +(u.searchParams.get('limit') || 500), page = all.slice(off, off + lim); return json({ object: 'list', data: page, pagination: { limit: lim, offset: off, returned: page.length } }); }
      if (u.pathname === `/wizard/hermes/api/sessions/${SID}`) return json({ session: session(0) });
      if (u.pathname.includes('/v1/runs/qa-caret-run')) return u.pathname.endsWith('/events') ? r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }) : json({ run_id: 'qa-caret-run', status: 'running', session_id: SID });
      if (/\/wizard\/(thread-seen|thread-dispositions)/.test(u.pathname)) return json({ state: { initializedAt: Date.now(), threads: {} } });
      return r.continue();
    });
    await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); });
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(ORIGIN, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__wux?.live, null, { timeout: 45000 });
    await p.waitForSelector(`.pane-list [data-chopen="${SID}"]`, { timeout: 30000 });
    await p.click(`.pane-list [data-chopen="${SID}"]`);
    await p.waitForSelector('.pane-main .ch-compose textarea'); await sleep(800);
    const TA = '.pane-main .ch-compose textarea';
    await p.click(TA);
    // A long reply: the box reaches its max height and scrolls; the owner is typing at the bottom.
    const lines = Array.from({ length: 18 }, (_, i) => `Line ${i + 1} of my reply about the launch status and what to do next.`).join('\n');
    await p.keyboard.insertText(lines); await p.keyboard.type(' still typing');
    await sleep(300);
    const read = () => p.evaluate(sel => { const t = document.querySelector(sel); window.__taNode ||= t; return { same: t === window.__taNode, focused: document.activeElement === t, top: t.scrollTop, max: t.scrollHeight - t.clientHeight, s: t.selectionStart, e: t.selectionEnd, len: t.value.length }; }, TA);
    const before = await read();
    ok(before.max > 40 && before.top >= before.max - 2 && before.focused, 'setup: long reply scrolls and the view sits at the bottom where the caret is', before);
    const repaint = async () => { revision++; await p.evaluate(() => __wux.live.refresh()); await p.waitForFunction(rev => document.querySelector('.pane-main .ch-msgs')?.textContent.includes('Launch step ' + rev), revision, { timeout: 8000 }); await sleep(250); };
    for (let k = 0; k < 3; k++) {
      await repaint();
      const a = await read();
      ok(a.focused, `repaint ${k + 1}: composer keeps focus`, a);
      ok(a.top >= a.max - 2, `repaint ${k + 1}: composer stays scrolled to the bottom (no jump to top)`, a);
      ok(a.s === a.len && a.e === a.len, `repaint ${k + 1}: caret stays at the end`, a);
      await p.keyboard.type(' x'); await sleep(150);
      const t = await read();
      ok(t.top >= t.max - 2 && t.s === t.len, `repaint ${k + 1}: typing right after still lands at the bottom`, t);
    }
    // Editing in the middle: caret, selection and scroll stay where the owner put them.
    await p.evaluate(sel => { const t = document.querySelector(sel); const i = t.value.indexOf('Line 6'); t.setSelectionRange(i, i + 4); t.scrollTop = 40; }, TA);
    await sleep(200);
    const mid = await read();
    await repaint();
    const mid2 = await read();
    ok(mid2.focused && mid2.s === mid.s && mid2.e === mid.e, 'mid-text selection survives a repaint', { mid, mid2 });
    ok(Math.abs(mid2.top - mid.top) <= 2, 'mid-text scroll position survives a repaint', { mid, mid2 });
    // Unfocused composer with a draft: a repaint must not steal focus.
    await p.evaluate(() => document.activeElement.blur()); await repaint();
    ok(await p.evaluate(sel => document.activeElement !== document.querySelector(sel), TA), 'unfocused composer is not focused by a repaint');
    ok(await p.evaluate(sel => document.querySelector(sel).value.includes('still typing'), TA), 'draft text survives repaints');
    await p.screenshot({ path: path.join(OUT, 'composer-after-repaints.png') });
    ok(errors.length === 0, 'zero page errors', errors);
    ok(!writes.some(w => /\/(runs|chat|responses)/.test(w.path) && w.method === 'POST' && !/thread-seen|dispositions|drafts?/.test(w.path)), 'no message was sent', writes.slice(0, 10));
    console.log(`${pass} pass, ${fail} fail`);
  } catch (e) { console.error(e); fail++; } finally { if (b) await b.close(); }
  process.exitCode = fail ? 1 : 0;
})();
