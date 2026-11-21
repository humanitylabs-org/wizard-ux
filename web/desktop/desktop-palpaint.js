/* Wizard UX desktop shell › painting the command palette and the agent name labels. Moved out of desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names desktop.js declares only further down are late-bound: desktop.js hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the window list W and the workspaces) stay in desktop.js;
 * this code reads and writes them as desktopVars.<name>, desktop.js's get/set accessors on the same variables, so every
 * read and write is live. Loaded just before desktop.js. The body below keeps desktop.js's indentation so `git log -L` and
 * patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.palpaint = function ({ $, APP, closeCurrent, desktopVars, dictate, flipLight, goHome, hudKey, jumpBack, MOD, newChat, newDesktop, openApp, openChatsList, pal, palCard, palIn, palList, reloadCurrent, reopenClosed, resizeFocused, stepDesk, stepWin, talk, toggleMono }) {
  let chanPost, openFiles, openPicker, openSettings, openUsage, talkNew, toggleKeys; // late-bound: desktop.js declares these after the call, see bindLate
  // The agent's name comes from WizardOS settings; keep static labels in step with it.
  function palPaint() {
    const apps = desktopVars.palMode === 'apps';
    pal.dataset.mode = desktopVars.palMode;
    palCard.setAttribute('aria-label', apps ? 'Open an app' : 'Search and launch');
    palList.setAttribute('aria-label', apps ? 'Apps' : 'Results');
    palIn.placeholder = apps ? 'Search apps' : `Open an app, find a thread, or ask ${window.WizConfig.agent()}…`;
    palIn.setAttribute('aria-label', apps ? 'Search apps' : `Search apps, threads and commands, or ask ${window.WizConfig.agent()}`);
  }
  const nameLabels = () => {
    palPaint();
    document.querySelectorAll('[data-agent-name]').forEach(el => { el.textContent = window.WizConfig.agent(); });
  };
  nameLabels(); window.addEventListener('wizard:config', nameLabels);
  function commands() {
    return [
      { kind: 'cmd', name: 'Home', icon: '⌂', keys: `${MOD}\``, run: () => goHome() },
      { kind: 'cmd', name: 'Open an app', icon: '▦', keys: `${MOD}O`, run: () => openPicker() },
      ...(window.WosResources ? [{ kind: 'cmd', name: 'Resources', icon: '◔', run: () => { goHome(); $('#desktopHome [data-res-open="server"]')?.click(); } }] : []),
      { kind: 'cmd', name: 'Get apps', icon: '+', run: () => openApp(APP['app-store']) },
      { kind: 'cmd', name: 'New desktop', icon: '+', keys: `${MOD}T`, run: () => newDesktop() },
      { kind: 'cmd', name: 'Next window', icon: '→', keys: `${MOD}]`, run: () => stepWin(1) },
      { kind: 'cmd', name: 'Previous window', icon: '←', keys: `${MOD}[`, run: () => stepWin(-1) },
      { kind: 'cmd', name: 'Next desktop', icon: '→', run: () => stepDesk(1) },
      { kind: 'cmd', name: 'Previous desktop', icon: '←', run: () => stepDesk(-1) },
      { kind: 'cmd', name: 'New chat', icon: '✎', keys: `${MOD}N`, run: () => chanPost() || newChat() },
      { kind: 'cmd', name: 'Wider window', icon: '⇔', keys: `${MOD}=`, run: () => resizeFocused(1) },
      { kind: 'cmd', name: 'Narrower window', icon: '⇔', keys: `${MOD}−`, run: () => resizeFocused(-1) },
      { kind: 'cmd', name: 'Reopen closed window', icon: '↺', keys: `${MOD}⇧W`, run: () => reopenClosed() },
      { kind: 'cmd', name: 'Back to where you were', icon: '↩', keys: `${MOD}Z`, run: () => jumpBack() },
      { kind: 'cmd', name: 'Dark / Light', icon: '◐', keys: `${MOD}L`, run: () => flipLight() },
      { kind: 'cmd', name: 'New voice chat', icon: '🎙', keys: `${MOD}V`, run: () => talkNew() },
      { kind: 'cmd', name: `Talk to ${window.WizConfig.agent()}`, icon: '🎙', keys: 'Right ⌘', run: () => talk() },
      { kind: 'cmd', name: 'Dictate', icon: '✎', keys: 'Right ⌥', run: () => dictate() },
      { kind: 'cmd', name: 'Chats', icon: '⬇', keys: `${MOD}I`, run: () => openChatsList() },
      ...(window.WosFiles ? [{ kind: 'cmd', name: 'Files', icon: '▤', run: () => openFiles() }] : []),
      ...(window.WosUsage ? [{ kind: 'cmd', name: 'AI usage', icon: '◔', run: () => openUsage() }] : []),
      { kind: 'cmd', name: 'Close app / empty desktop', icon: '✕', keys: `${MOD}W`, run: () => closeCurrent() },
      { kind: 'cmd', name: desktopVars.hud ? 'Chat back to desktop 1' : 'Float chat over every desk', icon: desktopVars.hud ? '1' : '◉', keys: `${MOD}P`, run: () => hudKey() },
      { kind: 'cmd', name: 'Full screen', icon: '⤢', keys: `${MOD}F`, run: () => toggleMono() },
      { kind: 'cmd', name: 'Refresh window', icon: '↻', keys: `${MOD}R`, run: () => reloadCurrent() },
      { kind: 'cmd', name: 'Keys guide', icon: '⌨', keys: `${MOD}/`, run: () => toggleKeys(true) },
      { kind: 'cmd', name: 'Settings', icon: '⚙', keys: `${MOD},`, run: () => openSettings() },
      { kind: 'cmd', name: 'Use the phone layout here', icon: '📱', run: () => { location.href = './?shell=phone'; } },
      { kind: 'cmd', name: 'Reset desktop layout', icon: '↺', run: () => { Object.keys(localStorage).filter(k => k.startsWith('wux.desk.')).forEach(k => localStorage.removeItem(k)); location.reload(); } },
    ];
  }
  return { commands, palPaint, bindLate: v => { if ('chanPost' in v) chanPost = v.chanPost; if ('openFiles' in v) openFiles = v.openFiles; if ('openPicker' in v) openPicker = v.openPicker; if ('openSettings' in v) openSettings = v.openSettings; if ('openUsage' in v) openUsage = v.openUsage; if ('talkNew' in v) talkNew = v.talkNew; if ('toggleKeys' in v) toggleKeys = v.toggleKeys; } };
};
