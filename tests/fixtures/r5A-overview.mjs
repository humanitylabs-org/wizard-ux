// The phone's real Desks overview (web/app-overview.js, appParts.overview) with the real desk cards and the download
// button (ovCard, ovDeskApp, ovDl, arrangeDesks from web/app.js), on a mini-dom page. Fingers are fake touches: the
// hold timer runs when the test says so, and elementFromPoint answers with the card under the finger.
import { readFileSync } from 'node:fs';
import { withAppParts } from './app-parts.mjs';
import { partScope, runPartRecording } from './r5A-parts.mjs';
import { block, runRecording } from './source-slice.mjs';

let appSrc;
const app = () => (appSrc ??= withAppParts(readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8')));

export async function overview({ mode = {}, desks, W, APP, canOffer = () => true } = {}) {
  const ctx = partScope(); const doc = ctx.document;
  const offers = [], timers = [];
  ctx.setTimeout = fn => { timers.push(fn); return timers.length; }; ctx.clearTimeout = id => { if (id) timers[id - 1] = null; };
  ctx.WizHomeScreenApps = { offer: a => offers.push(a.id), canOffer };
  const device = doc.createElement('div'); doc.body.append(device);
  const proto = Object.getPrototypeOf(doc.body);
  proto.cloneNode ||= function () { const n = doc.createElement(this.localName); for (const [k, v] of this.attrs) n.setAttribute(k, v); n.innerHTML = this.innerHTML; return n; };
  const appVars = { desks, W, idx: 0, OV: null, ovTapBlock: 0, ovEl: null, LINKS: null };
  const overviewMode = () => mode;
  // The real card builders from app.js, run on this page's desks.
  const src = app();
  const cards = runRecording([block(src, '  function ovDeskApp(d) {'), block(src, '  function ovDl(d) {'), block(src, '  function ovCard(i) {'),
    src.split('\n').find(l => l.startsWith('  const arrangeDesks = '))].join('\n') + '\nthis.ovDeskApp = ovDeskApp; this.ovDl = ovDl; this.ovCard = ovCard; this.arrangeDesks = arrangeDesks;', {
    desks, W, APP, idx: 0, esc: String, overviewMode, window: ctx, isReviewDesk: () => false, deskName: i => 'Desk ' + (i + 1),
    winApp: w => APP[w.appId] || { id: w.app, name: w.app }, winTitle: w => (APP[w.appId] || {}).name || w.app, ovMark: () => ({ color: '#fff', glyph: '' }) });
  const { out, calls } = await runPartRecording('app-overview.js', 'appParts', 'overview', {
    appVars, device, APP, $: () => doc.createElement('div'), esc: String, overviewMode, ovCard: cards.ovCard, ovDeskApp: cards.ovDeskApp, ovDl: cards.ovDl, arrangeDesks: cards.arrangeDesks,
    deskName: i => 'Desk ' + (i + 1), deskSigil: () => '', closeSheets: () => {}, announce: () => {} }, ctx);
  out.bindLate({ orbUpVar: () => '', armBack: () => {}, newDesk: () => {}, toast: () => {} });
  try { out.openOverview('grid'); } catch (e) { /* the opening animation reads layout the mini page does not have */ if (!appVars.ovEl) throw e; }
  const el = appVars.ovEl;
  let under = null;
  doc.elementFromPoint = () => under;
  const card = id => el.querySelector(`.ov-card[data-ov="${id}"]`);
  const touch = (type, target, x, y) => target.dispatchEvent({ type, touches: type === 'touchend' ? [] : [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }], bubbles: true, cancelable: true, preventDefault() {}, stopPropagation() {} });
  return {
    doc, el, appVars, offers, calls, card, cards, out,
    order: () => el.querySelectorAll('.ov-grid .ov-card[data-ov]').map(c => c.dataset.ov),
    // hold a card still past the hold delay; `to`: drag onto another card before letting go
    hold(id, to) {
      const c = card(id); under = c; touch('touchstart', c, 50, 50);
      for (const t of timers.splice(0)) t?.();
      if (to) { under = card(to); touch('touchmove', c, 150, 50); }
      touch('touchend', c, to ? 150 : 50, 50);
    },
    tap(sel) { el.querySelector(sel).click(); },
  };
}
