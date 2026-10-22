import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Samsung capture and diagnostics use the runtime-selected Wizard origin', () => {
  const base = 'android/app/src/main/java/ai/wizards/os/';
  for (const name of ['ChatScrollCapture.java', 'SelectionWebView.java', 'ScrollCaptureDiagnostics.java']) {
    const text = read(base + name);
    assert.doesNotMatch(text, /Origin\.isPrivate\(u\)/, name);
    assert.match(text, /Origin\.isPrivate\((?:activity|c), u\)/, name);
  }
});

test('unconfigured Connect startup cannot resume a missing WebView', () => {
  const source = read('android/app/src/main/java/ai/wizards/os/MainActivity.java');
  const resume = source.slice(source.indexOf('protected void onResume()'));
  const guard = resume.indexOf('if (web == null) return;');
  assert.ok(guard > 0 && guard < resume.indexOf('ScrollCaptureDiagnostics.resumed(this)'));
  assert.ok(guard < resume.indexOf('web.onResume()'));
});
