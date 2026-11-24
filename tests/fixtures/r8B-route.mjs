// A layout holding the shell's opens (WosSkinHost.routeOpen, apps.routeOpens), for tests that run a shell entry point
// (wizard-ux issue 1674: run the code). mode 'none': nobody holds it (routeOpen answers null, the shell runs its own go);
// 'take': the holder runs the go it was given (with `arg`, e.g. a desk) and hands back { value }; 'keep': the holder
// places the open itself and never calls go. `asked` lists [kind, detail] per ask, `gone` the go results.
import { runRecording } from './source-slice.mjs';

export function holder(mode = 'none', arg) {
  const asked = [], gone = [];
  const host = {
    routeOpen(kind, detail, go) {
      asked.push([kind, JSON.parse(JSON.stringify(detail))]);
      if (mode === 'none') return null;
      if (mode === 'keep') return { value: true };
      const value = go(arg); gone.push(value); return { value };
    },
    routeShows: desk => mode !== 'none' && desk === arg,
  };
  return { host, asked, gone };
}

// Run a shell slice with `ctx`; window (ctx.window or {}) gets the holder's WosSkinHost. Returns the run context; the
// slice's recorder calls are in ctx.calls as [name, ...args].
export function runHeld(code, ctx, h) {
  const window = { ...(ctx.window || {}), WosSkinHost: h.host };
  return runRecording(code, { location: { href: 'https://box.test/wizard-os-home/', origin: 'https://box.test' }, URL, ...ctx, window });
}

// Calls of one recorder name, args JSON-copied out of the vm realm.
export const callsOf = (ctx, name) => ctx.calls.filter(c => c[0] === name).map(c => JSON.parse(JSON.stringify(c.slice(1), (k, v) => (typeof v === 'function' ? '[fn]' : v))));
