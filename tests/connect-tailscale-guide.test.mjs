import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The connect screens' Tailscale guide: iPhone (ios/www/tailscale-guide.js) and Android (TailscaleGuide.java).
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const box = { window: {} }; box.window = box;
vm.runInNewContext(read('ios/www/tailscale-guide.js'), box);
const G = box.WizardTailscaleGuide;
const steps = h => [...h.matchAll(/data-gstep="(\d)" data-state="(\w+)"/g)].map(m => m[2]).join(',');

test('only Wizards on a Tailscale address get the guide; the network name comes from the address', () => {
  assert.equal(G.tailnet('wizard.example-tailnet.ts.net'), 'example-tailnet.ts.net');
  assert.equal(G.tailnet('Wizard.Example-Tailnet.ts.net:8443'), 'example-tailnet.ts.net');
  for (const host of ['ts.net', 'wizard.example.com', 'wizard.ts.net.evil.example', '']) { assert.equal(G.applies(host), false, host); assert.equal(G.tailnet(host), ''); }
});

test('the step needed now follows what the phone shows; the button sits on that step', () => {
  const off = G.html({ host: 'wizard.example-tailnet.ts.net', on: false });
  assert.equal(steps(off), 'now,todo,todo');
  assert.match(off, /Tailscale isn’t running on this phone yet\./);
  assert.match(off, /data-guide="tailscale">[^]*Get Tailscale<\/button>/);
  assert.match(off, /<div class="chip">example-tailnet\.ts\.net<\/div>/);
  assert.match(off, /Add VPN Configurations/);
  assert.equal((off.match(/data-guide="tailscale"/g) || []).length, 1);
  // Tailscale on, the Wizard's name doesn't exist from this phone: another account, or removed from the network.
  const wrong = G.html({ host: 'wizard.example-tailnet.ts.net', on: true, missing: true });
  assert.equal(steps(wrong), 'done,now,todo');
  assert.match(wrong, /Tailscale is on, but this phone isn’t on your Wizard’s network\./);
  assert.match(wrong, /removed from yours/);
  assert.match(wrong, /Open Tailscale<\/button>/);
  // Tailscale on, the name exists, nothing answers: the Wizard's computer is off or asleep. The phone is fine.
  const quiet = G.html({ host: 'wizard.example-tailnet.ts.net', on: true, missing: false });
  assert.equal(steps(quiet), 'done,now,todo', 'can’t tell a Wizard that is off from stale Tailscale on the phone: no tick on step 2, and only step 2 is active');
  assert.match(quiet, /data-gstep="2"[^]*turn Tailscale off and on again and log in if it asks[^]*Open Tailscale<\/button>/);
  assert.doesNotMatch(quiet, /Add VPN Configurations/, 'no first-time VPN tip: Tailscale is already on');
  assert.match(quiet, /Tailscale is on, but your Wizard isn’t answering this phone\./);

  assert.match(quiet, /Check your Wizard is on/);
  assert.match(quiet, /<h1>Your Wizard isn’t answering<\/h1>/);
  assert.doesNotMatch(quiet, /removed from yours/, 'doesn’t claim the phone is on another network');
  const unsure = G.html({ host: 'wizard.example-tailnet.ts.net', on: true });
  assert.equal(steps(unsure), 'done,checking,todo', 'step 2 spins; step 3 waits');
  assert.match(unsure, /Checking that this phone is on your Wizard’s network/);
  assert.match(unsure, /<h1>Connecting to your Wizard<\/h1>/, 'not "isn’t on your network" before that is confirmed');
  assert.doesNotMatch(unsure, /Turn it on|Installed and on/, 'no second "Tailscale is on" step');
  // Steps complete in order in every state.
  for (const on of [false, true]) for (const missing of [null, true, false]) for (const installed of [null, false, true]) {
    const s = G.steps({ on, missing, installed });
    assert.equal(s.length, 3);
    for (let i = 1; i < 3; i++) if (s[i] === 'done') assert.equal(s[i - 1], 'done', JSON.stringify({ on, missing, installed }));
    assert.ok(s.filter(x => x === 'now' || x === 'checking').length <= 1, 'one active step at most: ' + s);
  }
  const android = G.html({ host: 'wizard.example-tailnet.ts.net', on: false, installed: true, platform: 'android' });
  assert.equal(steps(android), 'done,now,todo');
  assert.match(android, /data-gstep="2"[^]*Open Tailscale<\/button>/);
  assert.match(android, /Android asks to set up a VPN connection/);
  assert.doesNotMatch(G.html({ host: 'wizard.example.com' }), /class="chip"/, 'no network name without a tailnet');
  assert.doesNotMatch(G.html({ host: '<img src=x onerror=alert(1)>.ts.net' }), /<img/, 'the host is escaped');
});

test('Android calls only TailscaleGuide members that exist', () => {
  const guide = read('android/app/src/main/java/ai/wizards/os/TailscaleGuide.java');
  for (const f of ['TailscaleGuideView', 'ReachScreen', 'ConnectActivity', 'MainActivity']) {
    const src = read(`android/app/src/main/java/ai/wizards/os/${f}.java`);
    for (const [, name] of src.matchAll(/TailscaleGuide\.([A-Za-z_]+)/g)) {
      if (name === 'Step') continue;
      assert.match(guide, new RegExp(`(static [^=(]*\\b${name}\\s*[(=,]|, ${name} =)`), `${f} uses TailscaleGuide.${name}`);
    }
  }
});

test('iPhone and Android say the same words', () => {
  const java = read('android/app/src/main/java/ai/wizards/os/TailscaleGuide.java');
  const constant = name => { const m = java.match(new RegExp(`\\b${name} = "([^"]*)"`)); assert.ok(m, name); return m[1]; };
  const pairs = { eyebrow: 'EYEBROW', title: 'TITLE', titleAway: 'TITLE_AWAY', titleChecking: 'TITLE_CHECKING', off: 'OFF', wrong: 'WRONG', lead: 'LEAD', get: 'GET', signin: 'SIGN_IN',
    back: 'BACK', quiet: 'QUIET', unsure: 'UNSURE', wake: 'WAKE', wakeBody: 'WAKE_BODY', stuck: 'STUCK', free: 'FREE', installed: 'INSTALLED', same: 'SAME', network: 'NETWORK', removed: 'REMOVED',
    vpnAndroid: 'VPN', auto: 'AUTO', checking: 'CHECKING', about: 'ABOUT', about1: 'ABOUT1', about2: 'ABOUT2', about3: 'ABOUT3', other: 'OTHER' };
  for (const [js, name] of Object.entries(pairs)) assert.equal(constant(name), G.text[js], name);
});

test('the iPhone connect screen loads the guide and connects by itself once the Wizard answers', () => {
  const page = read('ios/www/index.html');
  assert.ok(page.indexOf('<script src="tailscale-guide.js"></script>') > 0 && page.indexOf('tailscale-guide.js') < page.indexOf('const G = window.WizardTailscaleGuide'));
  assert.match(page, /<section class="card" id="guide"[^>]*hidden><\/section>/);
  assert.match(page, /call\('check', \{ address: g\.address \}\)/);
  assert.match(page, /e\.code === 'offline' && G\.applies/, 'only a Wizard that never answered gets the guide');
  assert.match(page, /if \(r && r\.offline && on && \(await tailscaleOn\(\)\)\)/, 'only answers found with Tailscale on count');
  assert.match(page, /if \(g\.on !== undefined && on !== g\.on\) \{ g\.missing = null; g\.notFound = 0; \}/, 'a reason found while Tailscale was off does not carry over');
  assert.match(page, /else if \(g\.notFound >= 2\) paintGuide\(on, true\)/, '"not on your network" needs two in a row');
  const swift = read('ios/native/App/App/WizardViewController.swift');
  for (const method of ['tailscale', 'check', 'openTailscale']) assert.match(swift, new RegExp(`CAPPluginMethod\\(name: "${method}"`));
  assert.match(swift, /apps\.apple\.com\/app\/tailscale\/id1470499037/);
  // A Wizard that hangs (Tailscale off, its computer off) must not leave a black screen: a watchdog shows the guide.
  assert.match(swift, /func watchUnreachable\(/);
  assert.match(swift, /hopeless \? 1\.5 : 10/);
  // No black screen meanwhile: the connect page's own full-screen loader covers the web view from launch.
  assert.match(swift, /showLoadingCover\(over: web, host: WizardOrigin\.host\(wizard\)\)/);
  assert.match(swift, /parts\.fragment = "loading=" \+/);
  assert.match(page, /get\('loading'\);\n\s+if \(loading !== null\)/);
  assert.match(swift, /if !connectMode \{ watchUnreachable\(web\) \}/);
  assert.match(swift, /"changing": connectMode && WizardAddress\.current != nil && !unreachableMode/, 'the guide, not Change Wizard');
});

test('a check still running for a guide the owner left doesn’t stop the next guide’s checks', () => {
  const page = read('ios/www/index.html');
  assert.doesNotMatch(page, /guideBusy/, 'no page-wide busy flag');
  assert.match(page, /if \(!guide \|\| guide\.busy\) return;/);
  assert.match(page, /g\.busy = true;[^]*finally \{ g\.busy = false; \}/);
});
