// The real desktop boot part (web/desktop/desktop-boot.js, window.WizCore.desktopParts.boot) run in a vm with every
// shell helper it is handed a recorder unless the test gives it; returns the adapter it attaches to the skin host
// (window.WosSkinHost.attach), so tests call the shell's own closeDesk / moveDesk / ... instead of reading them
// (wizard-ux issue 1674, run q1).
import { readFileSync } from 'node:fs';
import { recorder, runRecording } from './source-slice.mjs';

const BOOT = readFileSync(new URL('../../web/desktop/desktop-boot.js', import.meta.url), 'utf8');

export function desktopBoot(given = {}, win = {}) {
  const calls = [], attached = [];
  const window = { WizCore: {}, ...win, WosSkinHost: { attach: a => { attached.push(a); }, ...(win.WosSkinHost || {}) } };
  const ctx = runRecording(BOOT, { window, calls });
  const parts = window.WizCore.desktopParts;
  window.WizCore.desktopParts = new Proxy(parts, { get: (t, k) => (k in t ? t[k] : recorder('parts.' + String(k), calls)) });
  const scope = new Proxy(given, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? recorder(k, calls) : undefined), has: () => true });
  const out = parts.boot(scope);
  return { ...out, ctx, calls, attached, adapter: attached[0] || null };
}
