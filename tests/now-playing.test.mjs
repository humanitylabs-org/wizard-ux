import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { fixture } from './fixtures/tweaks.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { onSkin, styles } from './fixtures/w5-css.mjs';
import { between } from './fixtures/source-slice.mjs';
const read = p => withShellParts(withWebParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8')));
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

test('api.media: layouts and trusted tweaks that ask for it; both shells wire the app names and the watcher', async () => {
  // skin-host: a trusted package that asks for media gets api.media; a stranger's, or one that did not ask, does not.
  const man = (id, author, capabilities) => ({ id, name: 'x', version: '1.0.0', author, apiVersion: 1, capabilities, description: 'x' });
  const f = fixture({ manifests: { 'stranger/np': man('stranger/np', 'stranger', ['media']), 'miguel/np-probe': man('miguel/np-probe', 'miguel', ['media']), 'miguel/np-none': man('miguel/np-none', 'miguel', []) } });
  const got = {};
  f.host._test.setImporter(async url => ({ default: api => { got[String(url).split('/tweaks/')[1].split('/tweak.js')[0]] = !!api.media && typeof api.media.watch === 'function'; return () => {}; } }));
  await f.host.loadTweaks(['stranger/np', 'miguel/np-probe', 'miguel/np-none'], f.slots, { teamAuthors: ['miguel'] });
  assert.deepEqual(got, { 'stranger/np': false, 'miguel/np-probe': true, 'miguel/np-none': false });
  // Both shells name the app and open it for api.media (app-agentorb.js on the phone, desktop-boot.js on the desktop).
  for (const file of ['web/app-agentorb.js', 'web/desktop/desktop-boot.js']) {
    const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const lines = between(src, '    mediaApp: id => { const a = APP[id];', '\n') + '\n' + between(src, '    mediaOpen: id =>', '\n');
    const opened = [];
    const o = vm.runInNewContext(`({${lines}})`, { APP: { music: { id: 'music', name: 'Music' } }, ico: (tag, cls, a) => `<${tag} class="${cls}">${a.id}</${tag}>`, window: { WizOpenApp: id => (opened.push(id), id === 'music') } });
    assert.deepEqual({ ...o.mediaApp('music') }, { name: 'Music', icon: '<span class="np-ic">music</span>' }, file);
    assert.equal(o.mediaApp('nope'), null);
    assert.equal(o.mediaOpen('music'), true); assert.equal(o.mediaOpen('gone'), false); assert.deepEqual(opened, ['music', 'gone']);
  }
  for (const page of ['web/index.html', 'web/desktop.html']) {
    const doc = createDocument(); doc.documentElement.innerHTML = read(page).replace(/^<!doctype html>/i, '');
    assert.ok(doc.querySelectorAll('script[src]').some(x => x.getAttribute('src') === 'core/media-watch.js'), page);
  }
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes('miguel/now-playing')); assert.ok(!cat.defaults.includes('miguel/now-playing'), 'off by default');
  assert.equal(JSON.parse(read('web/core/slots.json')).slots['apps-top'], undefined, 'minimal: no pill, so no apps-column slot');
  // minimal (Miguel, 4 Nov 2026): the real package holds the watcher and mounts nothing
  const tw = read('web/tweaks/miguel/now-playing/tweak.js'), css = read('web/tweaks/miguel/now-playing/tweak.css');
  const setup = vm.runInNewContext(`(() => { ${tw.replace('export default function setup', 'function setup')}; return setup; })()`, {});
  let watching = 0, stopped = 0;
  const off = setup({ media: { watch: fn => { watching++; assert.equal(typeof fn, 'function'); return () => { stopped++; }; } } });
  assert.equal(watching, 1); off(); assert.equal(stopped, 1, 'its teardown is the watcher\'s');
  assert.equal(typeof setup({}), 'function', 'without api.media: nothing, a no-op teardown');
  assert.doesNotMatch(tw, /slot|mount|createElement|pauseAll|np-pop/, 'no pill, no list, no Pause all, no top-bar control');
  assert.doesNotMatch(css, /\.np\b|np-pop|np-all|apps-top|dock-end/, 'no pill / list css left');
  // The CSS on the view's bars (skeletons of the AI apps view's markup), with the package on.
  const on = { 'data-tweaks': 'miguel/now-playing' };
  const desk = sel => onSkin([css], sel, { skin: '', shell: 'desktop', attrs: { ...on, 'data-layout': 'ai-apps' } });
  assert.equal(desk('.aad-np:hover .aad-np-g').visibility, 'visible', 'hover: the bars become pause');
  assert.equal(desk('.aad-np-g::after').height, '100%', 'the pause glyph has a height (a flex-end parent left it 0 px tall)');
  assert.equal(desk('.aad-np-g::after').width, '2.5px');
  assert.match(desk('.aad-vtab[data-media="paused"] .aad-np').animation || '', /^np-gone 250ms ease 4s both$/, 'paused: gone after a short grace');
  const rootEl = createDocument(); for (const [k, v] of Object.entries(on)) rootEl.documentElement.setAttribute(k, v);
  assert.deepEqual(styles(rootEl.documentElement, [css]), {}, 'nothing styled at the root: idle is exactly tweak-off');
  for (const f of ['web/core/media-watch.js', 'web/core/skin-host.js', 'web/app.js', 'web/desktop/desktop.js']) assert.doesNotMatch(read(f), /now-playing/, f + ': core never names the package');
  // the phone (4 Nov 2026): the same bars on the AI apps Home icons; no hover, a 44 px invisible hit area, paused = a play mark that fades
  assert.doesNotMatch(tw, /env\.shell/, 'the phone watches too');
  const phone = (sel, extra = {}) => onSkin([css], sel, { skin: '', shell: 'phone', attrs: { ...on, ...extra } });
  const badge = phone('.ah-app .ah-np');
  assert.equal(badge.width, '20px'); assert.equal(badge.height, '20px', 'a small drawn badge');
  const hit = phone('.ah-app .ah-np::before');
  const inset = (hit.inset || '').split(/\s+/).map(v => parseFloat(v));
  assert.equal(hit.position, 'absolute'); assert.equal(inset.length, 4, 'an invisible padded hit area');
  const [t, r, b, l] = inset;
  assert.ok(20 - t - b >= 44 && 20 - l - r >= 44, 'at least 44 px each way');
  for (const k of ['background', 'background-color', 'border', 'box-shadow']) assert.equal(hit[k], undefined, 'the hit area is never drawn');
  assert.equal(phone('.ah-app .ah-np:hover .ah-np-g').visibility, phone('.ah-app .ah-np .ah-np-g').visibility, 'no hover on a phone');
  for (const sel of ['.ah-app .ah-np .ah-np-g', '.ah-app .ah-np .ah-np-b', '.ah-app[data-media="paused"] .ah-np .ah-np-g']) assert.notEqual(phone(sel).visibility, 'visible', `${sel}: no child turned visible (it would take taps after the badge fades)`);
  assert.equal(phone('.ah-app[data-media="paused"] .ah-np').animation, 'np-gone 250ms ease 4s both', 'paused: gone after the same grace');
  const pressed = createDocument(); for (const [k, v] of Object.entries({ ...on, 'data-shell': 'phone' })) pressed.documentElement.setAttribute(k, v);
  pressed.body.innerHTML = '<div class="ah-app"><div class="ah-tile"></div><span class="ah-np"></span></div>';
  const tile = pressed.body.querySelector('.ah-tile');
  const active = styles(tile, [css], { states: [':active'] });
  assert.equal(active.transform, 'none'); assert.equal(active.filter, 'none', 'pressing the bars does not press the icon');
});
