// A shell world for "every Ready pill is the unread projection" tests (wizard-ux issue 1674: run the code). The real
// web/core/workspace-navigation.js is loaded into a vm window with a LIVE whose Ready inventory (5 threads) differs
// from its unread tally (2), and a WosBell whose Ready inventory (7) differs from its unread count (1): the shared
// projection answers 3; a shell that used the inventory would answer 5, 7 or 12.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { runRecording } from './source-slice.mjs';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
export const UNREAD = 3;

export function unreadWorld(extra = {}) {
  const ready = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id: 'ready-' + id }));
  const LIVE = { ok: true, unified: () => ready, visibleUnread: rows => rows.slice(0, 2), workGroups: () => ({ working: [{ id: 'w1' }], ready }),
    groups: () => ({ needs: [], ready, working: [{ id: 'w1' }] }), session: () => null, isNew: () => false };
  const listeners = {}, events = [];
  const win = { WosBell: { unreadCount: () => 1, readyCount: () => 7, readyMore: () => false },
    WizConfig: { dayParts: () => ({ dow: 0, d: 1, m: 1 }), hm: () => '09:00', dateLabel: () => 'Mon 1 Jan' },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    setInterval: () => 0, addEventListener: (t, f) => (listeners[t] ||= []).push(f), dispatchEvent: e => events.push(e), ...extra };
  win.window = win; win.globalThis = win;
  vm.createContext(win);
  vm.runInContext(read('web/core/workspace-navigation.js'), win);
  const fire = t => { for (const f of listeners[t] || []) f({ type: t }); };
  return { win, LIVE, listeners, events, fire, C: win.WizCore };
}

// Run a shell slice in that world: names it does not get become recorders (runRecording), the world's window is its
// window, and WizCore is the world's (so workspaceNav is the real one).
export function runIn(world, code, ctx = {}) {
  return runRecording(code, { window: world.win, WizCore: world.C, C: world.C, LIVE: world.LIVE, CustomEvent: world.win.CustomEvent,
    addEventListener: world.win.addEventListener, ...ctx });
}
