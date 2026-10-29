// The first-run tour holds the install banner while it runs (Codex P2 on #569): tour.js calls
// window.WizardPwaInstall?.hold?.(true/false), so pwa-install.js must expose a real hold() that hides the banner.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../web/pwa-install.js', import.meta.url), 'utf8');
const TOUR = readFileSync(new URL('../web/core/tour.js', import.meta.url), 'utf8');

function page() {
  const listeners = {}, shown = [];
  const el = () => ({ dataset: {}, style: {}, id: '', setAttribute() {}, addEventListener() {}, remove() { const i = shown.indexOf(this); if (i >= 0) shown.splice(i, 1); },
    attachShadow() { return { set innerHTML(v) {}, querySelector: () => ({ textContent: '', disabled: false, addEventListener() {} }) }; } });
  const window = { addEventListener: (t, f) => (listeners[t] = f) };
  window.top = window.self = window;
  const ctx = vm.createContext({
    window, console, Date, URL, navigator: {},
    location: { origin: 'https://box.example', pathname: '/wizard-os-home/' },
    document: { currentScript: { dataset: {}, src: 'https://box.example/wizard-os-home/pwa-install.js' }, title: 'Wizard',
      body: { prepend: n => shown.push(n) }, createElement: el, addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(SRC, ctx);
  return { window, listeners, nodes: shown };
}

test('pwa-install exposes the hold() the tour calls', () => {
  assert.match(TOUR, /window\.WizardPwaInstall\?\.hold\?\.\(true\)/);
  const { window } = page();
  assert.equal(typeof window.WizardPwaInstall?.hold, 'function');
});

test('a held banner is not shown, and shows again once released', () => {
  const { window, listeners, nodes } = page();
  window.WizardPwaInstall.hold(true);
  listeners.beforeinstallprompt({ preventDefault() {}, prompt: async () => {}, userChoice: Promise.resolve({}) });
  assert.ok(listeners.beforeinstallprompt, 'listener registered');
  assert.equal(nodes.length, 0, 'no banner while the tour holds it');
  window.WizardPwaInstall.hold(false);
  assert.equal(nodes.length, 1, 'the banner returns after the tour');
});
