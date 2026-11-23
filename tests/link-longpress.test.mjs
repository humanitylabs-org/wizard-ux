import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './fixtures/mini-dom.mjs';
import { links, ORIGIN } from './fixtures/link-menu-harness.mjs';

test('long-press link menu: your browser or copy, dark card, never writes into the composer', async () => {
  const f = links();
  const composer = f.doc.getElementById('composer');
  composer.value = 'half a reply';
  const m = f.longPress('https://example.com/story');
  assert.equal(m.e.defaultPrevented, true, 'the long-press is the menu, not the browser\'s own');
  assert.deepEqual(m.words, ['Open in your browser', 'Copy link']);
  assert.equal(m.menu.querySelector('.wl-host').textContent, 'example.com');
  assert.ok(!/agent's browser|take a look/i.test(m.menu.textContent));
  // Open in your browser: the system browser, menu gone
  f.tap(m.menu.querySelector('[data-wl="mine"]'));
  assert.deepEqual(f.calls, [['open', 'https://example.com/story']]);
  assert.equal(f.doc.querySelector('.wiz-linkmenu'), null);
  // Copy link: the address on the clipboard, the button says so
  const c = f.longPress('https://example.com/story');
  const copy = c.menu.querySelector('[data-wl="copy"]');
  f.tap(copy); await f.flush();
  assert.deepEqual(f.calls.at(-1), ['copy', 'https://example.com/story']);
  assert.equal(copy.textContent, 'Link copied');
  assert.equal(composer.value, 'half a reply', 'never writes into the composer');
  // The dark card: on an Android app without a download bridge a file link is copied with a notice on the original
  // dark tint, layered over the shared opaque panel material.
  const n = links({ native: true, download: false });
  n.w.WizLinks.download(ORIGIN + '/files/app.apk');
  await n.flush();
  assert.deepEqual(n.calls, [['copy', ORIGIN + '/files/app.apk']]);
  const note = n.doc.body.querySelector('[role="status"]');
  assert.equal(note.textContent, 'Link copied · paste it into Chrome to download');
  assert.match(note.style.cssText, /background:linear-gradient\(rgba\(22,14,46,\.98\),rgba\(22,14,46,\.98\)\),var\(--wz-panel/);
});

test('own-page links: long-press offers your browser (native bridge) and Download for files; taps on files download', () => {
  // Android app with the bridge: this Wizard's own page opens in the phone's browser natively, never window.open
  const f = links({ native: true });
  const own = f.longPress(ORIGIN + '/reports/week.html');
  assert.deepEqual(own.words, ['Open in your browser', 'Copy link']);
  f.tap(own.menu.querySelector('[data-wl="mine"]'));
  assert.deepEqual(f.calls, [['native-browser', ORIGIN + '/reports/week.html']]);
  // a file adds Download, through the native download bridge
  const file = f.longPress(ORIGIN + '/files/report.pdf');
  assert.deepEqual(file.words, ['Open in your browser', 'Download', 'Copy link']);
  f.tap(file.menu.querySelector('[data-wl="dl"]'));
  assert.deepEqual(f.calls.at(-1), ['native-download', ORIGIN + '/files/report.pdf']);
  // a tap on a file link downloads it (never loads it into the sheet)
  f.calls.length = 0;
  f.chat.querySelector('.bub').innerHTML = `<a href="${ORIGIN}/files/app.apk">apk</a>`;
  f.chat.querySelector('a').dispatchEvent({ type: 'click', bubbles: true, button: 0 });
  assert.deepEqual(f.calls, [['native-download', ORIGIN + '/files/app.apk']]);
  assert.equal(f.L.isOpen(), false);
  // and the sheet itself: opening a file downloads, it is never stacked
  const b = links();
  assert.equal(b.L.open(ORIGIN + '/files/data.csv'), true);
  assert.deepEqual(b.calls, [['a-download', ORIGIN + '/files/data.csv', 'data.csv']]);
  assert.equal(b.L.state().depth, 0);
  // a page loaded in the sheet gets the same long-press menu
  assert.equal(b.L.open(ORIGIN + '/notes/'), true);
  const page = createDocument({ url: ORIGIN + '/notes/' });
  page.location = { href: ORIGIN + '/notes/', pathname: '/notes/', search: '' }; page.title = 'Notes';
  page.defaultView = b.doc.defaultView; page.documentElement.clientWidth = 400; page.documentElement.clientHeight = 800;
  page.body.innerHTML = '<p><a href="https://example.com/x">out</a></p>';
  const frame = b.L.el.querySelector('iframe');
  frame.contentWindow = { document: page, location: page.location, history: { replaceState() {}, pushState() {} }, MutationObserver: class { observe() {} } };
  frame.contentDocument = page;
  frame.dispatchEvent({ type: 'load' });
  page.querySelector('a').dispatchEvent({ type: 'contextmenu', bubbles: true, clientX: 5, clientY: 5 });
  const menu = page.body.querySelector('.wiz-linkmenu');
  assert.ok(menu, 'the sheet page has the long-press menu');
  assert.deepEqual(menu.querySelectorAll('button').map(x => x.textContent), ['Open in your browser', 'Copy link']);
  // an Android app without openInBrowser never window.opens our own page over the shell
  const old = links({ native: true, openInBrowser: false });
  assert.deepEqual(old.longPress(ORIGIN + '/reports/week.html').words, ['Copy link']);
  assert.equal(old.w.WizLinks.follow(null, ORIGIN + '/reports/week.html', { browse: true }), true);
  assert.deepEqual(old.calls, []);
  old.w.WizLinks.follow(null, 'https://example.com/a', { browse: true });
  assert.deepEqual(old.calls, [['open', 'https://example.com/a']]);
});
