// Chat file cards: one-tap Download on the card, and PDFs preview inside the media viewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const chats = read('../web/core/chats.js'), kit = read('../web/core/chat-kit.js'), css = read('../web/core/chats.css');
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

test('the card Download goes through the viewer save path (native, Android DownloadManager, browser)', () => {
  assert.match(chats, /closest\('\[data-mdl\]'\)[^\n]*KIT\.download\(m\)/);
  assert.ok(chats.indexOf("closest('[data-mdl]')") < chats.indexOf("closest('[data-mi]'); if (mi)"), 'Download is handled before the card opens the viewer');
  assert.match(kit, /download: save, viewer/);
  assert.match(css, /\.mfile > \.mdl \{[^}]*position: absolute/);
});

test('PDFs preview in a typed blob: frame, with a Download fallback where browsers have no PDF reader', () => {
  assert.match(kit, /navigator\.pdfViewerEnabled === true && !appDownloads\(\)/);
  assert.match(kit, /new Blob\(\[b\], \{ type: 'application\/pdf' \}\)/);
  assert.match(kit, /<iframe class="mv-pdf" src=/);
  assert.doesNotMatch(kit, /<iframe class="mv-pdf"[^>]*sandbox/, 'sandboxed frames cannot host the PDF reader');
  assert.match(kit, /URL\.revokeObjectURL\(V\.pdf\)/);
  assert.match(kit, /class="mv-dl" data-mv="save">⤓ Download</);
  assert.doesNotMatch(kit, /Share or save it to open it in a PDF app/);
});

test('the shell CSP lets the viewer frame blob: PDFs and nothing cross-origin', () => {
  const csp = /Content-Security-Policy "([^"]+)"/.exec(read('../packaging/static.conf'))[1];
  const frame = /(?:^|; )frame-src ([^;]+)/.exec(csp)?.[1].trim().split(/\s+/);
  assert.deepEqual(frame, ["'self'", 'blob:']);
  assert.match(csp, /object-src 'none'/);
  assert.match(read('../server.py'), /frame-src 'self' blob:/);
});

test('the viewer keeps light ink on its dark backdrop for light skins', () => {
  const rule = /\n\.mviewer \{ --ink: color-mix\(in srgb, white[^}]*\}/.exec(css)?.[0] || '';
  assert.match(rule, /--ink-2: color-mix\(in srgb, var\(--ink\) 72%, transparent\)/);
  assert.match(rule, /color: var\(--ink\)/);
});
