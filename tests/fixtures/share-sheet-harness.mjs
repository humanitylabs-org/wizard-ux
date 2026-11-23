// The real Send to agent sheet (web/core/share-wizard.js) on the tiny DOM (tests/fixtures/mini-dom.mjs), with a fake
// agent list and fake chat lists per agent whose answers the test releases (wizard-ux issue 1674: tests run the code).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './mini-dom.mjs';

const SRC = readFileSync(new URL('../../web/core/share-wizard.js', import.meta.url), 'utf8');
const SHEETBACK = readFileSync(new URL('../../web/core/sheetback.js', import.meta.url), 'utf8');
export const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

export function shareSheet({ agents = [{ id: 'hermes', label: 'Wizard', is_default: true, status: 'running' }, { id: 'merlin', label: 'Merlin', status: 'running' }],
  threads = { '': [{ id: 't1', title: 'Plans' }], merlin: [{ id: 'm1', title: 'Spells' }] }, hold = false, sheetBack = true } = {}) {
  const document = createDocument(), fetches = [], pending = [];
  const answer = (url) => { const agent = new URL(url, 'https://box.test').searchParams.get('agent') || ''; return { ok: true, status: 200, json: async () => ({ data: threads[agent] || [] }) }; };
  const window = { WizConfig: { agent: () => 'Wizard' }, __wos: { chats: { uploadFile() {}, sendChat() {} }, openWizardThread() {} },
    WosAgents: { load: async () => agents, error: null } };
  const ctx = { window, document, URL, AbortController, Promise, setTimeout, clearTimeout, console, Date, File, Blob,
    fetch: url => { fetches.push(String(url)); if (!hold) return Promise.resolve(answer(url)); return new Promise(r => pending.push(() => r(answer(url)))); } };
  ctx.performance = { now: () => Date.now() };
  window.performance = ctx.performance;
  vm.createContext(ctx);
  if (sheetBack) { vm.runInContext(`(function (window) { ${SHEETBACK} })(window)`, ctx); }
  vm.runInContext(SRC, ctx);
  const S = window.WizShareWizard;
  const q = s => document.querySelector(s), all = s => document.querySelectorAll(s);
  const tap = s => { const el = typeof s === 'string' ? q(s) : s; if (!el) throw new Error(`nothing to tap: ${s}`); el.click(); };
  return { S, window, document, fetches, pending, q, all, tap, release: async () => { while (pending.length) pending.shift()(); await flush(); } };
}
