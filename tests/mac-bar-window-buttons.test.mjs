// Wizard for Mac draws its red/yellow/green window buttons over the top-left of a full-size web view.
// shell.js marks the page before first paint and desktop.css keeps the bar clear of the buttons (try-wizard#19).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withWebParts } from './fixtures/web-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styleOf } from './fixtures/mini-css.mjs';
import { deskWorld, layout, El, settle } from './fixtures/ai-apps-world.mjs';

const read = path => withWebParts(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const shell = read('web/core/shell.js');

function run({ mac = false, ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15' } = {}) {
  const dataset = { shell: 'desktop' };
  const window = {
    location: { search: '', href: 'https://box.example/wizard-os-home/desktop.html', hash: '', replace() {} },
    stop() {},
  };
  if (mac) window.webkit = { messageHandlers: { wizardNative: { postMessage() {} } } };
  const ctx = {
    window,
    location: window.location,
    navigator: { userAgent: ua },
    document: { documentElement: { dataset, style: {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: q => ({ matches: q === '(hover: hover)' || q === '(any-pointer: fine)' }),
    URL, URLSearchParams,
  };
  vm.runInNewContext(shell, ctx);
  return dataset;
}

test('the Mac app marks the page before first paint; browsers and phones do not', () => {
  assert.equal(run({ mac: true }).nativeChrome, 'mac');
  assert.equal(run().nativeChrome, undefined);
  assert.equal(run({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari' }).nativeChrome, undefined);
});

// A page with the given html attributes and body markup, for the real stylesheets' cascade.
function page(attrs, body) {
  const doc = createDocument();
  for (const [k, v] of Object.entries(attrs)) doc.documentElement.setAttribute(k, v);
  doc.body.innerHTML = body; return doc;
}

test('inside the Mac app the desktop bar reserves the native window-button area', () => {
  const css = read('web/desktop/desktop.css');
  // The Mac app measures the buttons into --wz-titlebar-left; without it, 96px matches the area
  // WizardDragView leaves to the window buttons (p.x < 96). 8px is the bar's normal edge padding.
  const mac = page({ 'data-shell': 'desktop', 'data-native-chrome': 'mac' }, '<header class="bar" id="bar"><div class="ws-list"></div></header>');
  assert.equal(styleOf(mac.querySelector('.bar'), css, 'padding-left'), 'max(8px, var(--wz-titlebar-left, 96px))');
  assert.equal(styleOf(mac.querySelector('.ws-list'), css, 'overflow-x'), 'auto');
  const web = page({ 'data-shell': 'desktop' }, '<header class="bar" id="bar"><div class="ws-list"></div></header>');
  assert.doesNotMatch(styleOf(web.querySelector('.bar'), css, 'padding-left'), /titlebar/, 'a browser keeps the normal edge');
});

// static-rule: every use of the measured inset in desktop.css is scoped to the Mac app (a lint over the whole file)
test('the measured inset only ever applies inside the Mac app', () => {
  const css = read('web/desktop/desktop.css');
  const uses = css.split('\n').filter(l => l.includes('--wz-titlebar-left') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'));
  assert.ok(uses.length >= 1);
  for (const l of uses) assert.match(l, /^html\[data-native-chrome="mac"\] /);
});

test('inside the Mac app the AI apps sidebar keeps its header and rail below the window buttons (wizard-os#543)', () => {
  const css = read('web/layouts/ai-apps/desktop.css');
  const body = '<div class="aad-sh"></div><nav class="aad-rail"></nav><div class="aad-ctop"></div>';
  const mac = page({ 'data-shell': 'desktop', 'data-layout': 'ai-apps', 'data-native-chrome': 'mac' }, body);
  // the 28pt title bar, scaled like the measured inset (page zoom); 0 when the app reports 0 (full screen)
  assert.equal(styleOf(mac.documentElement, css, '--aad-mac-top'), 'calc(var(--wz-titlebar-left, 80px) * 0.35)');
  assert.equal(styleOf(mac.querySelector('.aad-sh'), css, 'margin-top'), 'var(--aad-mac-top)');
  assert.equal(styleOf(mac.querySelector('.aad-rail'), css, 'padding-top'), 'calc(8px + var(--aad-mac-top))');
  assert.match(styleOf(mac.querySelector('.aad-ctop'), css, 'padding-left'), /^max\(20px, calc\(var\(--wz-titlebar-left, 96px\)/);
  // never outside the Mac app
  const web = page({ 'data-shell': 'desktop', 'data-layout': 'ai-apps' }, body);
  assert.equal(styleOf(web.documentElement, css, '--aad-mac-top'), '');
  for (const sel of ['.aad-sh', '.aad-rail', '.aad-ctop']) for (const prop of ['margin-top', 'padding-top', 'padding-left'])
    assert.doesNotMatch(styleOf(web.querySelector(sel), css, prop), /aad-mac-top|wz-titlebar-left/, sel + ' ' + prop);
});

test('inside the Mac app the chat and app panel header buttons get click-through spots in #bar (wizard-os#548)', async () => {
  // try-wizard WizardDragView takes a mouse-down in #bar's box as a window drag unless it is on a control INSIDE #bar;
  // the AI apps headers sit over #bar on their desks, so each of their buttons needs a stand-in there.
  const { modesPart } = await import('../web/layouts/ai-apps/desktop-modes.js');
  const css = read('web/layouts/ai-apps/desktop.css');
  const mount = chrome => {
    const doc = page({ 'data-shell': 'desktop', 'data-layout': 'ai-apps', ...(chrome ? { 'data-native-chrome': chrome } : {}) }, '<header id="bar"></header><div class="top"></div>');
    const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v); return n; };
    const head = cls => { const h = el('div', cls); const b = el('button', 'aad-ib ' + cls + '-x'); h.append(b); return h; };
    const cTop = head('aad-ctop'), pTop = head('aad-ptop'), sTop = head('aad-stop'), cX = cTop.firstChild, pW = pTop.firstChild;
    const top = doc.querySelector('.top'); top.append(sTop);
    Object.assign(doc.querySelector('#bar'), { clientLeft: 0, clientTop: 0 });
    // Layout: #bar spans the top 40 px; every header button is 30 x 24 at its own x, and is drawn.
    const proto = Object.getPrototypeOf(doc.body);
    proto.getClientRects = function () { return [1]; };
    proto.replaceChildren ||= function (...ns) { for (const n of [...this.childNodes]) this.removeChild(n); this.append(...ns); };
    proto.getBoundingClientRect = function () {
      if (this.id === 'bar') return { left: 0, top: 0, right: 1000, bottom: 40, width: 1000, height: 40 };
      const x = 100 * (doc.querySelectorAll('button').indexOf(this) + 1); return { left: x, top: 8, right: x + 30, bottom: 32, width: 30, height: 24 };
    };
    const frames = [], api = { listen() {}, frame: f => frames.push(f) };
    const { macHoles } = modesPart({ aadVars: {}, api, cTop, cX, doc, el, icon: () => el('i', 'ic'), MODE_KEYS: {}, MODE_LABELS: {}, modeBars: [], pTop, pW, root: doc.documentElement, sTop, toggleSide() {}, top, windowMode() {} });
    while (frames.length) frames.shift()();
    return { doc, macHoles, frames };
  };
  const web = mount('');
  assert.equal(web.macHoles, null, 'only inside the Mac app');
  assert.equal(web.doc.querySelector('.aad-mac-holes'), null);
  const mac = mount('mac'), bar = mac.doc.querySelector('#bar');
  const box = bar.querySelector('.aad-mac-holes');
  assert.ok(box, 'the spots live inside #bar, where the Mac app looks');
  const spots = box.querySelectorAll('i');
  const buttons = mac.doc.querySelectorAll('.aad-ctop button, .aad-ptop button, .aad-stop button');
  assert.equal(spots.length, buttons.length, 'every header button the layout owns');
  assert.ok(spots.length >= 3);
  for (const i of spots) {
    assert.equal(i.getAttribute('tabindex'), '-1', 'a stand-in the Mac app counts as a control, never in the tab order');
    assert.equal(styleOf(i, css, 'pointer-events'), 'none', 'never takes a click itself');
  }
  assert.deepEqual([spots[0].style.width, spots[0].style.height], ['30px', '24px']);
  // repainted with the top row: soon() asks for one frame; removed when the layout goes.
  mac.macHoles.soon(); assert.equal(mac.frames.length, 1); mac.macHoles.soon(); assert.equal(mac.frames.length, 1);
  mac.macHoles.dispose(); assert.equal(bar.querySelector('.aad-mac-holes'), null);
  // the whole AI apps desktop layout inside the Mac app: a new route repaints the spots, leaving it removes them
  const d = deskWorld(), { w } = d;
  for (const [k, v] of [['data-shell', 'desktop'], ['data-layout', 'ai-apps'], ['data-native-chrome', 'mac']]) w.html.setAttribute(k, v);
  const deskBar = new El('div'); deskBar.setAttribute('id', 'bar'); w.html.children[0].append(deskBar);
  w.doc.getElementById = id => w.html.querySelector('#' + id);
  const asked = []; w.api.frame = f => { asked.push(f); return () => {}; };
  const off = (await layout()).default(w.api);
  const flush = () => { while (asked.length) asked.shift()(0); };
  flush();
  const holes = deskBar.querySelector('.aad-mac-holes'), drawn = holes.querySelectorAll('i').length;
  assert.ok(drawn >= 3, 'the layout draws its spots');
  holes.replaceChildren(); // emptied, and #bar moved: only a repaint draws them again
  deskBar.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 400, height: 44, right: 400, bottom: 44 });
  w.st.route = { ...w.st.route, view: 'list' }; w.emit('route', w.st.route); await settle(); flush();
  assert.ok(deskBar.querySelector('.aad-mac-holes').querySelectorAll('i').length >= 3, 'a new route repaints the spots');
  off(); assert.equal(deskBar.querySelector('.aad-mac-holes'), null, 'leaving the layout removes them');
});
