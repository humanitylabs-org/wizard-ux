// The real web/core/web-update.js in node:vm on a tests/fixtures/mini-dom.mjs page, mounted in the phone shell's
// #device the way app.js mounts it, with a fake update feed: after `await phoneBanner()` the page holds the banner an
// owner sees when a new interface is ready (wizard-ux issue 1674: tests run the code, CSS included).
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withShellParts } from './shell-parts.mjs';
import { createDocument } from './mini-dom.mjs';

const SRC = withShellParts(readFileSync(new URL('../../web/core/web-update.js', import.meta.url), 'utf8'));

export async function phoneBanner({ plan = { ok: true, blocking: [], capture: { safe: true } }, skin = '', shell = 'phone' } = {}) {
  const doc = createDocument({ url: 'https://synthetic.invalid/wizard-os-home/' });
  if (skin) doc.documentElement.setAttribute('data-skin', skin);
  doc.documentElement.setAttribute('data-shell', shell);
  doc.body.innerHTML = '<div id="device" class="device"></div>';
  doc.currentScript = { src: 'https://synthetic.invalid/wizard-os-home/core/web-update.js' };
  let rev = 'a'.repeat(40);
  const window = { WizAppServices: { update: { announce() {}, reloadPlan: () => plan } }, WizAppCapture: { staleTakes: () => [] }, WizCore: { apps: () => ({ APPS: [] }) } };
  const ctx = { window, document: doc, URL, JSON, String, Promise, Date, navigator: { onLine: true }, sessionStorage: { getItem: () => null, setItem() {} },
    location: { href: 'https://synthetic.invalid/wizard-os-home/index.html', pathname: '/wizard-os-home/index.html', reload() {} },
    fetch: async () => ({ ok: true, text: async () => rev, json: async () => ({ updates: [] }) }),
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, addEventListener() {} };
  vm.runInNewContext(SRC, ctx);
  const W = window.WizWebUpdate;
  W.init({ shell, autoApply: false, mount: () => doc.getElementById('device'), busy: () => false, beforeReload() {}, toast() {} });
  await W.check(true); rev = 'b'.repeat(40); await W.check(true);
  return { doc, W, banner: doc.getElementById('dvWeb'), device: doc.getElementById('device') };
}
