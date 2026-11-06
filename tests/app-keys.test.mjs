// App keys (Miguel, 4 Nov 2026: drive every app from the keyboard; one anchor: ⌥ for every Wizard key, apps' too). The
// contract app authors follow (docs/ai-apps-view.md › App keys): a control marked data-wz-key="<key>" is clicked by ⌥ +
// that key (read from e.code). Standalone the SDK (core/app-client.js) presses it; framed the shell does (the framed SDK
// never acts); WizardApp.keys.list() hands the shell the live targets. Pinned here with a small fake page.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const client = read('web/core/app-client.js');

/* ---------- a tiny page: just what the key matcher reads ---------- */
const one = (n, s) => {
  s = s.trim();
  const not = /^(.*):not\((.*)\)$/.exec(s); if (not) return one(n, not[1]) && !one(n, not[2]);
  const m = /^([a-z]*)((?:\[[^\]]+\])*)$/i.exec(s); if (!m) throw new Error('selector ' + s);
  if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
  return [...m[2].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, k, v]) => v === undefined ? n.attrs[k] !== undefined : n.attrs[k] === v);
};
const matches = (n, sel) => sel.split(',').some(s => one(n, s));
class Node0 {
  constructor(tag, attrs = {}, kids = []) {
    this.tagName = tag.toUpperCase(); this.nodeType = 1; this.attrs = { ...attrs }; this.children = []; this.parentNode = null; this.clicks = 0; this.box = true;
    for (const k of kids) { k.parentNode = this; this.children.push(k); }
  }
  get disabled() { return this.attrs.disabled !== undefined; }
  get isContentEditable() { for (let n = this; n; n = n.parentNode) if (n.attrs && n.attrs.contenteditable !== undefined) return n.attrs.contenteditable !== 'false'; return false; }
  get title() { return this.attrs.title || ''; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelectorAll(sel) { return this.all().filter(n => matches(n, sel)); }
  closest(sel) { for (let n = this; n && n.tagName; n = n.parentNode) if (matches(n, sel)) return n; return null; }
  getClientRects() { return this.box ? [{}] : []; }
  getBoundingClientRect() { return { width: this.box ? 40 : 0, height: 20 }; }
  click() { this.clicks++; }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  addEventListener() {}
}
const el = (tag, attrs, ...kids) => new Node0(tag, attrs, kids);

const codeOf = k => /^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : { '/': 'Slash', ',': 'Comma', '.': 'Period', ';': 'Semicolon', ' ': 'Space', '[': 'BracketLeft', '`': 'Backquote' }[k] || (/^\d$/.test(k) ? 'Digit' + k : k);

function load({ framed = false } = {}) {
  const listeners = {}, head = el('head'), body = el('body');
  const document = { head, body, documentElement: el('html', {}, head, body), activeElement: body, dataset: {}, hidden: false,
    createElement: t => el(t), querySelectorAll: s => body.querySelectorAll(s), querySelector: s => body.querySelectorAll(s)[0] || null, getElementById: () => null, addEventListener() {} };
  const ctx = { document, location: new URL('https://box.example/music/'), history: { state: null, pushState() {}, replaceState() {}, back() {} },
    navigator: {}, URL, setTimeout, clearTimeout, console, CustomEvent: class {}, Event: class {}, matchMedia: () => ({ matches: false }),
    addEventListener: (t, fn) => (listeners[t] ||= []).push(fn), removeEventListener() {}, dispatchEvent() {}, postMessage() {} };
  ctx.window = ctx;
  ctx.parent = framed ? { postMessage() {}, WizHomeScreenPolicy: null } : ctx;
  vm.runInNewContext(client, ctx);
  const press = (key, o = {}) => {
    const e = { type: 'keydown', key, code: o.code || codeOf(key), altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false,
      target: body, ...o, preventDefault() { this.defaultPrevented = true; } };
    for (const fn of listeners.keydown || []) fn(e);
    return e;
  };
  return { ctx, document, body, press, WizardApp: ctx.WizardApp };
}

const add = (p, ...ns) => { for (const n of ns) { n.parentNode = p.body; p.body.children.push(n); } return ns; };

test('⌥ + a marked key clicks the first live control marked with it, read from e.code (macOS ⌥ letters are symbols), and is used up', () => {
  const p = load();
  const [nextA, nextB, search, prev, dot, semi, comma] = add(p, ...['j', 'j', '/', 'k', '.', ';', ','].map(k => el('button', { 'data-wz-key': k, 'data-wz-key-label': k === 'j' ? 'Next' : '' })));
  let e = p.press('∆', { code: 'KeyJ' }); assert.deepEqual([nextA.clicks, nextB.clicks, e.defaultPrevented], [1, 0, true], 'first in page order wins; ⌥J types ∆ on a Mac: e.code decides');
  p.press('÷', { code: 'Slash' }); p.press('˚', { code: 'KeyK' }); p.press('≥', { code: 'Period' }); p.press('…', { code: 'Semicolon' }); p.press('≤', { code: 'Comma' });
  assert.deepEqual([search, prev, dot, semi, comma].map(n => n.clicks), [1, 1, 1, 1, 1]);
  e = p.press('x'); assert.equal(e.defaultPrevented, false, 'an unmarked key is left alone');
  const find = el('input', { 'data-wz-key': 'f' }); let focus = 0; find.focus = () => { focus++; }; add(p, find);
  e = p.press('ƒ', { code: 'KeyF' }); assert.deepEqual([find.clicks, focus, e.defaultPrevented], [1, 1, true], 'a field as the target is focused too (it takes the typing)');
  p.body.children.pop();
  assert.deepEqual([...p.WizardApp.keys.list()].map(k => [k.key, k.label]), [['j', 'Next'], ['j', 'Next'], ['/', ''], ['k', ''], ['.', ''], [';', ''], [',', '']]);
  assert.equal(p.WizardApp.keys.match({ altKey: true, code: 'KeyJ' }), nextA);
});

test('plain keys no longer act: j, Space, Enter, arrows do nothing (the app\'s own business again)', () => {
  const p = load();
  const [j] = add(p, el('button', { 'data-wz-key': 'j' }));
  for (const [key, code] of [['j', 'KeyJ'], [' ', 'Space'], ['Enter', 'Enter'], ['ArrowDown', 'ArrowDown']]) {
    const e = p.press(key, { code, altKey: false }); assert.equal(e.defaultPrevented, false, code);
  }
  assert.equal(j.clicks, 0, 'plain j does nothing');
});

test('the key set: one lower-case letter or / , . ; — never Wizard\'s own (h w s d v c), Space, Enter, arrows, digits, brackets, Escape, capitals', () => {
  const p = load();
  const bad = ['h', 'w', 's', 'd', 'v', 'c', 'Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '1', '0', '[', ']', '`', 'Escape', 'J', '?', '-', 'ab', ''];
  const nodes = add(p, ...bad.map(k => el('button', { 'data-wz-key': k })));
  assert.deepEqual([...p.WizardApp.keys.list()], [], 'none of them is ever listed');
  for (const code of ['KeyH', 'KeyW', 'KeyS', 'KeyD', 'KeyV', 'KeyC', 'Space', 'Enter', 'ArrowUp', 'Digit1', 'Digit0', 'BracketLeft', 'Backquote', 'Escape']) p.press('', { code });
  assert.ok(nodes.every(n => n.clicks === 0), 'and never pressed');
});

test('only ⌥ alone (not ⇧ / Ctrl / ⌘ with it), not composing, not once the app handled it; works while typing in a field; held down fires once', () => {
  const p = load();
  const [j] = add(p, el('button', { 'data-wz-key': 'j' }));
  for (const o of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }, { defaultPrevented: true }]) {
    const e = p.press('j', o); assert.equal(j.clicks, 0, JSON.stringify(Object.keys(o))); if (!o.defaultPrevented) assert.equal(e.defaultPrevented, false);
  }
  const field = el('input'), rich = el('div', { contenteditable: '' }, el('span')); add(p, field, rich);
  p.press('j', { target: field }); p.press('j', { target: rich.children[0] }); assert.equal(j.clicks, 2, '⌥J from inside a field still presses it');
  const e = p.press('j', { repeat: true }); assert.equal(j.clicks, 2, 'held down: once'); assert.equal(e.defaultPrevented, true, 'still not typed into the page');
});

test('only visible, enabled controls count; an open modal keeps the keys to itself', () => {
  const p = load();
  const hid = el('button', { 'data-wz-key': 'n', hidden: '' }), inHidden = el('div', { hidden: '' }, el('button', { 'data-wz-key': 'n' }));
  const inert = el('div', { inert: '' }, el('button', { 'data-wz-key': 'n' })), aria = el('div', { 'aria-hidden': 'true' }, el('button', { 'data-wz-key': 'n' }));
  const off = el('button', { 'data-wz-key': 'n', disabled: '' }), ariaOff = el('button', { 'data-wz-key': 'n', 'aria-disabled': 'true' });
  const noBox = el('button', { 'data-wz-key': 'n' }); noBox.box = false;
  const live = el('button', { 'data-wz-key': 'n' }), right = el('button', { 'data-wz-key': 'l' });
  add(p, hid, inHidden, inert, aria, off, ariaOff, noBox, live, right);
  p.press('n'); assert.equal(live.clicks, 1, 'the one that can be seen and used');
  assert.deepEqual([...p.WizardApp.keys.list()].map(k => k.el), [live, right]);
  const sheetBtn = el('button', { 'data-wz-key': 'o' }), sheet = el('div', { role: 'dialog' }, sheetBtn);
  const dlgBtn = el('button', { 'data-wz-key': 'y' }), dlg = el('dialog', { open: '' }, dlgBtn);
  add(p, sheet, dlg);
  p.press('n'); assert.equal(live.clicks, 1, 'behind the modal: nothing');
  p.press('y'); assert.equal(dlgBtn.clicks, 1, 'the topmost modal\'s own key');
  p.press('o'); assert.equal(sheetBtn.clicks, 0, 'a lower modal is behind the top one');
  assert.deepEqual([...p.WizardApp.keys.list()].map(k => k.el), [dlgBtn]);
});

test('framed: the SDK never presses (the shell does, no double fire) but still lists its targets for the shell', () => {
  const p = load({ framed: true });
  const [b] = add(p, el('button', { 'data-wz-key': 'k' }));
  const e = p.press('˚', { code: 'KeyK' }); assert.deepEqual([b.clicks, e.defaultPrevented], [0, false]);
  p.press('k', { altKey: false }); assert.equal(b.clicks, 0);
  assert.equal(typeof p.WizardApp.keys.list, 'function'); assert.equal(p.WizardApp.keys.list()[0].el, b);
  assert.ok(Object.isFrozen(p.WizardApp.keys));
  assert.match(client, /if \(!framed\) addEventListener\('keydown', e => \{\n\s+const hit = keyMatch\(e\);/, 'the SDK\'s own ⌥ handler is standalone only');
  assert.doesNotMatch(client, /keyDone|Arrow\(Up\|Down/, 'no plain-key click left');
});

test('the reserved list is one exported constant, and the SDK\'s letters agree with it', async () => {
  const m = await import('../web/layouts/ai-apps/desktop.js').catch(() => null);
  const src = read('web/layouts/ai-apps/desktop.js');
  const want = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'BracketLeft', 'BracketRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyH', 'Backquote', 'KeyW', 'KeyS', 'Space', 'KeyD', 'KeyV', 'KeyC'];
  const lit = /export const RESERVED_KEYS = Object\.freeze\((\[[^\]]*\])\);/.exec(src); assert.ok(lit, 'exported once');
  assert.deepEqual(JSON.parse(lit[1].replace(/'/g, '"')), want);
  const letters = want.filter(c => /^Key/.test(c)).map(c => c.slice(3).toLowerCase()).sort().join('');
  assert.equal(/const RESERVED_LETTERS = '([a-z]+)';/.exec(client)[1].split('').sort().join(''), letters);
  if (m) {
    assert.deepEqual([...m.RESERVED_KEYS], want);
    assert.deepEqual(['KeyJ', 'Slash', 'Comma', 'Period', 'Semicolon', 'KeyK', 'KeyH', 'KeyW', 'Space', 'Digit1', 'BracketLeft', 'ArrowDown', 'Enter', 'Quote'].map(m.appKeyOf), ['j', '/', ',', '.', ';', 'k', '', '', '', '', '', '', '', '']);
    assert.deepEqual(['j', '/', 'h', 's', 'Space', 'J', 'ArrowUp'].map(m.isAppKey), [true, true, false, false, false, false, false]);
  }
});

test('the shell: keycaps on a frame\'s targets are offset by the frame and hit-tested in its own page, in Wizard\'s own keycap; ⌥ keys in a frame reach the shell', () => {
  const desk = read('web/desktop/desktop.js');
  assert.match(desk, /const ox = fr \? fr\.left \+ \(f\.clientLeft \|\| 0\) : 0, oy = fr \? fr\.top \+ \(f\.clientTop \|\| 0\) : 0;/);
  assert.match(desk, /if \(f\) \{ const inner = n\.ownerDocument\.elementFromPoint\(hx - ox, hy - oy\);/);
  assert.match(desk, /opt\?\.app \? `\$\{ALT\} \$\{label\}: \$\{opt\.name \|\| label\}`/, 'an app key reads with ⌥ too');
  assert.doesNotMatch(read('web/layouts/ai-apps/desktop.css'), /\.kh-chip\.kh-app \{/, 'no second (outlined) keycap style');
  assert.match(desk, /(doc|frameWindow)\.addEventListener\('keydown', e => onKey\(e, true\), true\);\s*(doc|frameWindow)\.addEventListener\('keyup', e => \{ keyHints\.up\(e\);/);
  const host = read('web/core/skin-host.js');
  assert.match(host, /c\.frame\?\.tagName === 'IFRAME' \? \{ frame: c\.frame \} : \{\}/, 'the frame passes through keyChips');
  assert.match(host, /c\.app === true \? \{ app: true, name:/);
});

test('docs: the App keys section app authors follow', () => {
  const doc = read('docs/ai-apps-view.md');
  const sec = doc.slice(doc.indexOf('## App keys'), doc.indexOf('## How it is built'));
  assert.ok(doc.includes('## App keys'), 'a section of its own');
  for (const w of ['data-wz-key', 'data-wz-key-label', 'WizardApp.keys.list()', 'e.code', 'RESERVED_KEYS', '⌥1–⌥0', '⌥[ ⌥]', '⌥H', '⌥W', '⌥S', '⌥Space', '⌥D ⌥V ⌥C', 'aria-modal', 'SAME keycap', 'contenteditable']) assert.ok(sec.includes(w), w);
  assert.doesNotMatch(sec, /OUTLINED|with plain keys \(no ⌥\)|`Space`, `Enter`, `ArrowUp`/, 'no plain-key language left');
});
