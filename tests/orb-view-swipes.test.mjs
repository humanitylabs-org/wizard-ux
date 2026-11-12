// The dock orb's swipes per shell view (Miguel, 1 Nov 2026, round 6):
//   - Desks: the stock swipes, all of them (sideways = previous / next desk, up = the Desks panel / app picker,
//     down = James's distraction-free mode). A layout that declares nothing never changes them.
//   - Apps and Orb (phone): a swipe up on the orb = Home (the grid / the ring), like the iPhone's home swipe; sideways
//     and down do nothing (no desk steps, no distraction-free, no Desks panel from the orb). Declared by the layout
//     through the layout-only api.phone.swipes (chrome.js ORB_SWIPES), read by app.js as WosSkinHost.orbSwipes().
//   - Tap (talk / send) and hold (local command) are the same in all three views: they never ask the swipe map.
//   - No round Back button in any view (phone Orb, phone Apps, desktop Apps): Home is the swipe up (desktop also ⌥`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const app = read('web/app.js');

// app.js's own decision, run as written: 'stock' = the dock's own swipe, null = nothing, 'home' = Home.
const act = vm.runInNewContext(`(${app.match(/function orbSwipeAct\(g\) \{[\s\S]*?\n  \}/)[0]})`, {});
const ORB = { up: 'home', side: null, down: null };
test('per-view orb swipe map: Desks = every stock swipe; Apps / Orb = up Home, sideways and down nothing', () => {
  // Desks (no layout map): every swipe is the stock one, distraction-free included
  for (const g of [{ mode: 'h', dy: 0 }, { mode: 'v', dy: -90 }, { mode: 'v', dy: 30 }]) assert.equal(act({ ...g, swipes: null }), 'stock', JSON.stringify(g));
  // Apps / Orb
  assert.equal(act({ mode: 'h', dx: -80, dy: 4, swipes: ORB }), null, 'sideways: no desk step');
  assert.equal(act({ mode: 'v', dy: -90, swipes: ORB }), 'home', 'up: Home');
  assert.equal(act({ mode: 'v', dy: 30, swipes: ORB }), null, 'down: no distraction-free');
  // a map that leaves a key out keeps that stock swipe
  assert.equal(act({ mode: 'v', dy: 30, swipes: { up: 'home' } }), 'stock');
  // tap and hold never ask the map
  for (const mode of ['pending', 'hold', 'still']) assert.equal(act({ mode, dy: -90, swipes: ORB }), 'stock', mode);
});

test('app.js: the layout swipe runs before every stock swipe branch, and the stock branches are untouched', () => {
  const end = app.slice(app.indexOf('function endGesture(e, cancelled)'), app.indexOf("orbWrap.addEventListener('pointerup', e => endGesture(e, false));"));
  const own = end.indexOf("const own = orbSwipeAct(g);");
  assert.ok(own > 0 && own < end.indexOf('if (g.upDesks && g.mode === \'v\' && !sheet)') && own < end.indexOf("if (g.mode === 'pending' && !cancelled)"), 'before the Desks panel and every stock branch');
  assert.match(end, /if \(own !== 'stock'\) \{ if \(\(own === 'home' \|\| own === 'new'\) && !cancelled && \(g\.dy < -70 \|\| g\.dy \/ vt < -\.55\)\) \{ if \(own === 'new'\) orbSwipeNew\(\); else orbSwipeHome\(\); \} return; \}/);
  // Desks keeps: sideways = swipeDesk, up = launcher / Desks panel, down = distraction-free
  assert.match(end, /if \(g\.dx < -60 \|\| v < -\.5\) \{ swipeDesk\(1\);/);
  assert.match(end, /if \(g\.dy < -70 \|\| v < -\.55\) openSheet\('launcher'\);\n\s+else if \(!cancelled && V\.state === 'idle' && \(g\.dy > 18 \|\| \(g\.dy > 8 && v > \.3\)\)\) setZen\(true\);/);
  assert.match(end, /g\.upDesks && g\.mode === 'v' && !sheet\) \{ if \(g\.dy < -70 \|\| g\.dy \/ vt < -\.55\) openOverview\('pill'\); else if \(!cancelled && V\.state === 'idle' && \(g\.dy > 18 \|\| \(g\.dy > 8 && g\.dy \/ vt > \.3\)\)\) setZen\(true\); return; \}/);
  // while moving: nothing follows the finger for a layout's own swipe (no track slide, no launcher, no dock nudge)
  const move = app.slice(app.indexOf("orbWrap.addEventListener('pointermove'"), app.indexOf('function orbTapBusy()'));
  const early = move.indexOf("if (G.swipes && orbSwipeAct(G) !== 'stock')");
  assert.ok(early > 0 && early < move.indexOf("if (G.mode === 'h' && sheet === 'settings') liftSettings();") && early < move.indexOf('placeTrack(dx * 1.1, false)') && early < move.indexOf("openOverview('pill')"));
  assert.match(app, /G\.upDesks = orbUpDesks\(\); G\.swipes = window\.WosSkinHost\?\.orbSwipes\?\.\(\) \|\| null;/, 'read once per press');
  assert.match(move, /G\.corner && !G\.swipes\) \{ clearTimeout\(G\.hold\); G\.mode = 'still'; \}/, 'the Chats corner orb keeps its stock rule in Desks');
  // Home from the orb: Home desk, sheets closed, and the iPhone swipe-home undo still applies
  const home = app.match(/function orbSwipeHome\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(home, /if \(idx !== HOME\) goDesk\(HOME\);/); assert.match(home, /lastMove = \{ from, at: Date\.now\(\) \}/);
});

test('tap and hold are identical in all three views: the press, tap and hold paths never read the swipe map', () => {
  const down = app.slice(app.indexOf("orbWrap.addEventListener('pointerdown', e => {\n    if (G || e.isPrimary === false) return;"), app.indexOf('// Slide-to-aim is retired'));
  assert.match(down, /if \(mayHoldCommand\(\)\) G\.hold = setTimeout\(\(\) => \{ if \(G && G\.mode === 'pending'\) \{ G\.mode = 'hold';[^\n]*\}, 380\);/);
  const end = app.slice(app.indexOf("if (g.mode === 'pending' && !cancelled) {"), app.indexOf("} else if (g.mode === 'h') {"));
  assert.ok(!/swipes|orbSwipe/.test(end), 'tap / hold branches are the stock ones');
  assert.match(end, /if \(V\.state === 'idle'\) return window\.WosSkinHost\?\.orbTap\?\.\(\) \? undefined : startOrbVoice\(\);/);
});

test('skin-host: the orb swipe map stays generic (no view names in core); the shared chrome declares the dock swipes on the phone only', () => {
  // The phone Apps and Orb views that wore a swipe map went in wizard-ux issue 1338; the generic api.phone.swipes stays.
  const host = read('web/core/skin-host.js');
  assert.ok(!/miguel|orb-shell|apps-home/.test(host.slice(host.indexOf('function orbSwipeMap'), host.indexOf('function orbSwipeMap') + 400)), 'core stays generic');
  // the desktop Apps orb is the layout's own button: chrome.js only declares the dock swipes on the phone
  assert.match(read('web/layouts/apps/chrome.js'), /const offSwipes = shell === 'phone' && api\.phone\?\.swipes \? api\.phone\.swipes\(swipes \|\| ORB_SWIPES\) : null;/, 'the views\' swipes, or a view\'s own (AI apps: up = a New chat to type in)');
});

test('no round Back button in the shared view chrome; its orb swipes: up = Home, sideways and down nothing', async () => {
  const files = ['web/layouts/apps/chrome.js', 'web/layouts/apps/chrome.css'];
  for (const f of files) assert.ok(!/vc-back|paintBack|chrome\.back/.test(read(f)), `${f}: Back is gone`);
  const { ORB_SWIPES } = await import(new URL('web/layouts/apps/chrome.js', root));
  assert.deepEqual({ ...ORB_SWIPES }, ORB);
  for (const f of files.filter(f => f.endsWith('.js'))) assert.ok(!/Math\.random/.test(read(f)), f);
});
