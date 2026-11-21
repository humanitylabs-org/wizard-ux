/* Wizard UX desktop shell › the top bar's New voice chat button. Moved verbatim out of desktop/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after
 * it declares them, before anything here can run. Loaded just before desktop/desktop.js. The body below keeps
 * desktop.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.generalvoice = function ({ mic, MOD, store, talkNew }) {
  const generalVoice = document.createElement('button');
  generalVoice.id = 'generalVoice'; generalVoice.className = 'general-voice';
  const paintGeneralVoice = () => { const l = 'New voice chat; shares nothing from this screen (⌥V)'; generalVoice.className = 'mic general-voice-ic'; generalVoice.innerHTML = '<svg viewBox="0 0 24 24"><path d="M10 13a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3Zm-5.5-3a5.5 5.5 0 0 0 11 0M10 15.5V19M19 4v6M16 7h6"/></svg>'; generalVoice.setAttribute('aria-label', l); generalVoice.title = l; };
  paintGeneralVoice(); window.addEventListener('wizard:config', paintGeneralVoice);
  mic.insertAdjacentElement('afterend', generalVoice);
  generalVoice.addEventListener('click', () => talkNew('Tap to send'));
  /* One mic in the bar: click talks about this; right-click or hold shows every voice action. The other three buttons
   * stay in the DOM (their keys ⌥V ⌥D ⌥C and the keys guide keep working), folded out of the bar. */
  const voiceMenu = document.createElement('div'); voiceMenu.className = 'voice-menu'; voiceMenu.setAttribute('role', 'menu'); voiceMenu.hidden = true;
  voiceMenu.innerHTML = [['micBtn', 'Talk about this', `${MOD}S`], ['generalVoice', 'New voice chat', `${MOD}V`], ['dictateBtn', 'Dictate here', `${MOD}D`], ['commandBtn', 'Tell the computer', `${MOD}C`]]
    .map(([id, t, k]) => `<button type="button" role="menuitem" data-voice-go="${id}"><span>${t}</span><kbd>${k}</kbd></button>`).join('');
  document.body.appendChild(voiceMenu);
  /* James, 31 Oct 2026: the bar keeps one mic by default (fewer icons on the right). Nothing replaces the three folded
   * buttons; the mic's menu and their keys reach them, and Settings › Voice & typing can put them back in the bar. */
  const allMics = () => store.get('allMics', false) === true;
  const paintMics = () => document.documentElement.classList.toggle('one-mic', !allMics());
  paintMics();
  return { allMics, paintMics, voiceMenu };
};
