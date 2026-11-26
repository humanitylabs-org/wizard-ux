// Runs the real Setup app (web/setup/setup.js) with the real phone-connect component (web/core/phone-connect.js)
// on its real page (web/setup/index.html body) in node:vm, over tests/fixtures/mini-dom.mjs, with a fake fetch for
// the Agent Service's /wizard/v1/setup endpoints (wizard-ux issue 1674: tests run the code).
//   const s = await setupApp({ setup: { first_run: false, items: [{ id: 'phone', state: 'done' }] } });
//   s.list.innerHTML, s.tap('[data-act="list-connect-device"]'), s.sheets (WzSheet calls), s.recommended (calls)
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createDocument } from './mini-dom.mjs';

const web = p => readFileSync(new URL('../../web/' + p, import.meta.url), 'utf8');
const SETUP = web('setup/setup.js'), PC = web('core/phone-connect.js');
const BODY = (() => { const h = web('setup/index.html'); return h.slice(h.indexOf('<body>') + 6, h.indexOf('</body>')); })();
export const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

const PHONE = { step: 'phone_seen', wizard_url: 'https://wizard.example.test/', phones: [{ name: 'Pixel', os: 'android', online: true }] };

// getSetUp (wizard-ux issue 1837): also runs the real web/setup/get-set-up.js inside a shell frame; `parent` is the
// shell (data-tweaks, WizOpenApp, postMessage) and `box(url, o)` answers every other request ([status, body] or null).
export async function setupApp({ setup = { items: [] }, seen = 200, phone = PHONE, getSetUp = null } = {}) {
  const doc = createDocument({ url: 'https://wizard.example.test/setup/' });
  doc.visibilityState = 'visible';
  doc.body.innerHTML = BODY;
  const calls = [], sheets = [], recommended = [], timers = [];
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetch = async (url, o = {}) => {
    calls.push([o.method || 'GET', url]);
    if (url === '/wizard/v1/setup') return reply(200, structuredClone(setup));
    if (url === '/wizard/v1/setup/seen') return reply(seen, { ok: true });
    if (url.startsWith('/wizard/v1/setup/phone')) return reply(200, structuredClone(phone));
    const answer = getSetUp?.box?.(String(url), o);
    if (answer) return reply(answer[0], structuredClone(answer[1]));
    return reply(404, {});
  };
  const ctx = {
    document: doc, fetch, console, URL, AbortController, structuredClone,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    matchMedia: () => ({ matches: false }), screen: { width: 1200, height: 800 }, scrollTo() {},
    addEventListener() {}, devicePixelRatio: 1,
    WzSheet: { open: el => sheets.push(['open', el.id]), close: el => sheets.push(['close', el.id]) },
    WosRecommended: { init: () => recommended.push('init'), load: () => recommended.push('load'), prefetch: () => recommended.push('prefetch'), html: () => '' },
  };
  ctx.window = ctx; ctx.parent = ctx; doc.defaultView = ctx;
  if (getSetUp) {
    ctx.location = { href: 'https://wizard.example.test/wizard-os-home/setup/index.html', origin: 'https://wizard.example.test' };
    if (getSetUp.parent) ctx.parent = getSetUp.parent;
  }
  vm.createContext(ctx);
  if (getSetUp) vm.runInContext(web('setup/get-set-up.js'), ctx, { filename: 'get-set-up.js' });
  vm.runInContext(PC, ctx, { filename: 'phone-connect.js' });
  vm.runInContext(SETUP, ctx, { filename: 'setup.js' });
  await tick();
  const $ = id => doc.getElementById(id);
  const tap = async sel => { const el = doc.querySelector(sel); if (!el) throw new Error(`nothing to tap: ${sel}`); el.click(); await tick(); return el; };
  return { doc, ctx, calls, sheets, recommended, timers, tap, $, list: $('list'), phone: $('phone'), state: () => ctx.__setup.state };
}
