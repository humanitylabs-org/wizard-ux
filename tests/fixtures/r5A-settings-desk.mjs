// The desktop shell's real Settings hosting (desktop/desktop-settingshost.js + desktop/desktop-settings.js) wired
// together as desktop.js wires them, on a mini-dom page with a window list W: newWin / closeWin / render stand in for
// the shell's window manager, each window body comes from the real bodyHtml (desktop/desktop-resize.js) and a render
// of a Settings window calls afterRender, as desktop.js's window renderer does.
import { partScope, runPart, readWeb } from './r5A-parts.mjs';
import { block, runRecording } from './source-slice.mjs';

export function settingsDesk({ homeOpen = false, over = false } = {}) {
  const ctx = partScope(); const doc = ctx.document;
  if (over) doc.documentElement.setAttribute('data-settings-over', '');
  const proto = Object.getPrototypeOf(doc.body);
  proto.getClientRects ||= function () { return this.isConnected ? [1] : []; };
  ctx.WizCore.desktopParts = { cog: () => ({ nativeDesktop: () => false, toggleKeys: () => {}, bindLate: () => {} }) };
  const bodyHtml = runRecording(block(readWeb('desktop/desktop-resize.js'), '  function bodyHtml(w) {') + '\nthis.bodyHtml = bodyHtml;', { esc: String, listW: () => 300 }).bodyHtml;
  const setEl = doc.createElement('section'); setEl.className = 'dsettings'; setEl.hidden = true; doc.body.append(setEl);
  const desk = doc.createElement('div'); desk.className = 'desk'; doc.body.append(desk);
  const W = {}, calls = []; let n = 0, focusId = null;
  const vars = { homeOpen, settingsModal: false, settingsPromoted: false, settingsFocus: null, settingsReturn: '', afterRender: null };
  const winEl = id => desk.querySelector(`[data-win="${id}"]`);
  const render = () => {  // the shell's render: one element per window in W, a Settings window body then afterRender
    for (const el of desk.querySelectorAll('[data-win]')) if (!W[el.dataset.win]) desk.removeChild(el);
    for (const w of Object.values(W)) {
      if (winEl(w.id)) continue;
      const el = doc.createElement('div'); el.dataset.win = w.id; el.innerHTML = bodyHtml(w); desk.append(el);
      if (w.app === 'settings') vars.afterRender?.();
    }
  };
  const newWin = o => { const id = 'w' + ++n; W[id] = { id, ...o }; focusId = id; calls.push(['newWin', o.app]); render(); return id; };
  const closeWin = id => { delete W[id]; calls.push(['closeWin', id]); if (focusId === id) focusId = null; render(); vars.afterRender?.(); };
  const focused = () => (focusId ? W[focusId] : null);
  const settingsWin = () => Object.values(W).find(w => w?.app === 'settings') || null;
  const host = runPart('desktop/desktop-settingshost.js', 'desktopParts', 'settingshost', { desktopVars: vars, focused, focusInside: () => {}, setEl, settingsWin, winEl }, ctx).out;
  const s = runPart('desktop/desktop-settings.js', 'desktopParts', 'settings', {
    $: () => doc.createElement('div'), C: {}, closePalette: () => {}, closeWin, desktopVars: vars, focusWin: id => { focusId = id; calls.push(['focusWin', id]); },
    hostSettings: host.hostSettings, newWin, OUTBOX: {}, renderSettings: () => {}, scrim: host.scrim, setEl, settingsFocused: host.settingsFocused,
    settingsView: { focus: () => {}, back: () => false }, settingsWin, showSettingsModal: host.showSettingsModal }, ctx).out;
  host.bindLate({ closeSettings: s.closeSettings, settingsOver: s.settingsOver });
  return { ctx, doc, vars, W, calls, setEl, desk, host, s, settingsWin, winEl, focus: id => { focusId = id; }, render,
    where: () => (setEl.parentNode === doc.body ? 'body' : setEl.parentNode?.closest?.('[data-win]')?.dataset.win || null) };
}
