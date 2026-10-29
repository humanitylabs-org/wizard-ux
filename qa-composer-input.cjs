// QA: WizComposerInput (web/core/composer-input.js), the one composer-input implementation Chats and apps share
// (apps reach it as WizardApp.composer). Covers what a person expects from any chat box: a pasted screenshot
// attaches (generic image.png renamed), a text paste lands from the event snapshot even when the dictation app has
// already restored its clipboard (Wispr Flow), an empty paste explains how to get the take back, file drags
// highlight and drop, text drags keep the browser default, Enter / Shift+Enter / Ctrl+Enter / IME, unbind, the
// WizardApp facade (queued bind before the module lands) and standalone Esc (overlay pop; never leaves a nested
// view while typing). James, 25 Oct 2026: "One implementation once, shared by many apps."
// Usage: node qa-composer-input.cjs   (no server; files are served from this checkout)
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (v, name, ev = {}) => { if (v) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, JSON.stringify(ev).slice(0, 500)); } };
const CORE = path.join(__dirname, 'web/core');
const PAGE = `<!doctype html><html><body>
<form id="f"><div class="tray"></div><textarea id="t"></textarea><input id="i"><button>Send</button></form>
<div id="notes"></div>
<script src="/wizard-os-home/core/app-client.js"></script></body></html>`;
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  const ctx = await browser.newContext();
  let moduleFetches = 0;
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
    const m = u.pathname.match(/^\/wizard-os-home\/core\/(app-client|composer-input)\.js$/);
    if (m) { if (m[1] === 'composer-input') moduleFetches++; return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(CORE, m[1] + '.js')) }); }
    return route.fulfill({ status: 404, body: '' });
  });
  const p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://qa.local/');
  // Bind through the app facade immediately, before the module script may have landed: the bind is queued.
  await p.evaluate(() => {
    window.got = []; window.sent = 0; window.notes = [];
    window.off = WizardApp.composer.bind(document.getElementById('f'), {
      field: 'textarea', zone: document.getElementById('f'),
      onFiles: files => window.got.push(...files.map(f => f.name + '|' + f.type)),
      onSubmit: () => window.sent++, notice: m => window.notes.push(m),
    });
  });
  await p.waitForFunction(() => !!window.WizComposerInput);
  ok(moduleFetches === 1, 'the facade loads the shared module once', { moduleFetches });
  const paste = (data) => p.evaluate(d => {
    const el = document.getElementById('t'); el.focus(); const dt = new DataTransfer();
    for (const f of d.files || []) dt.items.add(new File(['x'], f.name, { type: f.type }));
    if (d.text != null) dt.setData('text/plain', d.text);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); el.dispatchEvent(ev);
    return { prevented: ev.defaultPrevented, value: el.value };
  }, data);
  let r = await paste({ files: [{ name: 'image.png', type: 'image/png' }] });
  const got1 = await p.evaluate(() => window.got.slice());
  ok(r.prevented && got1.length === 1 && /^pasted-\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.png\|image\/png$/.test(got1[0]) && r.value === '', 'a pasted screenshot goes to onFiles, renamed, no junk text', { r, got1 });
  await p.evaluate(() => { const el = document.getElementById('t'); el.value = 'Hello '; el.setSelectionRange(6, 6); window.inputs = 0; el.addEventListener('input', () => window.inputs++); });
  r = await paste({ text: 'dictated\r\ntake' });
  const inputs = await p.evaluate(() => window.inputs);
  ok(r.prevented && r.value === 'Hello dictated\ntake' && inputs >= 1, 'a text paste inserts from the event snapshot at the caret and fires input', { r, inputs });
  await p.evaluate(() => { document.getElementById('t').value = ''; });
  r = await paste({});
  await p.waitForTimeout(600);
  const notes = await p.evaluate(() => window.notes.slice());
  ok(!r.prevented && notes.length === 1 && /Paste arrived empty/.test(notes[0]), 'an empty paste explains how to get the dictated take back', { r, notes });
  const drag = (kind) => p.evaluate(k => {
    const f = document.getElementById('f'), el = document.getElementById('t'), dt = new DataTransfer();
    if (k === 'file') dt.items.add(new File(['x'], 'drop.pdf', { type: 'application/pdf' })); else dt.setData('text/plain', 'words');
    const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }); el.dispatchEvent(over);
    const lit = f.classList.contains('is-file-drag');
    const drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }); el.dispatchEvent(drop);
    return { over: over.defaultPrevented, lit, drop: drop.defaultPrevented, after: f.classList.contains('is-file-drag') };
  }, kind);
  r = await drag('file');
  const got2 = await p.evaluate(() => window.got.slice());
  ok(r.over && r.lit && r.drop && !r.after && got2.at(-1) === 'drop.pdf|application/pdf', 'a file drag highlights the zone and drops into onFiles', { r, got2 });
  r = await drag('text');
  ok(!r.over && !r.lit && !r.drop, 'a text drag keeps the browser default', r);
  const key = (k, opts = {}, target = 't') => p.evaluate(([k, o, t]) => {
    const el = document.getElementById(t); el.focus();
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }); el.dispatchEvent(ev); return ev.defaultPrevented;
  }, [k, opts, target]);
  const sent = () => p.evaluate(() => window.sent);
  ok(await key('Enter') && await sent() === 1, 'Enter sends with a hardware keyboard');
  ok(!(await key('Enter', { shiftKey: true })) && await sent() === 1, 'Shift+Enter is a new line');
  ok(!(await key('Enter', { isComposing: true })) && await sent() === 1, 'Enter during IME composition never sends');
  ok(!(await key('Enter', {}, 'i')) && await sent() === 1, 'Enter in a plain input is left alone');
  // Touch keyboards keep Enter = new line; Ctrl/Cmd+Enter still sends.
  const touch = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
  await touch.route('**/*', route => { const u = new URL(route.request().url()); const m = u.pathname.match(/^\/wizard-os-home\/core\/(app-client|composer-input)\.js$/);
    return u.pathname === '/' ? route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }) : m ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(CORE, m[1] + '.js')) }) : route.fulfill({ status: 404, body: '' }); });
  const tp = await touch.newPage(); await tp.goto('http://qa.local/');
  const tr = await tp.evaluate(async () => {
    window.sent = 0; WizardApp.composer.bind(document.getElementById('f'), { onSubmit: () => window.sent++ });
    while (!window.WizComposerInput) await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 100)); // the queued bind attaches on the script load event
    const el = document.getElementById('t'); el.focus();
    const a = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); el.dispatchEvent(a);
    const b = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }); el.dispatchEvent(b);
    return { coarse: matchMedia('(pointer: coarse)').matches, plain: a.defaultPrevented, ctrl: b.defaultPrevented, sent: window.sent };
  });
  ok(tr.coarse && !tr.plain && tr.ctrl && tr.sent === 1, 'touch keyboard: Enter is a new line, Ctrl+Enter still sends', tr);
  await touch.close();
  ok(await key('Enter', { ctrlKey: true }) && await sent() === 2, 'Ctrl+Enter sends');
  ok(await key('Enter', { metaKey: true }) && await sent() === 3, 'Cmd+Enter sends');
  ok(await p.evaluate(() => WizComposerInput.isSendKey(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))), 'isSendKey is exported for apps');
  // Unbind is synchronous and complete.
  await p.evaluate(() => window.off());
  r = await paste({ text: 'after unbind' });
  ok(!r.prevented && !(await key('Enter')) && await sent() === 3, 'unbind removes every handler', { r });
  // A bind made through the facade and released before the module lands never attaches.
  const early = await ctx.newPage(); await early.goto('http://qa.local/');
  await early.evaluate(() => { window.sent = 0; const off = WizardApp.composer.bind(document.getElementById('f'), { onSubmit: () => window.sent++ }); off(); });
  await early.waitForFunction(() => !!window.WizComposerInput);
  const earlySent = await early.evaluate(() => { const el = document.getElementById('t'); el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return window.sent; });
  ok(earlySent === 0, 'a bind released before the module lands never attaches', { earlySent });
  await early.close();
  // Standalone Esc: pops the topmost overlay from anywhere; leaves a nested view only when not typing.
  await p.evaluate(() => {
    window.backs = []; window.depth = 1;
    WizardApp.back.register({ canGoBack: () => window.depth > 0, back: () => { window.backs.push('view'); window.depth--; return true; } });
    window.ov = WizardApp.back.push(() => { window.backs.push('overlay'); });
  });
  ok(await key('Escape') && (await p.evaluate(() => window.backs.join())) === 'overlay', 'Esc while typing closes the open overlay');
  ok(!(await key('Escape')) && (await p.evaluate(() => window.backs.join())) === 'overlay', 'Esc while typing never leaves the view');
  await p.evaluate(() => document.activeElement.blur());
  const escBody = await p.evaluate(() => { const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; });
  ok(escBody && (await p.evaluate(() => window.backs.join())) === 'overlay,view', 'Esc outside a field goes back one view');
  ok(errors.length === 0, 'no page errors', errors);
  await browser.close();
  console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
