// Focused QA: any attachment turns the composer mic into Send, including attachment-only drafts.
// Covers the mobile main and routed-agent composers plus post-send reset. Every write is intercepted.
// Usage: QA_WEB_DIR=<repo> QA_PLAYWRIGHT=<module> node qa-composer-attachment-send.cjs [origin]
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = process.argv[2] || 'http://127.0.0.1:9475/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const OUT = process.env.QA_OUT || path.join(__dirname, 'qa-composer-attachment-send');
const SID = 'qa_attachment_send';
const now = Date.now() / 1000;
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0, uploadN = 0, uploadGate = null;
const writes = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ok(value, name, evidence = {}) {
  if (value) { pass++; console.log('PASS', name, JSON.stringify(evidence).slice(0, 300)); }
  else { fail++; console.log('FAIL', name, JSON.stringify(evidence).slice(0, 600)); }
}
function session() {
  return {
    id: SID, source: 'wizard-mobile', title: 'Attachment send QA', status: 'completed', archived: false, hidden: false,
    message_count: 2, started_at: now - 600, last_active: now - 60, wizard_last_user_at: now - 120,
    wizard_last_assistant_at: now - 60, wizard_activity_at: now - 60,
    latest_message: { role: 'assistant', content: 'Ready.', timestamp: now - 60 },
    last_user_message: { role: 'user', content: 'Can you check this?', timestamp: now - 120 },
  };
}
const rows = () => [
  { id: 1, session_id: SID, role: 'user', content: 'Can you check this?', timestamp: now - 120 },
  { id: 2, session_id: SID, role: 'assistant', content: 'Ready.', timestamp: now - 60 },
];
const visibleState = (p, composer) => p.evaluate(sel => {
  const form = document.querySelector(sel);
  const visible = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  return {
    send: visible(form?.querySelector('.ch-send')),
    mic: visible(form?.querySelector('[data-chmic]')),
    hasContent: !!form?.classList.contains('has-text'),
    tray: form?.querySelectorAll('.ch-tray .ch-att').length || 0,
    text: form?.querySelector('textarea')?.value || '',
    textFocused: document.activeElement === form?.querySelector('textarea'),
  };
}, composer);
const pasteImage = (p, textarea, name = 'pasted-image.png') => p.evaluate(({ sel, name }) => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([png], name, { type: 'image/png' }));
  const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.querySelector(sel).dispatchEvent(event);
  return event.defaultPrevented;
}, { sel: textarea, name });
const dropImage = (p, textarea, name = 'dropped-image.png') => p.evaluate(({ sel, name }) => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([png], name, { type: 'image/png' }));
  const event = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
  document.querySelector(sel).dispatchEvent(event);
  return event.defaultPrevented;
}, { sel: textarea, name });
const waitUploaded = (p, composer, count = 1) => p.waitForFunction(({ sel, count }) => document.querySelectorAll(sel + ' .ch-tray .ch-att:not(.up)').length === count, { sel: composer, count }, { timeout: 8000 });
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); } return fn(); };

(async () => {
  let browser;
  try {
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    await ctx.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (method !== 'GET' && method !== 'HEAD') {
        let body = null; try { body = JSON.parse(request.postData() || '{}'); } catch (_) { body = request.postData() || ''; }
        writes.push({ method, path: url.pathname, body, filename: request.headers()['x-wizard-filename'] || '' });
        if (url.pathname === '/wizard/files/upload') {
          if (uploadGate) { const gate = uploadGate; uploadGate = null; await gate; }
          uploadN++; return json({ file: { id: `qa-file-${uploadN}`, filename: request.headers()['x-wizard-filename'] || 'upload', mime: request.headers()['x-wizard-mime'] || 'application/octet-stream', bytes: request.postDataBuffer()?.length || 1 } }, 201);
        }
        if (url.pathname === '/wizard/hermes/v1/runs') return json({ run_id: `qa-run-${writes.length}`, status: 'queued', session_id: body.session_id || SID }, 202);
        if (/\/wizard\/hermes\/v1\/runs\/[^/]+\/steer$/.test(url.pathname)) return json({ accepted: true }, 202);
        return json({ ok: true, state: { initializedAt: Date.now(), threads: {} } });
      }
      if (url.pathname.startsWith('/wizard-os-home/')) {
        const rel = decodeURIComponent(url.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
        if (!rel.includes('..')) {
          const file = path.join(WEB, 'web', rel);
          if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ status: 200, contentType: rel.endsWith('.css') ? 'text/css' : rel.endsWith('.html') ? 'text/html' : rel.endsWith('.svg') ? 'image/svg+xml' : rel.endsWith('.json') || rel.endsWith('.webmanifest') ? 'application/json' : 'application/javascript', body: fs.readFileSync(file) });
        }
        if (/^(data|summaries)\.js$/.test(rel)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      }
      if (url.pathname === '/wizard/v1/agents') return json({ agents: [
        { id: 'hermes', is_default: true, label: 'Hermes', harness: 'hermes', privacy: 'standard', status: 'running' },
        { id: 'private', label: 'Private', harness: 'hermes', privacy: 'private', status: 'running' },
      ] });
      if (url.pathname === '/wizard/hermes/api/sessions') return json({ object: 'list', data: [session()], has_more: false, pagination: { limit: 100, offset: 0, returned: 1, has_more: false } });
      if (url.pathname === `/wizard/hermes/api/sessions/${SID}/messages`) return json({ object: 'list', data: rows(), pagination: { limit: 500, offset: 0, returned: 2 } });
      if (url.pathname === `/wizard/hermes/api/sessions/${SID}`) return json({ session: session() });
      if (/\/wizard\/hermes\/v1\/runs\//.test(url.pathname)) return url.pathname.endsWith('/events') ? route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }) : json({ run_id: 'qa-run', status: 'queued', session_id: SID });
      if (url.pathname === '/wizard/hermes/api/model/options') return json({ model: 'fixture-model', provider: 'fixture', providers: [{ slug: 'fixture', name: 'Synthetic fixture route', authenticated: true, is_current: true, models: ['fixture-model'] }] });
      if (url.pathname === '/wizard/thread-seen' || url.pathname === '/wizard/thread-dispositions') return json({ state: { initializedAt: Date.now(), threads: {} } });
      return json({});
    });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); });
    await page.goto(ORIGIN, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_attachment_send'), null, { timeout: 30000 });

    const mainWid = await page.evaluate(sid => { const w = Object.values(__wos.wins).find(x => x.app === 'chats' && !x.agent); __wos.openChat(w.id, sid); return w.id; }, SID);
    const main = `[data-chats="${mainWid}"] .ch-compose`;
    const mainTa = `${main} textarea`;
    await page.waitForSelector(mainTa);
    let state = await visibleState(page, main);
    ok(state.mic && !state.send && !state.hasContent, 'mobile main: an empty draft shows the mic', state);

    await page.locator(mainTa).focus();
    let releaseUpload;
    uploadGate = new Promise(resolve => { releaseUpload = resolve; });
    ok(await pasteImage(page, mainTa), 'mobile main: image paste is claimed by the attachment path');
    await page.waitForFunction(sel => document.querySelectorAll(sel + ' .ch-tray .ch-att.up').length === 1, main);
    state = await visibleState(page, main);
    ok(state.send && !state.mic && state.hasContent && state.tray === 1, 'mobile main: a staged image shows Send before its upload receipt exists', state);
    releaseUpload();
    await waitUploaded(page, main);
    state = await visibleState(page, main);
    ok(state.send && !state.mic && state.hasContent && state.tray === 1, 'mobile main: pasted image with no caption shows Send', state);

    await page.locator(mainTa).fill('Caption'); await sleep(100);
    state = await visibleState(page, main);
    ok(state.send && !state.mic && state.text === 'Caption' && state.tray === 1, 'mobile main: combined text and image keeps Send', state);
    await page.locator(`${main} [data-attrm]`).evaluate(el => el.click()); await sleep(150);
    state = await visibleState(page, main);
    ok(state.send && !state.mic && state.text === 'Caption' && state.tray === 0, 'mobile main: removing the image keeps Send while text remains', state);
    await page.locator(mainTa).fill(''); await sleep(100);
    state = await visibleState(page, main);
    ok(state.mic && !state.send && !state.hasContent, 'mobile main: clearing the last content returns to the mic', state);

    await page.locator(mainTa).blur();
    ok(await dropImage(page, mainTa, 'dropped-main-image.png'), 'mobile main: a dropped image is claimed by the attachment path');
    await waitUploaded(page, main);
    state = await visibleState(page, main);
    ok(state.send && !state.mic && !state.textFocused, 'mobile main: dropped image shows Send without focusing the text field', state);

    const beforeSend = writes.length;
    await page.locator(`${main} .ch-send`).evaluate(el => el.click());
    const attachmentRun = await until(() => writes.slice(beforeSend).find(w => w.path === '/wizard/hermes/v1/runs' && Array.isArray(w.body?.wizard_file_ids) && w.body.wizard_file_ids.length === 1));
    ok(attachmentRun && attachmentRun.body.input === 'Please use the attached file.', 'mobile main: attachment-only Send admits one file message', attachmentRun || writes.slice(beforeSend));
    await page.waitForFunction(() => Object.values(__wos.wins).find(w => w.app === 'chats' && !w.agent)?.thread == null, null, { timeout: 8000 });
    await page.evaluate(sid => { const w = Object.values(__wos.wins).find(x => x.app === 'chats' && !x.agent); __wos.openChat(w.id, sid); }, SID);
    await page.waitForSelector(mainTa);
    state = await visibleState(page, main);
    ok(state.mic && !state.send && state.tray === 0 && state.text === '', 'mobile main: post-send composer resets to the mic', state);

    await page.evaluate(() => window.WizOpenAgentChats('private', { thread: '__new__' }));
    const privateWid = await page.waitForFunction(() => Object.values(window.__wos?.wins || {}).find(w => w.app === 'chats' && w.agent === 'private')?.id || '', null, { timeout: 8000 }).then(handle => handle.jsonValue());
    const routed = `[data-chats="${privateWid}"] .ch-compose`;
    const routedTa = `${routed} textarea`;
    await page.waitForSelector(routedTa);
    await page.locator(routedTa).blur();
    ok(await dropImage(page, routedTa, 'private-image.png'), 'mobile routed agent: a dropped image is claimed by the attachment path');
    await waitUploaded(page, routed);
    state = await visibleState(page, routed);
    ok(state.send && !state.mic && state.tray === 1 && !state.textFocused, 'mobile routed agent: attachment-only draft shows Send without focusing text', state);
    await page.locator(`${routed} [data-attrm]`).evaluate(el => el.click()); await sleep(150);
    state = await visibleState(page, routed);
    ok(state.mic && !state.send && state.tray === 0, 'mobile routed agent: removing the last attachment returns to the mic', state);

    await page.screenshot({ path: path.join(OUT, 'mobile-routed-empty-after-remove.png'), fullPage: true });
    ok(errors.length === 0, 'mobile attachment QA has no page errors', errors);
    console.log(`${pass} pass, ${fail} fail`);
    await ctx.close();
  } catch (error) {
    console.error(error); fail++; console.log(`${pass} pass, ${fail} fail`);
  } finally {
    if (browser) await browser.close();
  }
  process.exitCode = fail ? 1 : 0;
})();
