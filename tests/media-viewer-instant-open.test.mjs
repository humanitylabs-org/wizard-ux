import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// wizard-messenger issue 348: a photo opened in Wizard's media viewer is on screen at full strength in the frame its
// picture can be drawn: no fade-in, and never a black first frame. The real viewer code runs against a small DOM
// model (as in viewer-captured-click.test.mjs); the timing proof in a browser is wizard-messenger
// tests/photo_tap_instant_browser.cjs.
const source = fs.readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
const media = source.slice(source.indexOf('  const TEXTY ='), source.indexOf('  /* ================= approvals'));

function fixture({ complete = true, decode = 'resolve' } = {}) {
  let viewer, stage, image, timerId = 0, decoded;
  const timers = new Map(), nodes = new Map();
  class Node {
    constructor(name) {
      this.className = name; this.handlers = {}; this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } }; this.hidden = false; this.dataset = {}; this.isConnected = true; this.clientWidth = 412; this.clientHeight = 915;
      this.classes = new Set(name.split(' '));
      this.classList = { contains: x => this.classes.has(x), add: (...xs) => xs.forEach(x => this.classes.add(x)), remove: (...xs) => xs.forEach(x => this.classes.delete(x)), toggle: (x, on) => on ? this.classes.add(x) : this.classes.delete(x) };
    }
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
    setAttribute() {} appendChild() {} focus() {} closest() { return null; } querySelectorAll() { return []; }
    querySelector(sel) {
      if (sel === 'img' || sel === '.mv-stage img') return image;
      if (sel === '.mv-stage') return stage;
      if (!nodes.has(sel)) nodes.set(sel, new Node(sel.slice(1)));
      return nodes.get(sel);
    }
    set innerHTML(value) {
      if (this !== stage) return;
      image = value.startsWith('<img') ? new Node('img') : null;
      if (!image) return;
      image.src = /src="([^"]+)"/.exec(value)?.[1] || '';
      image.complete = complete; image.naturalWidth = complete ? 1600 : 0; image.naturalHeight = complete ? 1200 : 0;
      const img = image;
      img.decode = () => decode === 'resolve' ? new Promise(r => { decoded = () => { img.complete = true; img.naturalWidth = 1600; r(); }; }) : new Promise(() => {});
    }
    getBoundingClientRect() { return { left: 0, top: 0, right: 412, bottom: 915, width: 412, height: 915 }; }
  }
  stage = new Node('mv-stage');
  const body = new Node('body');
  const context = vm.createContext({ window: { addEventListener() {} }, document: { documentElement: { dataset: { shell: 'phone' } }, body, activeElement: body, createElement: () => (viewer = new Node('mviewer')), getElementById: () => null }, navigator: {}, performance: { now: () => 0 }, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id), requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, Image: undefined, K: { onChange() {}, notify() {} }, esc: x => x });
  vm.runInContext(media + '\nglobalThis.api = viewer;', context);
  return { api: context.api, viewer: () => viewer, timers, decoded: () => decoded?.(), resolver: () => decoded, flush: () => new Promise(r => setImmediate(r)) };
}

test('a picture that can be drawn shows in the same call that opened it (no fade, no next frame)', () => {
  const f = fixture({ complete: true });
  assert.equal(f.api.open([{ url: '/a.jpg', kind: 'image', placeholder: 'blob:https://wizard.test/a' }]), true);
  assert.equal(f.viewer().hidden, false);
  assert.equal(f.viewer().classList.contains('open'), true, 'fully shown before open() returns');
});

test('a picture still decoding keeps the viewer clear until it is decoded, then shows it at once', async () => {
  const f = fixture({ complete: false });
  f.api.open([{ url: '/a.jpg', kind: 'image', placeholder: 'blob:https://wizard.test/a' }]);
  assert.equal(f.viewer().hidden, false, 'built and in place');
  assert.equal(f.viewer().classList.contains('open'), false, 'no black frame: clear while the picture decodes');
  f.decoded(); await f.flush();
  assert.equal(f.viewer().classList.contains('open'), true);
});

test('a picture that never decodes still lets the viewer show after the cap (150 ms)', () => {
  const f = fixture({ complete: false, decode: 'never' });
  f.api.open([{ url: '/a.jpg', kind: 'image' }]);
  assert.equal(f.viewer().classList.contains('open'), false);
  for (const fn of f.timers.values()) fn();
  assert.equal(f.viewer().classList.contains('open'), true);
});

test('a video or file opens shown at once', () => {
  const f = fixture({ complete: false });
  f.api.open([{ url: '/v.mp4', kind: 'video' }]);
  assert.equal(f.viewer().classList.contains('open'), true);
});

test('a reveal that comes after the viewer closed does not show it again', async () => {
  const f = fixture({ complete: false });
  f.api.open([{ url: '/a.jpg', kind: 'image' }]);
  f.api.close();
  f.decoded(); await f.flush();
  assert.equal(f.viewer().hidden, true);
  assert.equal(f.viewer().classList.contains('open'), false);
});

test('a late reveal from an earlier open does not show the next photo before it is decoded', async () => {
  const f = fixture({ complete: false });
  f.api.open([{ url: '/a.jpg', kind: 'image' }]);
  const first = f.resolver();
  f.api.close();
  f.api.open([{ url: '/b.jpg', kind: 'image' }]);
  first(); await f.flush();
  assert.equal(f.viewer().hidden, false);
  assert.equal(f.viewer().classList.contains('open'), false, 'still clear: /b.jpg is not decoded yet');
  f.decoded(); await f.flush();
  assert.equal(f.viewer().classList.contains('open'), true);
});

test('the viewer has no fade-in transition', () => {
  const rules = [...css.matchAll(/^\.mviewer \{[^}]*\}/gm)].map(m => m[0]).filter(r => r.includes('transition'));
  assert.ok(rules.length, 'a .mviewer rule sets its transition');
  assert.match(rules.at(-1), /transition: none;/, 'the last word on it: no transition');
});
