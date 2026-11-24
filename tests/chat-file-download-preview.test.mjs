// Chat file cards: one-tap Download on the card, and PDFs preview inside the media viewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { between, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { valueOf } from './fixtures/r7A-css.mjs';
import { parseCsp, nginxCsp, serverPyCsp } from './fixtures/w1-csp.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const chats = withParts(read('../web/core/chats.js')), kit = read('../web/core/chat-kit.js'), css = read('../web/core/chats.css');
const start = chats.indexOf('  function mediaBtn(c, m) {'), end = chats.indexOf('  function mediaBlock(', start);
const mediaBtn = vm.runInNewContext('(' + chats.slice(start, end).trim() + ')', { esc: String, fsize: b => b + ' B', PLAY_SVG: '<svg/>', CLIP_SVG: '<svg/>', DL_SVG: '<svg/>' });

test('a file card carries its own Download button beside the view tap target', () => {
  const c = { media: [] };
  const html = mediaBtn(c, { kind: 'file', name: 'report.pdf', mime: 'application/pdf', bytes: 3240, url: '/wizard/attachments/abc' });
  assert.match(html, /^<div class="mfile"><button type="button" class="mcard" data-mi="0">/);
  assert.match(html, /<button type="button" class="mdl" data-mdl="0" title="Download" aria-label="Download report\.pdf">/);
  const cardHtml = html.slice(html.indexOf('class="mcard"'), html.indexOf('</button>'));
  assert.ok(!cardHtml.includes('<button'), 'no button nested inside the card button');
  assert.match(mediaBtn(c, { kind: 'video', name: 'clip.mp4', mime: 'video/mp4', url: '/wizard/attachments/def' }), /data-mdl="1"/);
  assert.doesNotMatch(mediaBtn(c, { kind: 'file', name: 'pending.pdf', mime: 'application/pdf', url: '' }), /data-mdl/, 'nothing to download until the upload has a URL');
});

// The real tap handler lines (chats-bind.js) on the real card markup (mediaBtn) in the mini DOM, then the real
// WosChat.download (chat-kit.js) on each save path, then the card's real Download placement through the cascade.
function tapper() {
  const doc = createDocument(), m0 = { kind: 'file', name: 'report.pdf', mime: 'application/pdf', bytes: 3240, url: '/wizard/attachments/abc' };
  const c = { media: [] }; doc.body.innerHTML = mediaBtn(c, m0);
  const lines = between(chats, "    const mdl = e.target.closest('[data-mdl]');", "    const ml = e.target.closest('a[data-mlink]');");
  const ctx = runRecording(`globalThis.tap = e => {\n${lines}\n  return false; };`, { id: 'w1', ch: () => c });
  const tap = sel => { const e = { target: doc.querySelector(sel), prevented: false, preventDefault() { this.prevented = true; } }; ctx.calls.length = 0; const handled = ctx.tap(e); return { handled, prevented: e.prevented, calls: ctx.calls.map(x => [x[0], ...x.slice(1)]) }; };
  return { tap, doc, m0 };
}
function kitWorld({ ua = '', nativeApi = null } = {}) {
  const clicks = [], fetches = [], blobs = [];
  const document = { createElement: tag => ({ tag, addEventListener() {}, click() { clicks.push({ href: this.href, download: this.download }); }, remove() {} }), body: { appendChild() {} }, addEventListener() {} };
  const window = { WizardOSNative: nativeApi }; window.top = window;
  class File { constructor(parts, name, o) { this.parts = parts; this.name = name; this.type = o.type; } }
  class FileReader { readAsDataURL() { this.result = 'data:application/pdf;base64,QUJD'; this.onload(); } }
  class U extends URL { static createObjectURL(f) { blobs.push(f.name); return 'blob:https://box.test/1'; } static revokeObjectURL() {} }
  runRecording(kit, { window, document, navigator: { userAgent: ua }, location: new URL('https://box.test/wizard-os-home/'), URL: U, File, FileReader, AbortController, setTimeout: () => 0, clearTimeout() {}, console,
    fetch: async url => { fetches.push(url); return { ok: true, status: 200, headers: { get: () => null }, blob: async () => ({ type: 'application/pdf', size: 3 }) }; } });
  return { KIT: window.WosChat, clicks, fetches, blobs };
}

test('the card Download goes through the viewer save path (native, Android DownloadManager, browser)', async () => {
  const t = tapper();
  const dl = t.tap('.mdl');
  assert.equal(dl.handled, true); assert.equal(dl.prevented, true);
  assert.deepEqual(dl.calls.map(x => x[0]), ['KIT.download'], 'Download saves, it does not open the viewer');
  assert.equal(dl.calls[0][1].url, t.m0.url);
  const card = t.tap('.mcard');
  assert.deepEqual(card.calls.map(x => x.slice(0, 3)), [['openMedia', 'w1', 0]], 'the card itself opens the viewer');
  const item = { name: 'report.pdf', mime: 'application/pdf', url: '/wizard/attachments/abc' };
  // native app with saveFile: the bytes go to the app
  const saved = [], nat = kitWorld({ nativeApi: { saveFile: (...a) => saved.push(a) } });
  await nat.KIT.download(item);
  assert.deepEqual(saved, [['QUJD', 'report.pdf', 'application/pdf']]); assert.deepEqual(nat.clicks, []);
  // Android 0.8.4+: the real URL goes to the WebView download (DownloadManager), no fetch here
  const and = kitWorld({ ua: 'Mozilla/5.0 WizardOS-Android/0.8.4' });
  await and.KIT.download(item);
  assert.deepEqual(and.clicks, [{ href: '/wizard/attachments/abc', download: 'report.pdf' }]); assert.deepEqual(and.fetches, []);
  // browser: the bytes are read and saved under their name
  const web = kitWorld();
  await web.KIT.download(item);
  assert.deepEqual(web.fetches, ['/wizard/attachments/abc']); assert.deepEqual(web.blobs, ['report.pdf']);
  assert.deepEqual(web.clicks, [{ href: 'blob:https://box.test/1', download: 'report.pdf' }]);
  // the Download button sits over the card, not below it
  const rule = cascade(t.doc.querySelector('.mfile > .mdl'), css);
  assert.equal(rule.position?.value, 'absolute');
});

// The real media viewer (chat-kit.js WosChat.viewer) on the tiny DOM, opening a PDF attachment.
async function viewerPdf({ pdfViewer = true, ua = '', type = 'application/pdf' } = {}) {
  const document = createDocument(), blobs = [], revoked = [];
  class U extends URL { static createObjectURL(b) { blobs.push(b); return 'blob:https://box.test/' + blobs.length; } static revokeObjectURL(u) { revoked.push(u); } }
  const window = {};
  runRecording(kit, { window, document, navigator: { userAgent: ua, pdfViewerEnabled: pdfViewer }, location: new URL('https://box.test/wizard-os-home/'),
    URL: U, File, Blob, AbortController, setTimeout, clearTimeout, console, requestAnimationFrame: f => f(), getComputedStyle: () => ({}),
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => type }, blob: async () => new Blob(['%PDF-1.4'], { type }) }) });
  const V = window.WosChat.viewer;
  V.open([{ kind: 'file', name: 'report.pdf', mime: 'application/pdf', url: '/wizard/attachments/abc' }]);
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  return { V, blobs, revoked, stage: document.querySelector('.mv-stage') };
}

test('PDFs preview in a typed blob: frame, with a Download fallback where browsers have no PDF reader', async () => {
  const r = await viewerPdf();
  const frame = r.stage.querySelector('iframe.mv-pdf');
  assert.ok(frame, 'a browser with a PDF reader shows the PDF in the viewer');
  assert.equal(frame.getAttribute('src'), 'blob:https://box.test/1');
  assert.equal(frame.hasAttribute('sandbox'), false, 'sandboxed frames cannot host the PDF reader');
  assert.deepEqual(r.blobs.map(b => b.type), ['application/pdf'], 'from a typed blob');
  r.V.close();
  assert.deepEqual(r.revoked, ['blob:https://box.test/1'], 'closing the viewer frees the blob');
  for (const o of [{ pdfViewer: false }, { ua: 'Mozilla/5.0 WizardOS-Android/0.10.15' }]) {
    const n = await viewerPdf(o);
    assert.equal(n.stage.querySelector('iframe'), null, JSON.stringify(o));
    const dl = n.stage.querySelector('.mv-dl');
    assert.equal(dl?.dataset.mv, 'save'); assert.equal(dl?.textContent, '⤓ Download', 'a Download fallback');
    assert.doesNotMatch(n.stage.textContent, /Share or save it to open it in a PDF app/);
    assert.equal(n.blobs.length, 0, 'nothing fetched into a blob');
  }
});

test('the shell CSP lets the viewer frame blob: PDFs and nothing else cross-origin', async () => {
  // the headers the image's nginx (rendered by the real entrypoint) and the dev server.py really send
  // The one other frame: Troubleshooter's own line on this Tailscale address (wizard-troubleshooter issue 37).
  const nginx = parseCsp(nginxCsp({ host: 'wizard.example-tailnet.ts.net' }));
  assert.deepEqual(nginx['frame-src'], ["'self'", 'blob:', 'https://wizard.example-tailnet.ts.net:9691']);
  assert.deepEqual(nginx['object-src'], ["'none'"]);
  const dev = parseCsp(await serverPyCsp());
  assert.ok(dev['frame-src'].includes('blob:'), 'the dev server frames blob: PDFs too');
});

test('the viewer keeps light ink on its dark backdrop for light skins', () => {
  // a light skin sets dark ink on the page; inside the viewer the ink is light again
  const doc = createDocument();
  doc.body.innerHTML = '<main><div class="mviewer"><div class="mv-stage"><div class="mv-file"><b class="mv-name">report.pdf</b></div></div></div></main>';
  const light = 'main { --ink: #111111; --wz-ink: #111111; }';
  const name = doc.querySelector('.mv-name'), viewer = doc.querySelector('.mviewer');
  const ink = valueOf(name, [css, light], '--ink'), ink2 = valueOf(name, [css, light], '--ink-2');
  assert.match(ink, /^color-mix\(in srgb, white/, 'the viewer ink is white-based, not the skin\'s dark ink');
  assert.equal(ink2, `color-mix(in srgb, ${ink} 72%, transparent)`, 'secondary ink follows it');
  assert.equal(valueOf(viewer, [css, light], 'color'), ink);
});
