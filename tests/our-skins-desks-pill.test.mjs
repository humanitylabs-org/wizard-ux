import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { orbSwipe, orbUp } from './fixtures/r5A-orbswipe.mjs';
import { partScope, runPartRecording } from './fixtures/r5A-parts.mjs';
const web = new URL('../web/', import.meta.url);
const read = f => withShellParts(readFileSync(new URL(f, web), 'utf8'));

// static-rule: whole-stylesheet lint: the pill Desks panel classes appear only in skin-scoped skin CSS, never in core CSS
test('the pill Desks panel is never core CSS; skin rules that paint it stay skin-scoped', () => {
  for (const [dir, pre] of [['obsidian', 'html[data-skin^="obsidian"]'], ['landscapes', 'html[data-skin^="landscapes"]']]) {
    const css = read(`skins/${dir}/skin.css`);
    for (const line of css.split('\n').filter(l => /\.ov[-.\s]/.test(l) && /ov-(pill|badge|cell|close|ic|nm|sheet|scroll)/.test(l))) {
      assert.ok(line.startsWith(pre) || line.startsWith('html[data-skin="obsidian-light"]') || line.startsWith('@keyframes') || /^\s|^\/\*| \*/.test(line), line.slice(0, 100));
    }
  }
  for (const f of readdirSync(new URL('core/', web)).filter(f => f.endsWith('.css')).map(f => `core/${f}`).concat(['styles.css'])) {
    const src = read(f);
    for (const k of ['ov-pill', 'ov-badge', 'ov-cell', 'ov-close']) assert.ok(!src.includes(k), `${f} must not carry ${k} (skin-only)`);
  }
});

test('no skin forces the pill desks panel or per-desk badges; the orb swipe-up still opens it when asked', () => {
  const js = read('app.js');
  assert.doesNotMatch(js, /oursSkin|ov-badge/);
  // The real orb gestures: no skin choice, a swipe up never opens Desks.
  const stock = orbSwipe({ upValue: '' }); stock.drag(-120);
  assert.deepEqual(stock.opened(), [], 'no skin forces the desks panel');
  // Asked for (--wos-orb-swipe-up: desks): up grows the pill into the panel, once, mid-swipe.
  const asked = orbSwipe({ upValue: 'desks' }); asked.drag(-120, 400, [-20, -60, -120]);
  assert.deepEqual(asked.opened(), ['pill']);
  const mid = orbSwipe({ upValue: 'desks' }); mid.down(); mid.move(-20); mid.move(-60);
  assert.deepEqual(mid.opened(), ['pill'], 'opens mid-swipe, before the finger lifts');
  mid.up(-60); assert.deepEqual(mid.opened(), ['pill'], 'and only once');
  // A short fast flick opens it on release.
  const flick = orbSwipe({ upValue: 'desks' }); flick.drag(-30, 30, [-16, -30]);
  assert.deepEqual(flick.opened(), ['pill']);
  // A slow short drag does not; an open sheet keeps the swipe.
  const slow = orbSwipe({ upValue: 'desks' }); slow.drag(-30, 2000, [-16, -30]); assert.deepEqual(slow.opened(), []);
  const sheet = orbSwipe({ upValue: 'desks', sheet: 'settings' }); sheet.drag(-120); assert.deepEqual(sheet.opened(), []);
});

test('any skin (or My skin) can send the orb swipe-up to Desks with --wos-orb-swipe-up: desks', async () => {
  // The real lines that read the skin's choice from the computed style.
  const u = orbUp(' desks '); assert.equal(u.orbUpDesks(), true); assert.deepEqual(u.seen, ['--wos-orb-swipe-up']);
  assert.equal(orbUp('pill').orbUpDesks(), true);
  assert.equal(orbUp('').orbUpDesks(), false); assert.equal(orbUp('home').orbUpDesks(), false);
  // The real openOverview: only 'pill' grows the panel out of the pill; 'desks' opens the plain overview.
  const open = async value => {
    const ctx = partScope(); const device = ctx.document.createElement('div'); ctx.document.body.append(device);
    const appVars = { ovEl: null, desks: [{ wins: [] }], idx: 0, LINKS: null };
    const { out } = await runPartRecording('app-overview.js', 'appParts', 'overview', { appVars, device, $: () => ctx.document.createElement('div') }, ctx);
    out.bindLate({ orbUpVar: orbUp(value).orbUpVar, armBack: () => {}, newDesk: () => {}, toast: () => {} });
    try { out.openOverview('pill'); } catch (e) { if (!/length|undefined/.test(e.message)) throw e; } // the desk list painting past the class toggle needs a full shell
    return [appVars.ovEl.classList.contains('ov-pill'), device.classList.contains('ov-pill-open')];
  };
  assert.deepEqual(await open('pill'), [true, true]);
  assert.deepEqual(await open('desks'), [false, false]);
});
