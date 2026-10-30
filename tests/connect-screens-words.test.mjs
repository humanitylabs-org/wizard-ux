import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The phone's connect and can't-reach screens say the same words on iPhone (ios/www/index.html + Swift) and Android
// (ConnectActivity, ReachPolicy, ReachScreen, WizardProbe). Android's words are the reference.
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const java = name => read(`android/app/src/main/java/ai/wizards/os/${name}.java`);
const connect = java('ConnectActivity'), policy = java('ReachPolicy'), reach = java('ReachScreen'), probe = java('WizardProbe');
const page = read('ios/www/index.html').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
const origin = read('ios/native/App/App/WizardOrigin.swift'), controller = read('ios/native/App/App/WizardViewController.swift');
const inJava = (src, s) => src.includes(`"${s}"`);
const literals = src => [...src.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
const between = (src, from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, from); const b = src.indexOf(to, a); assert.ok(b > a, to); return src.slice(a, b); };

test('the Connect and Change Wizard screens say the same words', () => {
  for (const s of ['Connect to your Wizard', 'Link this phone to your Wizard.', 'Scan QR code',
    'On your computer, open Wizard › Settings › Phones & devices', 'https://your-wizard.ts.net', 'Connect',
    'A QR code only fills in the address. Your Wizard still asks you to sign in.', 'Change Wizard',
    'Point this phone at another Wizard, or this one again.', 'Keep current Wizard']) {
    assert.ok(inJava(connect, s), `Android: ${s}`);
    assert.ok(page.includes(s), `iPhone: ${s}`);
  }
  // Group labels: both draw them uppercase, so compare without case.
  const javaGroups = [...connect.matchAll(/groupLabel\("([^"]+)"\)/g)].map(m => m[1].toLowerCase());
  const pageGroups = [...page.matchAll(/class="group"[^>]*>([^<]+)</g)].map(m => m[1].trim().toLowerCase());
  assert.deepEqual(pageGroups, javaGroups);
  assert.deepEqual(javaGroups, ['scan', 'or enter its address']);
});

test('the status lines under the address say the same words', () => {
  const badQr = connect.match(/BAD_QR = "([^"]+)"/)[1];
  for (const s of ['Check the address, then tap Connect.', 'Scanned. Check the address, then tap Connect.', badQr,
    "Enter your Wizard's https:// address, like https://wizard.your-tailnet.ts.net"]) {
    assert.ok(connect.includes(`"${s}"`), `Android: ${s}`);
    assert.ok(page.includes(s), `iPhone: ${s}`);
  }
  assert.ok(controller.includes(badQr), 'iPhone scanner: the bad QR message');
  const store = 'Connect to your Wizard first, then review the shared app in the Store.';
  assert.ok(inJava(connect, store) && controller.includes(`"${store}"`), store);
});

test("the can't-reach screens say ReachPolicy's words", () => {
  const cases = src => {
    const out = {};
    for (const m of src.matchAll(/case (\w+): return "([^"]*)"/g)) out[m[1]] = m[2];
    out.default = src.match(/default: return "([^"]*)"/)[1];
    return out;
  };
  const titles = cases(between(policy, 'static String title(', 'static String body(')),
    bodies = cases(between(policy, 'static String body(', 'static boolean offerTailscale('));
  const ios = {};
  for (const m of page.matchAll(/(\w+): \["([^"]*)", (?:\(\)|host) => "([^"]*)"\]/g)) ios[m[1]] = [m[2], m[3]];
  const map = { offline: 'NO_NETWORK', refused: 'REFUSED', server: 'default', quiet: 'default' };
  for (const [kind, why] of Object.entries(map)) {
    assert.ok(ios[kind], `iPhone has the ${kind} look`);
    assert.deepEqual(ios[kind], [titles[why], bodies[why]], kind);
  }
  for (const s of ['Try again', 'Open Tailscale', 'Connecting to your Wizard…']) {
    assert.ok(reach.includes(`"${s}"`), `Android: ${s}`);
    assert.ok(page.includes(s), `iPhone: ${s}`);
  }
  assert.ok(reach.includes('"  ·  Edit address"') && page.includes('}  ·  Edit address`'), 'the address line');
});

test("a failed check says WizardProbe's words on both", () => {
  const javaParts = new Set(literals(between(probe, 'static String message(', 'static String host(').replace(/\/\*[^]*?\*\//g, '')).filter(Boolean));
  const swift = between(origin, 'static let refusedMessage', 'static func refused(')
    + between(origin, 'static func failure(', 'static func headerProblem(')
    + between(origin, 'static func headerProblem(', 'return nil');
  const swiftParts = new Set(literals(swift).flatMap(s => s.split(/\\\([^)]*\)/)).filter(s => s && !['text/html', ';'].includes(s)));
  assert.deepEqual([...swiftParts].sort(), [...javaParts].sort());
  assert.ok(javaParts.has('Couldn\'t find ') && javaParts.has(' answered, but it isn\'t a Wizard.'));
});

test('both apps draw the Wizard logo row and the same orb', () => {
  for (const f of ['ConnectActivity', 'ReachScreen', 'TailscaleGuideView']) assert.match(java(f), /BrandRow\.build\(/, f);
  assert.match(java('BrandRow'), /R\.drawable\.wizard_mark/);
  assert.ok(fs.existsSync(new URL('../android/app/src/main/res/drawable-nodpi/wizard_mark.png', import.meta.url)));
  assert.match(page, /<div class="brand"><img src="brand\/wizard-mark-white\.png" alt="">Wizard<\/div>/);
  assert.deepEqual(fs.readFileSync(new URL('../ios/www/brand/orb.png', import.meta.url)),
    fs.readFileSync(new URL('../android/app/src/main/assets/assist/robert-thread-orb.png', import.meta.url)));
});
