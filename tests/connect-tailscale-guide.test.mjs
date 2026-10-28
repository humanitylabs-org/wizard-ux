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
  assert.equal(G.tailnet('wizard.tail1234.ts.net'), 'tail1234.ts.net');
  assert.equal(G.tailnet('Wizard.Tail1234.ts.net:8443'), 'tail1234.ts.net');
  for (const host of ['ts.net', 'wizard.example.com', 'wizard.ts.net.evil.example', '']) { assert.equal(G.applies(host), false, host); assert.equal(G.tailnet(host), ''); }
});

test('the step needed now follows what the phone shows; the button sits on that step', () => {
  const off = G.html({ host: 'wizard.tail1234.ts.net', on: false });
  assert.equal(steps(off), 'now,todo,todo,todo');
  assert.match(off, /Tailscale isn’t running on this phone yet\./);
  assert.match(off, /data-guide="tailscale">[^]*Get Tailscale<\/button>/);
  assert.match(off, /<div class="chip">tail1234\.ts\.net<\/div>/);
  assert.match(off, /Add VPN Configurations/);
  assert.equal((off.match(/data-guide="tailscale"/g) || []).length, 1);
  // Tailscale on, the Wizard's name doesn't exist from this phone: another account, or removed from the network.
  const wrong = G.html({ host: 'wizard.tail1234.ts.net', on: true, missing: true });
  assert.equal(steps(wrong), 'done,now,done,todo');
  assert.match(wrong, /Tailscale is on, but this phone isn’t on your Wizard’s network\./);
  assert.match(wrong, /removed from yours/);
  assert.match(wrong, /Open Tailscale<\/button>/);
  // Tailscale on, the name exists, nothing answers: the Wizard's computer is off or asleep. The phone is fine.
  const quiet = G.html({ host: 'wizard.tail1234.ts.net', on: true, missing: false });
  assert.equal(steps(quiet), 'done,done,done,now');
  assert.match(quiet, /Your phone is on your Wizard’s network, but your Wizard isn’t answering\./);
  assert.match(quiet, /Check your Wizard is on/);
  assert.match(quiet, /<h1>Your Wizard isn’t answering<\/h1>/);
  assert.doesNotMatch(quiet, /removed from yours|data-guide="tailscale"/, 'nothing to fix on the phone');
  const unsure = G.html({ host: 'wizard.tail1234.ts.net', on: true });
  assert.equal(steps(unsure), 'done,todo,done,now');
  assert.match(unsure, /Tailscale is on, but your Wizard isn’t answering this phone\./);
  const android = G.html({ host: 'wizard.tail1234.ts.net', on: false, installed: true, platform: 'android' });
  assert.equal(steps(android), 'done,todo,now,todo');
  assert.match(android, /Android asks to set up a VPN connection/);
  assert.doesNotMatch(G.html({ host: 'wizard.example.com' }), /class="chip"/, 'no network name without a tailnet');
  assert.doesNotMatch(G.html({ host: '<img src=x onerror=alert(1)>.ts.net' }), /<img/, 'the host is escaped');
});

test('iPhone and Android say the same words', () => {
  const java = read('android/app/src/main/java/ai/wizards/os/TailscaleGuide.java');
  const constant = name => { const m = java.match(new RegExp(`\\b${name} = "([^"]*)"`)); assert.ok(m, name); return m[1]; };
  const pairs = { eyebrow: 'EYEBROW', title: 'TITLE', titleAway: 'TITLE_AWAY', off: 'OFF', wrong: 'WRONG', lead: 'LEAD', get: 'GET', signin: 'SIGN_IN', turnOn: 'TURN_ON',
    back: 'BACK', quiet: 'QUIET', unsure: 'UNSURE', wake: 'WAKE', wakeBody: 'WAKE_BODY', free: 'FREE', installed: 'INSTALLED_ON', isOn: 'IS_ON', same: 'SAME', network: 'NETWORK', removed: 'REMOVED',
    vpnAndroid: 'VPN', auto: 'AUTO', checking: 'CHECKING', about: 'ABOUT', about1: 'ABOUT1', about2: 'ABOUT2', about3: 'ABOUT3', other: 'OTHER' };
  for (const [js, name] of Object.entries(pairs)) assert.equal(constant(name), G.text[js], name);
});

test('the iPhone connect screen loads the guide and connects by itself once the Wizard answers', () => {
  const page = read('ios/www/index.html');
  assert.ok(page.indexOf('<script src="tailscale-guide.js"></script>') > 0 && page.indexOf('tailscale-guide.js') < page.indexOf('const G = window.WizardTailscaleGuide'));
  assert.match(page, /<section class="card" id="guide"[^>]*hidden><\/section>/);
  assert.match(page, /call\('check', \{ address: g\.address \}\)/);
  assert.match(page, /e\.code === 'offline' && G\.applies/, 'only a Wizard that never answered gets the guide');
  assert.match(page, /if \(r && r\.offline\) paintGuide\(on, !!r\.missing\)/, 'a no-such-name answer tells another network from a Wizard that is off');
  const swift = read('ios/native/App/App/WizardViewController.swift');
  for (const method of ['tailscale', 'check', 'openTailscale']) assert.match(swift, new RegExp(`CAPPluginMethod\\(name: "${method}"`));
  assert.match(swift, /apps\.apple\.com\/app\/tailscale\/id1470499037/);
  // A Wizard that hangs (Tailscale off, its computer off) must not leave a black screen: a watchdog shows the guide.
  assert.match(swift, /func watchUnreachable\(/);
  assert.match(swift, /hopeless \? 1\.5 : 10/);
  assert.match(swift, /if !connectMode \{ watchUnreachable\(web\) \}/);
  assert.match(swift, /"changing": connectMode && WizardAddress\.current != nil && !unreachableMode/, 'the guide, not Change Wizard');
});
