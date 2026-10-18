// James's contract (18 Oct 2026): Wizard records only from the phone's own mic. On the Android app the browser
// recorders (shell orb fallback, app PCM capture) skip the native guard, so they ask WizardOSDevice.micRoute()
// after getUserMedia and refuse a take Android has put on a Bluetooth or external mic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const capture = readFileSync(new URL('../web/core/app-capture.js', import.meta.url), 'utf8');

function extract(src, name) {
  const at = src.indexOf(`async function ${name}(`);
  assert.ok(at >= 0, `${name} present`);
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(at, i + 1);
}

function run(src, name, globalName, answers) {
  const calls = [];
  const dev = { micRoute() { calls.push(1); return answers.length > 1 ? answers.shift() : answers[0]; } };
  const fn = new Function(globalName, `${src}; return ${name};`)({ WizardOSDevice: dev });
  return { fn, calls };
}

for (const [label, src, name, g] of [
  ['shell orb', app, 'browserMicIsExternal', 'window'],
  ['app capture', capture, 'externalMic', 'W'],
]) {
  const body = extract(src, name);
  test(`${label}: a Bluetooth route is refused`, async () => {
    const { fn } = run(body, name, g, ['external']);
    assert.equal(await fn(), true);
  });
  test(`${label}: the phone mic is accepted`, async () => {
    const { fn } = run(body, name, g, ['unknown', 'builtin']);
    assert.equal(await fn(), false);
  });
  test(`${label}: no native bridge (desktop, browser) is not refused`, async () => {
    const fn = new Function(g, `${body}; return ${name};`)({});
    assert.equal(await fn(), false);
  });
}

test('both browser recorders check the route right after opening the mic', () => {
  assert.match(app, /getUserMedia\(\{ audio:[^\n]+\n[^\n]*\n\s+if \(await browserMicIsExternal\(\)\)/);
  assert.match(capture, /s\.stream = await navigator\.mediaDevices\.getUserMedia[^\n]+\n[^\n]*\n\s+if \(await externalMic\(\)\)/);
  assert.match(app, /err\?\.code === 'external_mic'/);
});
