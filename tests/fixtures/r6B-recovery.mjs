// The desktop's kept-recordings card (the recovery block of web/desktop/desktop.js, parts put back) run in node:vm on
// tests/fixtures/mini-dom.mjs with a fake outbox (wizard-ux issue 1674: tests run the code). The card is the real
// <section id="recordingRecovery"> in the document body; buttons are pressed through its real click listener.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withDesktopParts } from './desktop-parts.mjs';
import { between } from './source-slice.mjs';
import { createDocument } from './mini-dom.mjs';

const desktop = withDesktopParts(readFileSync(new URL('../../web/desktop/desktop.js', import.meta.url), 'utf8'));
export const recoverySource = () => between(desktop, '  // Recovery is a view of the existing outbox', '  let dictationFinishing = false;');

export function recoveryCard(takes, { sessions = {}, createObjectURL = () => 'blob:take' } = {}) {
  const doc = createDocument(), toasts = [], downloads = [], revoked = [];
  const items = new Map(takes.map(t => [t.id, t]));
  const outbox = { recordings: () => [...items.values()], get: id => items.get(id) || null, canRetry: () => true, onChange() {},
    load: () => ({ then: fn => fn() }), remove: async id => items.delete(id), removeError: () => '' };
  const make = doc.createElement.bind(doc);
  doc.createElement = tag => {
    const el = make(tag);
    if (tag === 'a') el.click = () => downloads.push({ href: el.href, download: el.download, connected: el.isConnected, hidden: el.hidden });
    return el;
  };
  const ctx = { document: doc, window: { WosOutbox: outbox }, OUTBOX: outbox, Blob, console: { error() {} },
    LIVE: { session: sid => sessions[sid] || null }, toast: (...a) => toasts.push(a), Date,
    esc: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    URL: { createObjectURL, revokeObjectURL: u => revoked.push(u) }, setTimeout: fn => { fn(); return 0; }, navigator: {} };
  vm.createContext(ctx);
  vm.runInContext(`(() => {\n${recoverySource()}\n})();`, ctx);
  const card = doc.getElementById('recordingRecovery');
  const press = async sel => { const b = card.querySelector(sel); await Promise.all((card.listeners.click || []).map(l => l.f.call(card, { target: b, type: 'click' }))); };
  return { doc, card, toasts, downloads, revoked, press };
}
