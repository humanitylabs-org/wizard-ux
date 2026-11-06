import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

/* A shell document holding same-origin app frames, each with its own window, document and HTMLMediaElement. */
function rig() {
  const frames = [];
  const listeners = o => { o.h = new Map(); o.addEventListener = (t, fn) => { if (!o.h.has(t)) o.h.set(t, new Set()); o.h.get(t).add(fn); }; o.removeEventListener = (t, fn) => o.h.get(t)?.delete(fn); return o; };
  function frame(appId, { title = '' } = {}) {
    const doc = listeners({ documentElement: {}, inPage: [], querySelectorAll: () => doc.inPage });
    const proto = { play() { this.paused = false; this.ended = false; fire(this, 'play'); return Promise.resolve(); }, pause() { this.paused = true; fire(this, 'pause'); }, getAttribute(k) { return this.attrs[k] ?? null; } };
    const win = { document: doc, HTMLMediaElement: { prototype: proto }, navigator: { mediaSession: { metadata: title ? { title, artist: 'Artist' } : null } } };
    doc.defaultView = win;
    const f = listeners({ tagName: 'IFRAME', dataset: { ownApp: appId }, isConnected: true, contentWindow: win, matches: () => true });
    const media = (tag = 'AUDIO', opts = {}) => { const el = listeners(Object.assign(Object.create(proto), { tagName: tag, paused: true, ended: false, muted: false, volume: 1, duration: NaN, isConnected: false, ownerDocument: doc, attrs: {} }, opts)); if (el.isConnected) doc.inPage.push(el); return el; };
    frames.push(f); return { f, doc, win, proto, media };
  }
  function fire(el, type) {
    for (const fn of [...(el.h.get(type) || [])]) fn({ type, target: el, currentTarget: el });
    if (el.isConnected && el.ownerDocument) for (const fn of [...(el.ownerDocument.h.get(type) || [])]) fn({ type, target: el });
  }
  class MO { constructor(fn) { this.fn = fn; } observe() { rig.observing++; } disconnect() { rig.observing--; } }
  rig.observing = 0;
  const window = {};
  const ctx = { window, document: { documentElement: {}, querySelectorAll: () => frames }, MutationObserver: MO, queueMicrotask, setTimeout, clearTimeout, console, Date };
  vm.runInNewContext(read('web/core/media-watch.js'), ctx);
  return { M: window.WosMedia, frame, fire, frames };
}

test('Now playing watcher is inert until someone watches; a passive watcher never arms it', async () => {
  const { M, frame } = rig(); const a = frame('music'); const orig = a.proto.play;
  assert.equal(M.armed, false); assert.equal(a.doc.h.size, 0); assert.equal(a.proto.play, orig, 'no frame touched while nobody watches');
  assert.deepEqual(Array.from(M.list()), []);
  const heard = []; const off = M.watch(l => heard.push(l), { passive: true });
  assert.equal(M.armed, false, 'passive alone does not arm'); assert.equal(a.proto.play, orig);
  const el = a.media(); el.play(); await tick(); assert.equal(heard.length, 0); off();
});

test('Now playing sees new Audio() and in-page media, titles from Media Session, pause / play / toggle / pause all', async () => {
  const { M, frame, fire } = rig(); const a = frame('music', { title: 'Blue in Green' }), b = frame('podcasts');
  let last = []; const off = M.watch(l => { last = l; });
  assert.equal(M.armed, true);
  const song = a.media(); song.play(); await tick();
  assert.equal(last.length, 1); assert.equal(last[0].appId, 'music'); assert.equal(last[0].title, 'Blue in Green'); assert.equal(last[0].artist, 'Artist'); assert.equal(last[0].playing, true);
  // an <audio> in the page that starts by itself (autoplay: no play() call) is seen through the document listener
  const ep = b.media('AUDIO', { isConnected: true }); ep.paused = false; fire(ep, 'playing'); await tick();
  assert.deepEqual(Array.from(last, x => x.appId), ['podcasts', 'music'], 'newest first'); assert.equal(last[0].title, '', 'no metadata: the caller shows the app name');
  assert.equal(M.toggle(), true); assert.equal(ep.paused, true, 'the key pauses the newest'); await tick();
  assert.equal(last[0].playing, false, 'a paused item stays listed (with a play button)');
  assert.equal(M.toggle(), true); assert.equal(ep.paused, false, 'again: plays it'); await tick();
  assert.equal(M.pauseAll(), true); assert.equal(song.paused, true); assert.equal(ep.paused, true); await tick();
  assert.equal(last.every(x => !x.playing), true);
  assert.equal(M.play(last[1].key), true); assert.equal(song.paused, false);
  off(); assert.equal(M.armed, false); assert.deepEqual(Array.from(M.list()), []);
});

test('Now playing leaves out what makes no sound, drops closed apps, and puts every frame back when the last watcher goes', async () => {
  const { M, frame } = rig(); const a = frame('music'); const orig = a.proto.play;
  let last = []; const off = M.watch(l => { last = l; });
  assert.notEqual(a.proto.play, orig, 'armed: play() is watched');
  const muted = a.media('VIDEO', { muted: true }); muted.play();
  const click = a.media('AUDIO', { duration: 0.4 }); click.play();
  await tick(); assert.equal(last.length, 0, 'muted video and a UI click are not "playing"');
  const tune = a.media(); tune.play(); await tick(); assert.equal(last.length, 1);
  a.f.isConnected = false; M._test.prune(); await tick(); assert.equal(last.length, 0, 'closing the app drops it at once');
  off();
  assert.equal(a.proto.play, orig, 'prototype restored'); assert.equal([...a.doc.h.values()].reduce((n, s) => n + s.size, 0), 0, 'document listeners removed');
});

test('frame reload after teardown cannot rearm observation; re-enable still observes', async () => {
  const { M, frame, fire } = rig(), a = frame('music'), original = a.proto.play;
  const off = M.watch(() => {}); off();
  fire(a.f, 'load'); await tick();
  assert.equal(a.proto.play, original); assert.equal(M._test.docs, 0); assert.equal(M._test.protos, 0);
  const again = M.watch(() => {}); assert.notEqual(a.proto.play, original); again();
  assert.equal(a.proto.play, original);
});

test('api.media: layouts and trusted tweaks that ask for it; both shells wire the app names and the watcher', () => {
  const host = read('web/core/skin-host.js'), app = read('web/app.js'), desk = read('web/desktop/desktop.js');
  assert.match(host, /if \(trusted && caps\.has\('media'\)\) api\.media = base\.media;/);
  assert.match(host, /'settings',(?:'[a-z.]+',)*'media'\]\.includes\(c\)/);
  for (const src of [app, desk]) { assert.match(src, /mediaApp: id => \{ const a = APP\[id\];/); assert.match(src, /mediaOpen: id => !!window\.WizOpenApp\?\.\(id\)/); }
  for (const page of ['web/index.html', 'web/desktop.html']) assert.ok(read(page).includes('<script src="core/media-watch.js"></script>'), page);
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes('miguel/now-playing')); assert.ok(!cat.defaults.includes('miguel/now-playing'), 'off by default');
  assert.equal(JSON.parse(read('web/core/slots.json')).slots['apps-top'], undefined, 'minimal: no pill, so no apps-column slot');
  // minimal (Miguel, 4 Nov 2026): the package mounts nothing; it holds the watcher and styles the view's icon bars
  const tw = read('web/tweaks/miguel/now-playing/tweak.js'), css = read('web/tweaks/miguel/now-playing/tweak.css');
  assert.doesNotMatch(tw, /slot|mount|createElement|pauseAll|np-pop/, 'no pill, no list, no Pause all, no top-bar control');
  assert.match(tw, /return M\.watch\(\(\) => \{\}\);/);
  assert.doesNotMatch(css, /\.np\b|np-pop|np-all|apps-top|dock-end/, 'no pill / list css left');
  assert.match(css, /\.aad-np:is\(:hover, :focus-visible\) \.aad-np-g \{ visibility: visible; \}/, 'hover: the bars become pause');
  assert.match(css, /\.aad-np-g::after \{ content: ""; width: 2\.5px; height: 100%;/, 'the pause glyph has a height (a flex-end parent left it 0 px tall)');
  assert.match(css, /\.aad-vtab\[data-media="paused"\] \.aad-np \{ animation: np-gone 250ms ease 4s both; \}/, 'paused: gone after a short grace');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /(^|\})\s*html\[data-tweaks~="miguel\/now-playing"\]\s*\{/, 'nothing styled at the root: idle is exactly tweak-off');
  for (const f of ['web/core/media-watch.js', 'web/core/skin-host.js', 'web/app.js', 'web/desktop/desktop.js']) assert.doesNotMatch(read(f), /now-playing/, f + ': core never names the package');
  // the phone (4 Nov 2026): the same bars on the AI apps Home icons; no hover, a 44 px invisible hit area, paused = a play mark that fades
  assert.doesNotMatch(tw, /env\.shell/, 'the phone watches too');
  const P = 'html[data-tweaks~="miguel/now-playing"][data-shell="phone"]';
  assert.ok(css.includes(P + ' .ah-np {'), 'phone badge rule');
  assert.match(css, /\.ah-np \{[^}]*width: 20px; height: 20px;/, 'a small drawn badge');
  const hit = css.match(/\.ah-np::before \{ content: ""; position: absolute; inset: (-?\d+)px (-?\d+)px (-?\d+)px (-?\d+)px;/);
  assert.ok(hit, 'an invisible padded hit area'); const [t, r, b, l] = hit.slice(1).map(Number);
  assert.ok(20 - t - b >= 44 && 20 - l - r >= 44, 'at least 44 px each way');
  assert.doesNotMatch(css.match(/\.ah-np::before \{[^}]*\}/)[0], /background|border:|box-shadow/, 'the hit area is never drawn');
  assert.doesNotMatch(css, /\[data-shell="phone"\][^{]*\.ah-np[^{]*:hover/, 'no hover on a phone');
  assert.doesNotMatch(css.split('\n').filter(l => l.includes('[data-shell="phone"]') && /\.ah-np-[bg]/.test(l)).join('\n'), /visibility: visible/, 'no child turned visible: it would take taps after the badge fades');
  assert.ok(css.includes(P + ' .ah-app[data-media="paused"] .ah-np { animation: np-gone 250ms ease 4s both; }'), 'paused: gone after the same grace');
  assert.ok(css.includes(P + ' .ah-app:has(.ah-np:active) .ah-tile { transform: none; filter: none; }'), 'pressing the bars does not press the icon');
});
