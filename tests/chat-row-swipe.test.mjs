import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const js = read('web/core/chats.js');
const coreCss = read('web/core/chats.css');
const noirCss = read('web/skins/novairecito/skin.css');
const sepiaCss = read('web/skins/sepia/skin.css');

test('row action swipe is limited to Novairecito phone palettes', () => {
  assert.match(js, /dataset\.shell === 'phone'[\s\S]{0,140}\['novairecito', 'sepia'\]/);
  assert.match(noirCss, /html\[data-skin="novairecito"\]\[data-shell="phone"\].*\.ch-swipe-acts/s);
  assert.match(sepiaCss, /html\[data-skin="sepia"\]\[data-shell="phone"\].*\.ch-swipe-acts/s);
  assert.doesNotMatch(coreCss, /\.ch-swipe-acts/);
});

test('every swipe only reveals explicit accessible actions', () => {
  assert.match(js, /data-chswipe="\$\{k\}"/);
  assert.match(js, /tray\.setAttribute\('aria-hidden', open \? 'false' : 'true'\)/);
  assert.match(js, /b\.tabIndex = open \? 0 : -1/);
  assert.match(js, /q\.dx < -SWIPE_W \* 0\.4[\s\S]{0,350}swipeA11y\(q\.wrap, true\)/);
  assert.doesNotMatch(js, /q\.dx < -w \* 0\.5[\s\S]{0,250}threadAct/);
  assert.doesNotMatch(noirCss + sepiaCss, /\.ch-row-wrap\.commit/);
});

test('cancel, scroll, outside tap and Back close without invoking an action', () => {
  const cancel = js.match(/const lpCancel = \(\) => \{([\s\S]*?)\n    \};/);
  assert.ok(cancel, 'pointercancel handler exists');
  assert.doesNotMatch(cancel[1], /threadAct|BOOM\?*\.open/);
  assert.match(js, /pointercancel', lpCancel/);
  assert.match(js, /addEventListener\('scroll'[\s\S]{0,180}closeSwipe\(true\)/);
  assert.match(js, /if \(swipeOpen\) \{ closeSwipe\(\); if \(e\.target\.closest\('\.ch-list'\)\) return true; \}/);
  assert.match(js, /const closeOverlay = \(\) => \(closeSwipe\(\) \? 'row-swipe'/);
});

test('open swipe holds list repaints while stock and desktop gestures remain', () => {
  assert.match(js, /swipeOpen\.wid === id && swipeOpen\.wrap\.isConnected/);
  assert.match(js, /if \(!q\.swipe\)[\s\S]{0,500}q\.row\.dataset\.quiet === '1'[\s\S]{0,220}openRowSheet/);
  assert.match(js, /e\.pointerType !== 'mouse' && ownerSwipe\(\)/);
});
