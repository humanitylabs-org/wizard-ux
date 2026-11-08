// Notification levels are core (Miguel, 4 Nov 2026; was the opt-in miguel/notification-levels tweak, #855): boots the
// real core (workspace-navigation.js + notif-bell.js) in a vm.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
export const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

export function core(ctx) {
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('web/core/workspace-navigation.js'), ctx);
  vm.runInContext(read('web/core/notif-bell.js'), ctx);
  return ctx;
}
export const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
