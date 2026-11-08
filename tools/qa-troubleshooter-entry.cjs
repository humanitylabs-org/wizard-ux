'use strict';
// Browser-evaluate helpers: no closure dependencies, network mutation or product shims.
function openChats() {
  if (window.__wos) window.__wos.openWin({ app: 'chats' });
  else if (window.__wux) window.__wux.openChatsList();
  else throw new Error('Troubleshooter QA: shell is not ready');
  const shell = window.__wos || window.__wux;
  const chats = Object.values(shell.wins).filter(w => w.app === 'chats');
  if (!chats.length) throw new Error('Troubleshooter QA: Chats did not open');
  return chats.map(w => w.id);
}
async function freshRead() {
  const live = window.WizLive;
  if (!live) throw new Error('Troubleshooter QA: live reader is not ready');
  // `ok` can be painted before refreshAgents finishes. refresh() coalesces with
  // that old read; drain it, then request a read under the current fault mode.
  await live.loading;
  await live.refresh();
  return { ok: live.ok, at: live.at, error: live.error, errorAt: live.errorAt, loading: !!live.loading };
}
function entrySnapshot() {
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { hidden: el.hidden, display: s.display, visibility: s.visibility, opacity: s.opacity, x: r.x, y: r.y, width: r.width, height: r.height, text: el.textContent }; };
  const shell = window.__wos || window.__wux, live = window.WizLive;
  return { route: location.pathname, shell: document.documentElement.dataset.shell, ready: !!shell, onlineHint: navigator.onLine, live: live && { ok: live.ok, at: live.at, error: live.error, errorAt: live.errorAt, loading: !!live.loading }, status: window.WizCore?.status?.state, statusLog: window.__statusLog, banner: rect(document.querySelector('#wxBanners')), pill: rect(document.querySelector('[data-wxoffopen]')), chatsButtons: [...document.querySelectorAll('[data-chtroubleshoot]')].map(rect), wins: shell && Object.values(shell.wins).map(w => ({ id: w.id, app: w.app, appId: w.appId })) };
}
module.exports = { openChats, freshRead, entrySnapshot };
