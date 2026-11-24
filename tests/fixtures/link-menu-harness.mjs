// Runs the real web/core/links.js (long-press link menu, link sheet, downloads) in node:vm on a mini-dom document
// (wizard-ux issue 1674: tests run the code). Every way out of the shell is recorded in `calls`:
//   ['open', url]             window.open (a new tab / the system browser)
//   ['native-browser', url]   the Android bridge's openInBrowser
//   ['native-download', url]  the Android bridge's download
//   ['copy', text]            navigator.clipboard.writeText
//   ['a-download', href, name] an <a download> click
// links({ native, openInBrowser, download }) -> { w, doc, calls, chat, longPress(href, attrs), tap(button), flush() }.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createDocument } from './mini-dom.mjs';

const source = readFileSync(new URL('../../web/core/links.js', import.meta.url), 'utf8');
export const ORIGIN = 'https://box.test';

export function links({ native = false, openInBrowser = true, download = true } = {}) {
  const calls = [], timers = [];
  const doc = createDocument({ url: ORIGIN + '/wizard-os-home/' });
  const clipboard = { writeText: t => { calls.push(['copy', t]); return Promise.resolve(); } };
  const navigator = { userAgent: 'test', clipboard, userActivation: { isActive: true } };
  const view = { listeners: {}, navigator, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } };
  doc.defaultView = view;
  doc.documentElement.clientWidth = 400; doc.documentElement.clientHeight = 800;
  const make = doc.createElement;
  doc.createElement = tag => { const el = make(tag); if (tag === 'a') el.click = () => calls.push(['a-download', el.href, el.download]); return el; };
  const w = { open: url => { calls.push(['open', url]); return null; }, addEventListener() {} };
  if (native) {
    w.WizardOSNative = {};
    if (openInBrowser) w.WizardOSNative.openInBrowser = url => calls.push(['native-browser', url]);
    if (download) w.WizardOSNative.download = url => calls.push(['native-download', url]);
  }
  w.WizConfig = { raw: { settings: { links: { panel: false } } }, localURL: (h, b) => new URL(h, b) };
  const setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
  vm.runInNewContext(source, { window: w, location: new URL(ORIGIN + '/wizard-os-home/'), navigator, document: doc, localStorage: { getItem: () => null, setItem() {} },
    URL, console, setTimeout, clearTimeout() {}, performance: { now: () => 0 }, Date, JSON, Object, Set, Promise, Math, isFinite });
  // A chat thread: a bubble with links, and the composer next to it (the menu must never write into it).
  doc.body.innerHTML = '<div class="chat"><div class="bub" id="bub"></div><textarea id="composer"></textarea></div>';
  const chat = doc.querySelector('.chat');
  const L = w.WizLinks.mount({ parent: doc.body, onKeep() {} });
  w.WizLinks.intercept(chat, L);
  function longPress(href, root = chat) {
    const bub = root.querySelector('.bub') || root;
    bub.innerHTML = `<a href="${href}">link</a>`;
    const a = bub.querySelector('a');
    const e = { type: 'contextmenu', bubbles: true, clientX: 20, clientY: 30 };
    a.dispatchEvent(e);
    const menu = (root.ownerDocument || doc).body.querySelector('.wiz-linkmenu');
    return { a, e, menu, words: menu ? menu.querySelectorAll('button').map(b => b.textContent) : [] };
  }
  // A real finger: press then lift on the item (the menu ignores a click without a fresh press).
  function tap(button) { button.dispatchEvent({ type: 'pointerdown', bubbles: true }); return button.click(); }
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  return { w, doc, calls, chat, L, timers, longPress, tap, flush };
}
