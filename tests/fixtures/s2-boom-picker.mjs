// The real Snooze picker (web/core/scheduled-reminders.js) on mini-dom (wizard-ux issue 1674: tests run the code).
// boomerang({ fetch, WizLive }) runs the whole file; events are the window events it dispatched, in order.
// openSheet(b, opts) draws the sheet with open(opts) and returns { form, text }; form fields are read by name, as a
// browser form exposes them (mini-dom has no form.elements), and a select's value is its selected option.
import { readFileSync } from 'node:fs';
import { createDocument } from './mini-dom.mjs';
import { runWithChatsModel } from './chats-list-model.mjs';

const SRC = readFileSync(new URL('../../web/core/scheduled-reminders.js', import.meta.url), 'utf8');

export function boomerang({ fetch, WizLive = null } = {}) {
  const doc = createDocument(), events = [];
  const store = new Map();
  const sb = { Intl, Date, URL, crypto, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, Event: class { constructor(t) { this.type = t; } },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    location: { pathname: '/wizard-os-home/' }, setInterval: () => 1, setTimeout, clearTimeout, addEventListener() {}, dispatchEvent: e => { events.push(e.type); return true; },
    document: doc, fetch: fetch || (async () => ({ ok: true, status: 200, json: async () => ({ schedules: [] }) })), ...(WizLive ? { WizLive } : {}) };
  sb.window = sb;
  runWithChatsModel(SRC, sb);
  return { B: sb.WosBoomerang, doc, events };
}

export function openSheet(b, opts) {
  const proto = Object.getPrototypeOf(b.doc.createElement('form'));
  const byName = (form, n) => {
    const el = form.querySelector(`[name="${n}"]`);
    if (el?.localName === 'select' && el._value == null) el.value = (el.querySelector('option[selected]') || el.querySelector('option'))?.getAttribute('value') ?? '';
    return el;
  };
  const shim = { elements: { get() { return new Proxy({}, { get: (o, n) => byName(this, String(n)) }); } } };
  for (const n of ['date', 'time', 'timezone', 'note']) shim[n] = { get() { return this.localName === 'form' ? byName(this, n) : undefined; } };
  for (const [k, d] of Object.entries(shim)) if (!Object.getOwnPropertyDescriptor(proto, k)) Object.defineProperty(proto, k, { ...d, configurable: true });
  b.B.open(opts);
  const form = b.doc.querySelector('form');
  return { form, text: b.doc.querySelector('.boom-sheet').textContent };
}
