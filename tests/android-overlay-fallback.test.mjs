// The Android overlay pages (side-button orb, floating orb, screen mode) load from the Wizard's web shell
// (web/assist/, served at <origin>/wizard-os-home/assist/). The APK keeps a copy as the offline fallback in
// android/app/src/main/assets/wizard-os-home/, laid out like web/. That copy must match web/ byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const bundle = join(root, 'android/app/src/main/assets/wizard-os-home');
const files = dir => readdirSync(dir).flatMap(n => statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]);
const bundled = files(bundle).map(f => relative(bundle, f)).sort();

test('every bundled overlay file is the web shell file, byte for byte', () => {
  for (const f of bundled) {
    assert.ok(readFileSync(join(bundle, f)).equals(readFileSync(join(root, 'web', f))),
      `${f} differs: copy web/${f} to android/app/src/main/assets/wizard-os-home/${f}`);
  }
});

test('the bundle holds all of web/assist and the shared files the pages load', () => {
  const assist = readdirSync(join(root, 'web/assist')).map(n => 'assist/' + n);
  const pages = assist.filter(f => f.endsWith('.html'));
  assert.deepEqual(pages.sort(), ['assist/everywhere.html', 'assist/screen.html', 'assist/surface.html']);
  const needed = new Set(assist);
  for (const p of pages) {
    const html = readFileSync(join(root, 'web', p), 'utf8');
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) needed.add(join('assist', ref));
  }
  needed.add('robert-listening-galaxy.png'); // orb.js swaps the fallback image beside robert-thread-orb.png
  for (const f of needed) assert.ok(bundled.includes(f), `missing from the APK fallback: ${f}`);
  assert.deepEqual(bundled, [...needed].sort(), 'the APK fallback holds only what the overlay pages load');
});

test('overlay pages run under the shell CSP: no inline script, nothing off-origin', () => {
  for (const p of ['everywhere', 'screen', 'surface']) {
    const html = readFileSync(join(root, 'web/assist', p + '.html'), 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${p}.html: inline <script> is blocked by script-src 'self'`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${p}.html: inline handlers are blocked by script-src 'self'`);
    assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\//, `${p}.html: overlay pages load only from the shell`);
  }
});

test('bundled asset documents embed the native CSP before any executable markup', () => {
  const java = readFileSync(join(root, 'android/app/src/main/java/ai/wizards/os/OverlayPolicy.java'), 'utf8');
  const csp = java.match(/static final String CSP = ([\s\S]*?);\n/)[1].match(/"[^"\n]*"/g).map(s => JSON.parse(s)).join('');
  for (const p of ['surface', 'everywhere', 'screen']) {
    const html = readFileSync(join(bundle, 'assist', p + '.html'), 'utf8');
    assert.equal(html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1], csp);
    assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf('<script'));
  }
});

test('recovered native hosts replay the active recording and screen snapshot', () => {
  const screen = readFileSync(join(root, 'android/app/src/main/java/ai/wizards/os/everywhere/ScreenMode.java'), 'utf8');
  assert.match(screen, /protected void ready[\s\S]*?sent = false;[\s\S]*?sendOpen\(\)/);
  const side = readFileSync(join(root, 'android/app/src/main/java/ai/wizards/os/assist/WizardSession.java'), 'utf8');
  assert.match(side, /else if \(capture.listening\(\)\)/);
  assert.ok(side.includes('W.begin();W.onPaused('));
  assert.ok(side.includes("W.onSending('recovery')"));
});

test('real native hosts retain the production deadline and bundled-only lock policy', () => {
  const java = readFileSync(join(root, 'android/app/src/main/java/ai/wizards/os/OverlayPage.java'), 'utf8');
  assert.match(java, /TIMEOUT_MS = 1500/);
  assert.match(java, /public OverlayPage\(String page, boolean remoteFirst\) \{ this\(page, remoteFirst, TIMEOUT_MS\); \}/);
  for (const [file, page, remote] of [
    ['assist/AssistLockActivity.java', 'surface.html', false],
    ['assist/WizardSession.java', 'surface.html#corner', true],
    ['everywhere/EverywhereService.java', 'everywhere.html', true],
    ['everywhere/ScreenMode.java', 'screen.html', true],
  ]) {
    const source = readFileSync(join(root, 'android/app/src/main/java/ai/wizards/os', file), 'utf8');
    assert.ok(source.includes(`new OverlayPage("${page}", ${remote})`), `${file}: must use production constructor, not fixture timing`);
  }
});
