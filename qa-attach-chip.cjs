// QA: WizAttachChip (web/core/attach-chip.js + .css), the one "about to send" attachment chip Chats' tray and every
// app's chat box share (apps reach it as WizardApp.attachChip). A photo is a thumbnail, any other file an icon +
// name + size, a voice take "Voice note"; upload progress paints in place; Remove reports the key; names are escaped;
// the node path sets no style attribute (apps run under style-src 'self'); the WizardApp facade loads it and its CSS.
// James, 26 Oct 2026: "One implementation once, shared by many apps."
// Usage: node qa-attach-chip.cjs   (no server; files are served from this checkout)
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (v, name, ev = {}) => { if (v) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, JSON.stringify(ev).slice(0, 500)); } };
const CORE = path.join(__dirname, 'web/core');
const PAGE = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; img-src 'self' data:"></head>
<body><div id="tray"></div><script src="/wizard-os-home/core/app-client.js"></script></body></html>`;
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  const ctx = await browser.newContext();
  const fetched = [];
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
    const m = u.pathname.match(/^\/wizard-os-home\/core\/(app-client\.js|attach-chip\.js|attach-chip\.css|composer-input\.js)$/);
    if (m) { fetched.push(m[1]); return route.fulfill({ status: 200, contentType: m[1].endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(path.join(CORE, m[1])) }); }
    return route.fulfill({ status: 404, body: '' });
  });
  const p = await ctx.newPage(), errors = [], csp = [];
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
  await p.goto('http://qa.local/');
  ok(await p.evaluate(() => WizardApp.attachChip.ready()), 'WizardApp facade loads the shared chip');
  ok(fetched.includes('attach-chip.css') && fetched.includes('attach-chip.js'), 'chip script and stylesheet both load', fetched);
  const r = await p.evaluate(() => {
    const tray = document.getElementById('tray'), removed = [];
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const file = WizardApp.attachChip.node({ key: 'a', name: 'Quarterly <b>report</b>.pdf', bytes: 248000, kind: 'file' }, { onRemove: k => removed.push(k) });
    const photo = WizardApp.attachChip.node({ key: 'b', name: 'beach.jpg', bytes: 900000, kind: 'image', preview: png }, { onRemove: k => removed.push(k) });
    const voice = WizardApp.attachChip.node({ key: 'c', name: 'take.webm', bytes: 9000, kind: 'voice' });
    tray.append(file, photo, voice);
    file.querySelector('.ch-attrm').click(); photo.querySelector('.ch-attrm').click();
    const up = { key: 'a', name: 'Quarterly.pdf', bytes: 248000, kind: 'file', uploading: true, sent: 62000, total: 248000 };
    WizardApp.attachChip.paint(file, up);
    const painted = { small: file.querySelector('small').textContent, up: file.classList.contains('up'), bar: getComputedStyle(file).getPropertyValue('--up').trim(), label: file.getAttribute('aria-label') };
    WizardApp.attachChip.paint(file, { ...up, state: 'reconnecting' });
    const wait = file.classList.contains('wait');
    WizardApp.attachChip.paint(file, { ...up, uploading: false, state: '' });
    return {
      fileName: file.querySelector('.nm').firstChild.textContent, fileSmall: file.querySelector('small').textContent, injected: !!file.querySelector('.nm b'),
      fileIcon: !!file.querySelector('.ic svg'), photoTile: photo.classList.contains('ch-attimg') && !!photo.querySelector('img'), photoAlt: photo.querySelector('img').alt,
      voiceName: voice.querySelector('.nm').firstChild.textContent, removed, painted, wait, done: { up: file.classList.contains('up'), small: file.querySelector('small').textContent },
      styleAttr: [...tray.querySelectorAll('[style]')].length && [...tray.querySelectorAll('[style]')].some(e => e.getAttribute('style') && !/--up/.test(e.getAttribute('style'))),
      radius: getComputedStyle(file).borderRadius, rmSize: getComputedStyle(file.querySelector('.ch-attrm')).width, tileW: getComputedStyle(photo).width,
      html: WizAttachChip.html({ key: 'x"y', name: '<img src=x onerror=alert(1)>', bytes: 1, kind: 'file' }),
    };
  });
  ok(r.fileName === 'Quarterly <b>report</b>.pdf' && !r.injected, 'file name shown as text, never markup', r);
  ok(r.fileSmall === '242 KB' && r.fileIcon, 'file chip: paperclip icon + size', r);
  ok(r.photoTile && r.photoAlt === 'beach.jpg', 'photo stages as a thumbnail tile', r);
  ok(r.voiceName === 'Voice note', 'voice take reads "Voice note"', r);
  ok(JSON.stringify(r.removed) === '["a","b"]', 'Remove reports the chip key to the app', r.removed);
  ok(r.painted.up && r.painted.small === '25% · 242 KB' && r.painted.bar === '25%' && /Uploading Quarterly\.pdf/.test(r.painted.label), 'upload progress paints in place', r.painted);
  ok(r.wait, 'reconnecting state marks the chip as waiting');
  ok(!r.done.up && r.done.small === '242 KB', 'finished upload goes back to the size', r.done);
  ok(r.radius === '14px' && r.rmSize === '24px' && r.tileW === '92px', 'shared stylesheet applied (chip, Remove, photo tile)', r);
  ok(!/<img src=x/.test(r.html) && /&lt;img/.test(r.html) && /data-attrm="x&quot;y"/.test(r.html), 'html() escapes names and keys', r.html);
  ok(csp.length === 0, 'no CSP violations under style-src self', csp);
  ok(errors.length === 0, 'no page errors', errors);
  console.log(`${pass} pass, ${fail} fail`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
