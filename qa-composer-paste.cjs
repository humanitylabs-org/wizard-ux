// QA: dictation-app pastes land in the Chats composer, even while a working thread repaints.
// Novaire, 21 Oct 2026 (wizard-ux #243): long Wispr Flow takes vanished on Mac Chrome. Wispr pastes with a synthetic
// Cmd+V and restores the old clipboard straight after; Chrome's default paste re-reads the system clipboard, so on a
// busy page nothing landed although the paste event carried the words. A synthetic paste event reproduces exactly
// that state: the event carries the text and the browser performs no default insertion.
// Usage: QA_WEB_DIR=<repo> [QA_CHROME=<chrome>] node qa-composer-paste.cjs [origin]. Every write is intercepted.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = process.argv[2] || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const WEB = process.env.QA_WEB_DIR || __dirname;
const OUT = process.env.QA_OUT || path.join(__dirname, 'qa-composer-paste');
const EXEC = process.env.QA_CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0, revision = 1;
const writes = [], now = Date.now() / 1000, SID = 'qa_paste_live';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ok(v, name, ev = {}) { if (v) { pass++; console.log('PASS', name, JSON.stringify(ev).slice(0, 300)); } else { fail++; console.log('FAIL', name, JSON.stringify(ev).slice(0, 600)); } }
function rows() {
  const a = [];
  for (let i = 0; i < 8; i++) a.push({ id: i + 1, session_id: SID, role: i % 2 ? 'assistant' : 'user', content: `Launch note ${i}. ` + 'Status words. '.repeat(10), timestamp: now - 600 + i });
  for (let i = 1; i <= revision; i++) { a.push({ id: 100 + i * 2, session_id: SID, role: 'assistant', content: '', timestamp: now - 100 + i, tool_calls: [{ id: 's' + i, type: 'function', function: { name: 'tool', arguments: '{}' }, display_label: 'Launch step ' + i }] }); a.push({ id: 101 + i * 2, session_id: SID, role: 'tool', content: '{"ok":true}', timestamp: now - 99 + i, tool_call_id: 's' + i }); }
  return a;
}
function session(i) { return { id: i === 0 ? SID : 'qa_paste_' + i, source: 'wizard-mobile', title: i === 0 ? 'Launch Status' : `Other ${i}`, status: i === 0 ? 'running' : 'idle', archived: false, hidden: false, message_count: rows().length, started_at: now - 600, last_active: now - i + revision, wizard_last_user_at: now - 300, wizard_last_assistant_at: now - i + revision, wizard_activity_at: now - i + revision, wizard_run_id: i === 0 ? 'qa-paste-run' : undefined, latest_message: { role: 'tool', content: 'Revision ' + revision, timestamp: now + revision }, last_user_message: { role: 'user', content: 'Status?', timestamp: now - 300 } }; }
(async () => {
  let b;
  try {
    b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
    const ctx = await b.newContext({ viewport: { width: 1512, height: 920 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', serviceWorkers: 'block' });
    await ctx.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), m = q.method();
      const json = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (m === 'POST' && u.pathname === '/wizard/files/upload') { writes.push({ method: m, path: u.pathname }); return json({ file: { id: 'qa-file-1', filename: q.headers()['x-wizard-filename'] || 'upload', mime: 'image/png', bytes: 68 } }); }
      if (m !== 'GET' && m !== 'HEAD') { writes.push({ method: m, path: u.pathname }); return json({ ok: true, state: { initializedAt: Date.now(), threads: {} } }); }
      if (u.pathname.startsWith('/wizard-os-home/')) {
        const f = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
        if (!f.includes('..')) { const fp = path.join(WEB, 'web', f); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : undefined, body: fs.readFileSync(fp) }); }
        if (/^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      }
      if (u.pathname === '/wizard/hermes/api/sessions') { const off = +(u.searchParams.get('offset') || 0), all = Array.from({ length: 12 }, (_, i) => session(i)), lim = +(u.searchParams.get('limit') || 100), page = all.slice(off, off + lim); return json({ object: 'list', data: page, has_more: false, pagination: { limit: lim, offset: off, returned: page.length, has_more: false } }); }
      if (u.pathname === `/wizard/hermes/api/sessions/${SID}/messages`) { const all = rows(), off = +(u.searchParams.get('offset') || 0), lim = +(u.searchParams.get('limit') || 500), page = all.slice(off, off + lim); return json({ object: 'list', data: page, pagination: { limit: lim, offset: off, returned: page.length } }); }
      if (u.pathname === `/wizard/hermes/api/sessions/${SID}`) return json({ session: session(0) });
      if (u.pathname.includes('/v1/runs/qa-paste-run')) return u.pathname.endsWith('/events') ? r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }) : json({ run_id: 'qa-paste-run', status: 'running', session_id: SID });
      if (/\/wizard\/(thread-seen|thread-dispositions)/.test(u.pathname)) return json({ state: { initializedAt: Date.now(), threads: {} } });
      if (u.origin !== new URL(ORIGIN).origin) return r.abort();
      return json({});
    });
    await ctx.addInitScript(() => {
      localStorage.setItem('wos.coached', 'true');
      // The page must never read the clipboard itself (no polling, no focus-time baseline).
      window.__clipReads = 0;
      try { if (navigator.clipboard) navigator.clipboard.readText = () => { window.__clipReads++; return Promise.resolve('UNRELATED OLD CLIPBOARD'); }; } catch (_) {}
    });
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(ORIGIN, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__wux?.live, null, { timeout: 45000 });
    await p.waitForSelector(`.pane-list [data-chopen="${SID}"]`, { timeout: 30000 });
    await p.click(`.pane-list [data-chopen="${SID}"]`);
    await p.waitForSelector('.pane-main .ch-compose textarea'); await sleep(800);
    const TA = '.pane-main .ch-compose textarea';
    const repaint = async () => { revision++; await p.evaluate(() => __wux.live.refresh()); await p.waitForFunction(rev => document.querySelector('.pane-main .ch-msgs')?.textContent.includes('Launch step ' + rev), revision, { timeout: 8000 }); await sleep(200); };
    // Fire a paste exactly as Chrome delivers Wispr's synthetic Cmd+V: an event carrying the take, no default insertion.
    const paste = (data, files = []) => p.evaluate(({ sel, data, files }) => {
      const t = document.querySelector(sel), dt = new DataTransfer();
      for (const [type, v] of Object.entries(data)) dt.setData(type, v);
      for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), c => c.charCodeAt(0))], f.name, { type: f.type }));
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      t.dispatchEvent(ev);
      return { prevented: ev.defaultPrevented };
    }, { sel: TA, data, files });
    const read = () => p.evaluate(sel => { const t = document.querySelector(sel); return { v: t.value, s: t.selectionStart, focused: document.activeElement === t, hasText: !!t.form?.classList.contains('has-text'), reads: window.__clipReads }; }, TA);

    await p.click(TA); await p.keyboard.insertText('Before after');
    await p.evaluate(sel => { const t = document.querySelector(sel); t.setSelectionRange(7, 7); }, TA);
    const r1 = await paste({ 'text/plain': 'middle ' }); await sleep(100);
    const a1 = await read();
    ok(r1.prevented && a1.v === 'Before middle after' && a1.s === 14, 'text paste inserts the take at the caret', { r1, a1 });

    await p.evaluate(sel => { const t = document.querySelector(sel); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); }, TA);
    const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of a long dictation take about launch priorities.`).join(' ');
    const crlf = 'Line one\r\nLine two';
    await paste({ 'text/plain': long }); await paste({ 'text/plain': ' ' + crlf }); await sleep(100);
    const a2 = await read();
    ok(a2.v === long + ' Line one\nLine two', `long take (${long.length} chars) lands in full, CRLF normalised`, { len: a2.v.length });
    ok(a2.hasText, 'the composer treats the pasted take as a draft (send enabled)', a2);

    // The race that lost takes: paste lands, then a live repaint rebuilds the thread in the same moment.
    await p.evaluate(sel => { const t = document.querySelector(sel); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }, TA);
    await paste({ 'text/plain': ' TAKE-DURING-REPAINT' });
    await repaint(); await repaint();
    const a3 = await read();
    ok(a3.v.endsWith('TAKE-DURING-REPAINT') && a3.focused && a3.s === a3.v.length, 'a take pasted during live repaints survives with focus and caret', { tail: a3.v.slice(-30), s: a3.s, len: a3.v.length, focused: a3.focused });

    const before4 = (await read()).v;
    await paste({ 'text/html': '<b>bold</b> <i>words</i>', 'text/plain': ' bold words' }); await sleep(100);
    ok((await read()).v === before4 + ' bold words', 'rich-text paste inserts plain text');

    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const before5 = (await read()).v;
    const r5 = await paste({}, [{ name: 'image.png', type: 'image/png', b64: png }]); await sleep(500);
    const tray = await p.evaluate(() => document.querySelectorAll('.pane-main .ch-tray > *').length);
    ok(r5.prevented && tray >= 1 && (await read()).v === before5, 'a pasted photo goes to the attachment tray, text untouched', { r5, tray });

    // Empty paste (the dictation app restored its clipboard first): nothing invented, no clipboard read, a hint shows.
    const before6 = (await read()).v;
    const r6 = await paste({}); await sleep(700);
    const a6 = await read();
    const toastTxt = await p.evaluate(() => [...document.querySelectorAll('#toast, .toast')].map(t => t.textContent).join(' | '));
    ok(!r6.prevented && a6.v === before6 && a6.reads === 0, 'empty paste inserts nothing and never reads the clipboard', { r6, reads: a6.reads });
    ok(/Paste arrived empty/.test(toastTxt), 'empty paste explains how to get the take back', { toastTxt });
    // Empty paste then the owner moves to another field: focus is never pulled back to the composer.
    await paste({}); await p.click('.pane-list [data-chsearch]'); await sleep(700);
    const a7 = await p.evaluate(sel => ({ inSearch: document.activeElement?.matches?.('[data-chsearch]'), v: document.querySelector(sel).value }), TA);
    ok(a7.inSearch && a7.v === before6, 'focus stays where the owner moved it after an empty paste', a7);

    // Rename sheet survives a live repaint (second item in #243).
    await p.click('.pane-main [data-chrename]'); await p.waitForSelector('.ch-rename input');
    await p.keyboard.press('ControlOrMeta+a'); await p.keyboard.type('Launch · Paste fix');
    await repaint();
    const rn = await p.evaluate(() => { const i = document.querySelector('.ch-rename input'); return { open: !!i, focused: document.activeElement === i, v: i?.value }; });
    ok(rn.open && rn.focused && rn.v === 'Launch · Paste fix', 'Rename sheet stays open, focused and keeps the typed name through a repaint', rn);
    if (rn.open) await p.click('[data-rncancel]');
    await p.screenshot({ path: path.join(OUT, 'composer-after-pastes.png') });
    ok(errors.length === 0, 'zero page errors', errors);
    ok(!writes.some(w => w.method === 'POST' && /\/v1\/(runs|chat|responses)/.test(w.path)), 'no message was sent', writes.slice(0, 10));
    console.log(`${pass} pass, ${fail} fail`);
  } catch (e) { console.error(e); fail++; console.log(`${pass} pass, ${fail} fail`); } finally { if (b) await b.close(); }
  process.exitCode = fail ? 1 : 0;
})();
