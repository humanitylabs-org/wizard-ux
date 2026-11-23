// Real desktop shell parts (web/desktop/desktop-<part>.js, window.WizCore.desktopParts.<part>) run in a vm with every
// shell helper they are handed a recorder unless the test gives it (wizard-ux issue 1674, run q1), so tests call the
// shell's own functions instead of reading them:
//   desktopBoot(given, win)  -> the adapter desktop-boot.js attaches to the skin host (closeDesk, moveDesk, ...);
//   desktopPart(part, given, win) -> what the part returns, plus `chatsHost`: the options it gave WizChatsHost.create.
import { readFileSync } from 'node:fs';
import { recorder, runRecording } from './source-slice.mjs';

const src = part => readFileSync(new URL(`../../web/desktop/desktop-${part}.js`, import.meta.url), 'utf8');

export function desktopPart(part, given = {}, win = {}) {
  const calls = [], attached = [], created = [];
  const base = { WizCore: {}, WizChatsHost: { create: o => { created.push(o); return new Proxy({}, { get: (_, k) => recorder('CHATS.' + String(k), calls) }); } }, ...win,
    WosSkinHost: { attach: a => { attached.push(a); }, ...(win.WosSkinHost || {}) } };
  const window = new Proxy(base, { get: (t, k) => (k in t || typeof k !== 'string' ? t[k] : recorder('window.' + k, calls)) });   // other globals: recorders
  const ctx = runRecording(src(part), { window, calls, ...(win.globals || {}) });
  const parts = window.WizCore.desktopParts;
  window.WizCore.desktopParts = new Proxy(parts, { get: (t, k) => (k in t ? t[k] : recorder('parts.' + String(k), calls)) });
  const scope = new Proxy(given, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? recorder(k, calls) : undefined), has: () => true });
  const out = parts[part](scope);
  return { ...out, ctx, calls, attached, adapter: attached[0] || null, chatsHost: created[0] || null };
}

export const desktopBoot = (given, win) => desktopPart('boot', given, win);
