// wizard-ux#1840: a photo sent as a steer showed as a broken image in its own bubble. The bubble preferred the
// phone's local blob: preview over Wizard's copy, and that preview can die on an Android WebView. Steer photos were
// also lazy and could sit at 0 px wide. Browser proof: tests/qa-steer-photo.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/core/chats-attach.js', import.meta.url), 'utf8');
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, `found ${from}`); return src.slice(a, b); };
const body = cut('  const PREVIEW = {};', '  function mediaBlock(') + cut('  function mediaBlock(', '  function fileChip(');

function harness({ pending = [] } = {}) {
  const listeners = {}, revoked = [];
  class HTMLImageElement { constructor(attrs) { this.attrs = { ...attrs }; this.dataset = {}; if (attrs['data-local']) this.dataset.local = attrs['data-local']; }
    getAttribute(k) { return this.attrs[k] ?? null; } setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; if (k === 'data-local') delete this.dataset.local; } }
  const ctx = { esc: s => String(s).replace(/"/g, '&quot;'), fileUrl: id => `/wizard/files/${encodeURIComponent(id)}/content`, PEND: { isPending: id => pending.includes(id) },
    fileKind: f => /^audio\//.test(f.mime || '') ? 'voice' : /^image\//.test(f.mime || '') ? 'image' : 'file', fileChip: () => '<i class="vnote"></i>', CLIP_SVG: '', PLAY_SVG: '', DL_SVG: '', fsize: String,
    URL: { revokeObjectURL: u => revoked.push(u) }, HTMLImageElement, document: { addEventListener: (t, fn, cap) => { assert.equal(cap, true, `${t} listens in the capture phase`); listeners[t] = fn; } } };
  vm.runInNewContext(body + ';this.PREVIEW=PREVIEW;this.mediaOfFile=mediaOfFile;this.mediaBtn=mediaBtn;this.userMedia=userMedia;', ctx);
  return { ...ctx, listeners, revoked };
}
const photo = { id: 'drop_8e86d69c', name: '1000191983.jpg', mime: 'image/jpeg', bytes: 700694 };
const imgOf = html => Object.fromEntries([...html.match(/<img ([^>]*)>/)[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));

test('an uploaded photo in its own (steer) bubble shows Wizard\'s copy, not the local blob: preview', () => {
  const h = harness(); h.PREVIEW[photo.id] = 'blob:https://wizard.test/dead-preview';
  const img = imgOf(h.userMedia({ media: [] }, [photo], []));
  assert.equal(img.src, '/wizard/files/drop_8e86d69c/content');
  assert.equal(img['data-local'], 'blob:https://wizard.test/dead-preview', 'the local copy is kept only as a fallback');
  assert.equal(img.loading, 'eager', 'the owner\'s own photo never waits on lazy loading');
});

test('a photo still uploading shows its local preview (Wizard has no copy yet)', () => {
  const h = harness({ pending: ['pending:1'] }); h.PREVIEW['pending:1'] = 'blob:https://wizard.test/live';
  const img = imgOf(h.userMedia({ media: [] }, [{ ...photo, id: 'pending:1' }], []));
  assert.equal(img.src, 'blob:https://wizard.test/live');
  assert.equal(img['data-local'], undefined);
});

test('a steer with a voice note and a photo loads the photo at once', () => {
  const h = harness();
  const html = h.userMedia({ media: [] }, [{ id: 'drop_voice', name: 'wizard-voice-1.m4a', mime: 'audio/mp4' }, photo], []);
  assert.match(html, /class="vnote"/);
  const img = imgOf(html);
  assert.equal(img.loading, 'eager');
  assert.equal(img.src, '/wizard/files/drop_8e86d69c/content');
});

test('the local preview is released once Wizard\'s copy loads; a failed load falls back to it', () => {
  const h = harness(); const blob = 'blob:https://wizard.test/p'; h.PREVIEW[photo.id] = blob;
  const attrs = imgOf(h.userMedia({ media: [] }, [photo], []));
  const failing = new h.HTMLImageElement(attrs);
  h.listeners.error({ target: failing });
  assert.equal(failing.getAttribute('src'), blob, 'Wizard unreachable for a moment: show the phone\'s copy');
  const loading = new h.HTMLImageElement(attrs);
  h.listeners.load({ target: loading });
  assert.deepEqual(h.revoked, [blob]);
  assert.equal(h.PREVIEW[photo.id], undefined, 'later renders no longer carry the released preview');
  assert.equal(loading.dataset.local, undefined);
  const img = imgOf(h.userMedia({ media: [] }, [photo], []));
  assert.equal(img['data-local'], undefined);
  assert.equal(img.src, '/wizard/files/drop_8e86d69c/content');
});

test('an unloaded single photo is never 0 px wide', () => {
  const css = readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
  assert.match(css, /\.mgrid\.n1 \.mimg img \{[^}]*min-width: 60px/);
});
