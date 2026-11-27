// owner-correction: humanitylabs-org/wizard-ux#1950 · 2026-11-27 · "there should be no number above the orb"
// With the four-section phone bar on (switch wizard/phone-sections) the orb carries no count badge, in every skin and with
// Robert's phone bar (wizard/phone-nav) on or off: the Chats and Messenger tiles already show the counts. With the bar
// off the orb badge works as before. The browser check is tests/qa-phone-sections.cjs (orbNum at Home, Chats, Messenger).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const deskbar = readFileSync(new URL('../web/app-deskbar.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/tweaks/wizard/phone-sections/tweak.css', import.meta.url), 'utf8');
const start = deskbar.indexOf('  function paintOrbBadge() {'), end = deskbar.indexOf("  addEventListener('wizard:app-counts'", start);
const body = deskbar.slice(start, end);

function orbBadge({ sections, nav = false, skin = 'nebula', onChatsDesk = true }) {
  const badge = { textContent: '', hidden: true };
  const tweaks = [sections && 'wizard/phone-sections', nav && 'wizard/phone-nav'].filter(Boolean).join(' ');
  const W = { c: { id: 'c', app: 'chats' } }, desks = [{ id: 'home', home: true, wins: [] }, { id: 'dc', wins: ['c'], focus: 'c' }];
  const ctx = {
    window: { WizCore: { workspaceNav: { deskCount: () => 12, fmt: n => String(n), label: () => '12', deskMore: () => false },
      // app-sections.js publishes this; on() is the switch on a phone.
      phoneSections: { on: () => sections } } },
    document: { documentElement: { getAttribute: k => k === 'data-tweaks' ? tweaks : null, dataset: { shell: 'phone', skin } } },
    $: s => (s === '#orbBadge' ? badge : null), appVars: { desks, W, idx: onChatsDesk ? 1 : 0 }, winApp: w => (w.app === 'chats' ? { id: 'wizard' } : null), CHATS_APP: { id: 'wizard' },
  };
  vm.createContext(ctx);
  vm.runInContext(body + '\npaintOrbBadge();', ctx);
  return badge.hidden ? '' : badge.textContent;
}

test('four-section bar on: no number on the orb, in every skin, with phone-nav on or off', () => {
  for (const skin of ['nebula', 'grove', 'tide', 'ember', 'signal', 'obsidian', 'obsidian-light', 'landscapes'])
    for (const nav of [false, true])
      for (const onChatsDesk of [false, true])
        assert.equal(orbBadge({ sections: true, nav, skin, onChatsDesk }), '', `${skin}, phone-nav ${nav ? 'on' : 'off'}, ${onChatsDesk ? 'Chats' : 'Home'}`);
});

test('four-section bar off: the orb badge is as before', () => {
  assert.equal(orbBadge({ sections: false }), '12');
  assert.equal(orbBadge({ sections: false, nav: true }), '12');
});

test('the bar\'s own CSS hides the orb badge too, so no skin rule can bring it back', () => {
  assert.match(css, /html\[data-tweaks~="wizard\/phone-sections"\]:not\(\[data-shell="desktop"\]\) #dock\[data-sections\] #orbBadge \{ display: none !important; \}/);
});
