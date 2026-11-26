// wizard-ux issue 1639: James, 19 Nov 2026, "probably these would be more intuitive with icons." WosContextMenu.open
// items take an optional `icon` (a built-in name), and the Android attach menu passes one per choice only while
// switch wizard/attach-menu-icons is on. Off: the exact plain rows of today. Real context-menu.js in a vm with a
// small fake DOM; the browser proof (two skins, sizes, opaque panel) is tests/qa-attach-menu-icons.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../web/core/context-menu.js', import.meta.url), 'utf8');
const CATALOG = JSON.parse(fs.readFileSync(new URL('../web/tweaks/catalog.json', import.meta.url), 'utf8'));
const SWITCH = 'wizard/attach-menu-icons';

function el(tag, ns = null) {
  const n = {
    tagName: tag.toUpperCase(), ns, children: [], attrs: {}, className: '', _text: '', style: {}, parent: null, listeners: {},
    classList: { add: c => { n.className = (n.className + ' ' + c).trim(); }, contains: c => n.className.split(' ').includes(c) },
    setAttribute(k, v) { n.attrs[k] = String(v); }, getAttribute(k) { return k in n.attrs ? n.attrs[k] : null },
    removeAttribute(k) { delete n.attrs[k]; }, hasAttribute(k) { return k in n.attrs; },
    appendChild(c) { c.parent = n; n.children.push(c); return c; }, append(...cs) { for (const c of cs) n.appendChild(c); },
    remove() { if (n.parent) n.parent.children = n.parent.children.filter(x => x !== n); },
    addEventListener(t, f) { (n.listeners[t] ||= []).push(f); }, focus() {}, contains: () => false,
    getBoundingClientRect: () => ({ left: 10, top: 700, bottom: 740, width: 200, height: 160 }),
    querySelectorAll(sel) { const out = [], want = sel.replace(/^\./, ''); const walk = x => { for (const c of x.children) { if (c.tagName === want.toUpperCase() || c.className.split(' ').includes(want)) out.push(c); walk(c); } }; walk(n); return out; },
    get textContent() { return n._text + n.children.map(c => c.textContent).join(''); },
    set textContent(v) { n.children = []; n._text = String(v); },
  };
  return n;
}

function load(tweaks) {
  const body = el('body');
  const doc = { body, documentElement: { dataset: { tweaks } }, createElement: t => el(t), createElementNS: (ns, t) => el(t, ns), addEventListener() {}, activeElement: null };
  const win = { innerWidth: 412, innerHeight: 915, addEventListener() {}, visualViewport: null };
  doc.defaultView = win;
  const ctx = { document: doc, navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)' }, AbortController, Number, Object, Math };
  ctx.window = Object.assign(win, { WizardOSNative: {} });
  ctx.window.window = ctx.window;
  vm.createContext(ctx); vm.runInContext(SRC, ctx);
  const input = { accept: '', multiple: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, click() { this.clicked = { accept: this.accept, capture: 'capture' in this.attrs }; } };
  const anchor = Object.assign(el('button'), { ownerDocument: doc, isConnected: true });
  return { M: ctx.window.WosContextMenu, body, input, anchor, doc };
}
const panel = body => body.children.find(c => c.className.includes('wos-context-menu'));
const rows = p => p.children.filter(c => c.attrs.role === 'menuitem');

test('switch on: each attach choice has a round icon tile before its words', () => {
  const { M, body, input, anchor } = load(`wizard/desktop-chats ${SWITCH}`);
  assert.equal(M.attach(input, anchor), true);
  const p = panel(body);
  assert.ok(p.classList.contains('wos-cm-icons'), 'the panel is marked for icon rows');
  const r = rows(p);
  assert.deepEqual(r.map(b => b.textContent).sort(), ['Camera', 'File', 'Photo or video'], 'words unchanged');
  for (const b of r) {
    const [tile, words] = b.children;
    assert.equal(tile.className, 'wos-cm-tile'); assert.equal(tile.attrs['aria-hidden'], 'true');
    const svg = tile.children[0];
    assert.equal(svg.ns, 'http://www.w3.org/2000/svg'); assert.equal(svg.attrs.stroke, 'currentColor', 'the icon takes the skin colour');
    assert.ok(svg.children.length >= 1 && svg.children.every(x => x.tagName === 'PATH' && x.attrs.d));
    assert.equal(words.className, 'wos-cm-label');
  }
  // Each icon matches its choice, whatever the order.
  const d = Object.fromEntries(r.map(b => [b.textContent, b.children[0].children[0].children.length]));
  assert.deepEqual(d, { Camera: 2, 'Photo or video': 3, File: 1 });
  r.find(b => b.textContent === 'Camera').listeners.click[0]({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(input.clicked, { accept: 'image/*', capture: true }, 'Camera still opens the camera');
});

test('switch off: the attach menu is today\'s plain text rows', () => {
  const { M, body, input, anchor } = load('wizard/desktop-chats');
  M.attach(input, anchor);
  const p = panel(body);
  assert.equal(p.classList.contains('wos-cm-icons'), false);
  for (const b of rows(p)) { assert.equal(b.children.length, 0, 'no tile'); assert.ok(b._text); }
});

test('open(): an unknown icon name is ignored, never a broken tile', () => {
  const { M, body, anchor } = load(SWITCH);
  M.open({ anchor, items: [{ label: 'Odd', icon: 'constructor', action() {} }, { label: 'Pic', icon: 'picture', action() {} }] });
  const [odd, pic] = rows(panel(body));
  assert.equal(odd.children.length, 0); assert.equal(odd.textContent, 'Odd');
  assert.equal(pic.children[0].className, 'wos-cm-tile');
});

test('with the catalog defaults (a fresh install) the switch is off and the attach menu is plain rows', () => {
  assert.ok(CATALOG.tweaks.includes(SWITCH), 'listed so it can be flipped');
  const { M, body, input, anchor } = load(CATALOG.defaults.join(' '));
  assert.equal(M.attach(input, anchor), true);
  const p = panel(body);
  assert.ok(!p.className.includes('wos-cm-icons'));
  assert.deepEqual(rows(p).map(r => [r.textContent, r.children.length]), [['Photo or video', 0], ['Camera', 0], ['File', 0]]);
  const m = JSON.parse(fs.readFileSync(new URL('../web/tweaks/wizard/attach-menu-icons/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(m.issues, ['humanitylabs-org/wizard-ux#1639']);
});
