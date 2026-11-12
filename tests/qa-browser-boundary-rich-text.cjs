// Browser QA for dictation into a sandboxed app's rich-text (contenteditable) field (wizard-os#133).
// Real Chromium: a shell page with the boundary on, the real core/browser-boundary.js and core/focused-field.js (as
// the orb uses it), and an app page in a sandboxed frame that loads the real core/app-client.js and has a
// contenteditable note with formatting. Checks the orb offers dictation for it, the words land once at the caret
// (through the browser's own editing, so the app sees one input event), a take started from the orb keeps the field,
// typing meanwhile wins, and a region that stops being editable or opts out is never offered.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-rich-text.cjs
//   QA_WEB=<a main checkout's web dir> QA_EXPECT=broken ... (before the fix: the orb never offers the rich field)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB || path.join(__dirname, '..', 'web');
const EXPECT = process.env.QA_EXPECT || 'fixed';
const SHOT = process.env.QA_SHOT || '';
const APP = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{font:16px system-ui;margin:16px;background:#111;color:#eee}#ed,#off{border:1px solid #666;border-radius:8px;padding:10px;min-height:60px;margin-bottom:10px}</style></head>
<body><div id="ed" contenteditable="true"><p>Hello <b>bold</b> end</p></div>
<div id="off" contenteditable="true" data-no-dictation>private</div>
<script>
  window.inputs = 0; document.getElementById('ed').addEventListener('input', () => window.inputs++);
  // Caret right after the text node "Hello " (offset n), or at the end of "end".
  window.caret = (where) => {
    const ed = document.getElementById('ed'), p = ed.firstChild, sel = getSelection(), r = document.createRange();
    if (where === 'end') r.setStart(p.lastChild, p.lastChild.data.length); else r.setStart(p.firstChild, 5);
    r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
  };
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script src="/wizard-os-home/core/focused-field.js"></script>
<style>body{font:14px system-ui;background:#222;color:#eee;margin:0}iframe{width:520px;height:200px;border:0}#orb{margin:8px}</style></head>
<body><button id="orb">orb</button><span id="state">no field</span><div class="win" data-win="w1"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe></div>
<script>
  const f = document.querySelector('iframe'); WizBrowserBoundary.attach(f);
  window.fieldPaints = [];
  const FIELDS = WizCore.focusedField.create({ frames: () => [f], controls: el => el?.id === 'orb', onChange: c => { fieldPaints.push(!!c); document.getElementById('state').textContent = c ? 'orb offers dictation' : 'no field'; } });
  window.dictate = async words => { const seal = FIELDS.capture(); if (!seal) return 'no-field'; const p = FIELDS.insert(seal, words); seal.release(); return (await p) ? 'inserted' : 'refused'; };
  window.dictateTyped = async (words, typeIn) => { const seal = FIELDS.capture(); if (!seal) return 'no-field'; await seal.pin; await typeIn(); const p = FIELDS.insert(seal, words); seal.release(); return (await p) ? 'inserted' : 'refused'; };
</script></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(SHELL); }
  if (u.pathname === '/notes/') { res.setHeader('content-type', 'text/html'); return res.end(APP); }
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/css'); return res.end(fs.readFileSync(file)); }
  }
  res.statusCode = 404; res.end('');
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 560, height: 260 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/');
  const app = () => page.frames().find(fr => fr.url().endsWith('/notes/'));
  await page.waitForFunction(() => !!document.querySelector('iframe').contentWindow, null, { timeout: 8000 });
  await page.waitForTimeout(600);
  const r = {};
  const offered = () => page.waitForFunction(() => window.fieldPaints.at(-1) === true, null, { timeout: 3000 }).then(() => true, () => false);
  // The note's text (the browser's own editing may write a non-breaking space next to the bold word) and its markup.
  const html = () => app().evaluate(() => { const ed = document.getElementById('ed'); return { text: ed.textContent.replace(/\u00a0/g, ' '), bold: ed.querySelector('b')?.textContent }; });
  r.opaque = await app().evaluate(() => self.origin);
  // 1. Tap into the rich note, caret after "Hello": the orb offers dictation and the words land there, once.
  await app().click('#ed'); await app().evaluate(() => window.caret('mid'));
  r.offered = await offered();
  r.dictated = await page.evaluate(() => window.dictate('big'));
  r.html1 = await html(); r.inputs1 = await app().evaluate(() => window.inputs);
  if (SHOT) await page.screenshot({ path: SHOT });
  if (EXPECT !== 'broken') {
  // 2. Keyboard on the orb (focus moves to a shell control): the note the take started in still gets the words.
  await app().click('#ed'); await app().evaluate(() => window.caret('end')); await page.waitForTimeout(100);
  await page.focus('#orb');
  r.fromOrb = await page.evaluate(() => window.dictate('now'));
  r.html2 = await html();
  // 3. Typed in the note while the take ran: the typing wins, the words never land.
  await app().click('#ed'); await app().evaluate(() => window.caret('end')); await offered();
  const typedWhile = page.evaluate(() => window.dictateTyped('lost', () => new Promise(res => { window.typeNow = res; })));
  await page.waitForFunction(() => typeof window.typeNow === 'function', null, { timeout: 3000 });
  await app().evaluate(() => { const p = document.getElementById('ed').firstChild; p.appendChild(document.createTextNode('!')); });
  await page.evaluate(() => window.typeNow());
  r.typedWhile = await typedWhile; r.html3 = await html();
  // 4. A region that opts out of dictation is never offered.
  await app().click('#off'); await page.waitForTimeout(300);
  r.optOut = await page.evaluate(() => window.dictate('x'));
  // 5. The note stops being editable without a focus event: the orb stops offering it.
  await app().click('#ed'); r.offeredAgain = await offered();
  await app().evaluate(() => { document.getElementById('ed').setAttribute('contenteditable', 'false'); });
  r.dropped = await page.waitForFunction(() => window.fieldPaints.at(-1) === false, null, { timeout: 3000 }).then(() => true, () => false);
  }
  r.errors = errors;
  console.log(JSON.stringify(r, null, 1));
  const fails = [];
  if (r.opaque !== 'null') fails.push('app origin is not opaque');
  if (EXPECT === 'broken') {
    if (r.offered || r.dictated !== 'no-field') fails.push('main already offers dictation into a sandboxed rich-text field');
  } else {
    if (!r.offered || r.dictated !== 'inserted') fails.push('orb did not offer / insert into the rich note: ' + r.dictated);
    if (r.html1.text !== 'Hello big bold end' || r.html1.bold !== 'bold') fails.push('words not at the caret: ' + JSON.stringify(r.html1));
    if (r.inputs1 !== 1) fails.push('app saw ' + r.inputs1 + ' input events, not 1');
    if (r.fromOrb !== 'inserted' || r.html2.text !== 'Hello big bold end now') fails.push('take from the orb: ' + r.fromOrb + ' ' + JSON.stringify(r.html2));
    if (r.typedWhile !== 'refused' || r.html3.text !== 'Hello big bold end now!') fails.push('typing meanwhile did not win: ' + JSON.stringify(r.html3));
    if (r.optOut !== 'no-field') fails.push('a data-no-dictation region was offered');
    if (!r.offeredAgain || !r.dropped) fails.push('a region that stopped being editable was still offered');
  }
  if (errors.length) fails.push('page errors');
  await browser.close(); server.close();
  if (fails.length) { console.error('FAIL', fails); process.exit(1); }
  console.log(EXPECT === 'broken' ? 'PASS (expected broken): main never offers the sandboxed rich-text field'
    : 'PASS: dictation lands in a sandboxed app\'s rich-text field, once, at the caret');
})().catch(e => { console.error(e); process.exit(1); });
