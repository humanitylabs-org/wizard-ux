// The phone Home desk as the real shell draws it (web/app-home.js renderHome, with the real gear and Unsent card from
// web/app-unsent.js), in a mini DOM (wizard-ux issue 1674: tests run the code). Peripheral services (clock, live
// counts, the Unsent list) are plain stand-ins.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './mini-dom.mjs';

const read = p => readFileSync(new URL(`../../web/${p}`, import.meta.url), 'utf8');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function phoneHome({ ready = 2, working = 1, needs = 0, skin = '', shell = 'phone', unsent = [], side = '' } = {}) {
  const window = { WizCore: { workspaceNav: { chatsCount: () => ready, readyWord: () => 'unread' } },
    WizConfig: { dayParts: () => ({ dow: 0, d: 6, m: 11 }), hm: () => '9:41' }, WosSettings: { unsentAll: () => unsent }, addEventListener() {} };
  const ctx = { window, setInterval: () => 0, Date, addEventListener() {} };
  vm.runInNewContext(read('app-unsent.js'), ctx);
  vm.runInNewContext(read('app-home.js'), ctx);
  const { gearBtn, unsentCard } = window.WizCore.appParts.unsent({ clip: (s, n) => String(s).slice(0, n), esc, NATIVE: () => false, refreshHome() {}, settingsContext: () => ({}) });
  const LIVE = { ok: true, workGroups: () => ({ working: Array.from({ length: working }, (_, i) => ({ id: 'w' + i })) }) };
  const part = window.WizCore.appParts.home({ $: () => null, DOWL: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    gearBtn, live: () => ({ needs: Array.from({ length: needs }) }), LIVE, refreshHome() {}, sideCard: () => side, unsentCard });
  const doc = createDocument();
  if (skin) doc.documentElement.setAttribute('data-skin', skin);
  doc.documentElement.setAttribute('data-shell', shell);
  doc.body.innerHTML = `<div id="device" class="device"><div class="desk home-desk">${part.renderHome()}</div></div>`;
  return doc;
}
