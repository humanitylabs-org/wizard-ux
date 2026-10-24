/* My release flag (wizard-os#186). This branch is the owner's own release: his behaviour and layout apply on every
 * skin, so switching skins only changes the look. Loaded first in <head> (phone and desktop) so html[data-mine]
 * is there for the first paint of web/mine/mine.css and for every core check (`dataset.mine != null`).
 * ?mine=off skips the layer for one load (stock behaviour on the picked skin), for comparing. */
(function () {
  'use strict';
  let off = false;
  try { off = new URLSearchParams(location.search).get('mine') === 'off'; } catch (_) {}
  if (!off) document.documentElement.dataset.mine = '';
  window.WosMine = Object.freeze({ on: () => document.documentElement.dataset.mine != null });
})();
