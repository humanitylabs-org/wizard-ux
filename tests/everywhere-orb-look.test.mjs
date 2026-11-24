// wizard-os#649: the floating Wizard Everywhere orb wears the look of the app's own orb: the skin's orb colour and,
// in James's five skins, the white icon in place of the centre dot and the top-left shine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

function runDeviceOrb({ skin = 'nebula', filter = '', native = true } = {}) {
  const sent = [], listeners = {}, docListeners = {};
  const style = { getPropertyValue: k => (k === '--sk-orb' ? filter : '') };
  const s = {
    console, setTimeout: f => f(),
    document: { readyState: 'complete', hidden: false, documentElement: { dataset: { skin }, style },
      addEventListener: (t, f) => { docListeners[t] = f; } },
    addEventListener: (t, f) => { listeners[t] = f; },
    WosSkin: { get current() { return skin; } },
  };
  s.window = s;
  if (native) s.WizardOSNative = { everywhereLook: (a, b) => sent.push([a, b]) };
  vm.runInNewContext(read('web/core/device-orb.js'), s);
  return { sent, setSkin(id, f) { skin = id; filter = f; listeners['wos:skin']?.(); },
    leave() { s.document.hidden = true; docListeners.visibilitychange?.(); } };
}

test('the app tells the floating orb its skin at start and on every skin change', () => {
  const h = runDeviceOrb();
  assert.deepEqual(h.sent, [['nebula', '']]);
  h.setSkin('ember', 'hue-rotate(115.0deg) saturate(1.150) brightness(1.050)');
  assert.deepEqual(h.sent.at(-1), ['ember', 'hue-rotate(115.0deg) saturate(1.150) brightness(1.050)']);
  h.leave();
  assert.equal(h.sent.length, 3, 'leaving the app re-sends the look (native ignores a repeat)');
});

test('an older APK without everywhereLook is left alone', () => {
  assert.doesNotThrow(() => runDeviceOrb({ native: false }));
});

for (const [page, script] of [
  ['android/app/src/main/assets/assist/everywhere.html', 'android/app/src/main/assets/assist/everywhere.html'],
  ['web/assist/everywhere.html', 'web/assist/everywhere.js'],
]) {
  test(`${page} draws the modern app orb by default and takes the skin from E.look`, () => {
    const html = read(page), js = read(script);
    assert.match(html, /<html lang="en" data-skin="nebula">/, 'Nebula, the default skin, before native says otherwise');
    // orb.js drops the centre dot and the shine when an .orb-app icon sits beside the #orb canvas in James's skins.
    const box = html.slice(html.indexOf('<div id="orbBox">'), html.indexOf('</div>', html.indexOf('<div id="orbBox">')));
    assert.match(box, /<canvas id="orb"/);
    assert.match(box, /<span class="orb-app"[^>]*><svg/);
    assert.match(html, /#orb,#orbFallback,#orbDisc\{filter:var\(--sk-orb,none\)\}/);
    for (const id of ['nebula', 'grove', 'tide', 'ember', 'signal']) assert.ok(html.includes(`[data-skin="${id}"]`), id);
    assert.match(html, /body:is\(\.live,\.busy\) \.orb-app\{display:none\}/, 'while talking the icon steps aside, as in the app');

    const root = { dataset: { skin: 'nebula' }, style: { props: {}, setProperty(k, v) { this.props[k] = v; } } };
    const code = js.slice(js.indexOf('  look(o) {'), js.indexOf('  level(v) {'));
    const E = vm.runInNewContext(`({${code}})`, { document: { documentElement: root } });
    E.look({ skin: 'ember', filter: 'hue-rotate(115.0deg) saturate(1.150) brightness(1.050)' });
    assert.equal(root.dataset.skin, 'ember');
    assert.equal(root.style.props['--sk-orb'], 'hue-rotate(115.0deg) saturate(1.150) brightness(1.050)');
    E.look({ skin: 'x" onload="', filter: 'url(javascript:1)' });
    assert.equal(root.dataset.skin, 'ember', 'a bad skin id is ignored');
    assert.equal(root.style.props['--sk-orb'], 'none', 'a bad filter is dropped');
  });
}

test('native keeps and replays the look, and checks it before it reaches the page', () => {
  const svc = read('android/app/src/main/java/ai/wizards/os/everywhere/EverywhereService.java');
  assert.match(svc, /public static void setLook\(Context c, String skin, String filter\)/);
  assert.match(svc, /EverywherePolicy\.look\(skin, filter\)/);
  assert.match(svc, /pageReady = true; place\(\); pushLook\(\);/, 'every page load gets the saved look');
  const main = read('android/app/src/main/java/ai/wizards/os/MainActivity.java');
  assert.match(main, /public void everywhereLook\(String skin, String filter\)/);
});

// wizard-ux issue 1706: on James's phone the floating orb kept only its white icon, with no disc behind it.
for (const [page, pic] of [
  ['android/app/src/main/assets/assist/everywhere.html', 'robert-thread-orb.png'],
  ['web/assist/everywhere.html', '../robert-thread-orb.png'],
]) {
  test(`${page} always has a skin-coloured disc under the canvas, independent of WebGL`, () => {
    const html = read(page);
    const box = html.slice(html.indexOf('<div id="orbBox">'));
    assert.ok(box.indexOf('<span id="orbDisc"') >= 0 && box.indexOf('<span id="orbDisc"') < box.indexOf('<canvas id="orb"'),
      'the disc is painted first, so the live canvas covers it when it draws');
    const rule = html.match(/#orbDisc\{([^}]*)\}/)[1];
    assert.ok(rule.includes(`url(${pic})`), 'the picture orb, from a path that exists for this page');
    assert.ok(!/mask|hidden|display:none/.test(rule), 'no mask and nothing that hides it');
    assert.match(rule, /border-radius:50%/);
  });
}

test('orb.js shows the picture orb when the GPU context is gone without an event, and keeps fallback paths beside the page picture', () => {
  for (const f of ['web/orb.js', 'android/app/src/main/assets/assist/orb.js']) {
    const js = read(f);
    assert.ok(js.includes('if (gl && gl.isContextLost?.() === true) { showFallback(); return; }'), f);
    assert.match(js, /new URL\(pic, fallback\.getAttribute\('src'\) \? fallback\.src : document\.baseURI\)/, f);
  }
});
