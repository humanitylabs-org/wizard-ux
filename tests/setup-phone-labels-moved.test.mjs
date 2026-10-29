// Setup's old phone checklist (web/setup/setup.js, step1/step2/step3) moved into the one shared connect component
// (web/core/phone-connect.js, James-approved device flow, PR #688). Each old line's behaviour survives under new
// wording; this renders the component in every state and asserts the wording the parity gate's renames map to
// (docs/parity-renames-devices.txt). A dropped state fails here, not only in the static label inventory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/core/phone-connect.js', import.meta.url), 'utf8');
const setup = fs.readFileSync(new URL('../web/setup/setup.js', import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

function render(reply, layout = 'desktop', extra = {}) {
  const s = { setTimeout, clearTimeout, AbortController, URL, console, window: null, addEventListener() {},
    navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } },
    document: { visibilityState: 'hidden', addEventListener() {}, createElement: () => ({ setAttribute() {}, select() {}, remove() {}, style: {} }),
      body: { appendChild() {} }, execCommand: () => false }, ...extra };
  s.window = s;
  vm.runInNewContext(source, s);
  let html = '', click = null;
  const node = { isConnected: true, classList: { add() {} }, dataset: {}, setAttribute() {}, removeEventListener() {},
    addEventListener(t, f) { if (t === 'click') click = f; }, contains: () => true, querySelector: () => null, querySelectorAll: () => [],
    set innerHTML(v) { html = v; }, get innerHTML() { return html; } };
  const pc = s.WizPhoneConnect.create({ active: () => false, layout, api: async () => reply });
  pc.attach(node);
  return { pc, get html() { return html; }, click: (t) => click({ target: { closest: () => t }, preventDefault() {} }) };
}
const ok = data => ({ kind: 'ok', data: { phones: [], ...data } });
const WIZ = 'https://wizard.example.test/';

test('owner-only, off and starting states keep their meaning under the shared wording', async () => {
  const denied = render({ kind: 'denied' }); denied.pc.refresh(); await tick();
  assert.match(denied.html, /Only Wizard’s owner can connect a device\./);
  const off = render(ok({ step: 'off' })); off.pc.refresh(); await tick();
  assert.match(off.html, /Nothing is opened to the internet\./);
  assert.match(off.html, /data-pc="start"/);
  // Connect → "Starting Tailscale…" until the sign-in page is ready (was "Getting the sign-in page ready…").
  const starting = render(ok({ step: 'off' }), 'desktop'); starting.pc.refresh(); await tick();
  starting.click({ dataset: { pc: 'start' } });
  assert.match(starting.html, /Starting Tailscale…/);
});

test('sign-in and HTTPS steps still lead to Tailscale', async () => {
  const signin = render(ok({ step: 'signin', auth_url: 'https://login.tailscale.com/a/x', this_device: 'wizard-box' })); signin.pc.refresh(); await tick();
  assert.match(signin.html, /Sign in to Tailscale in your browser, then approve the new device/);
  assert.match(signin.html, />Sign in to Tailscale</);
  const https = render(ok({ step: 'https', https_enable_url: 'https://login.tailscale.com/admin/dns' })); https.pc.refresh(); await tick();
  assert.match(https.html, />Turn on HTTPS</);
});

test('serving: address, scan and waiting hints on both layouts', async () => {
  const desk = render(ok({ step: 'serving', wizard_url: WIZ })); desk.pc.refresh(); await tick();
  assert.match(desk.html, /and point it here\. The iPhone Camera works too\./);
  assert.match(desk.html, /Waiting for your device…/);
  const phone = render(ok({ step: 'serving', wizard_url: WIZ }), 'phone'); phone.pc.refresh(); await tick();
  assert.match(phone.html, /On the device you want to connect, open the Wizard app and enter this address, or open it in the browser\./);
  const early = render(ok({ step: 'serving' })); early.pc.refresh(); await tick();
  assert.match(early.html, /Getting your Wizard’s address…/);
});

test('connect another device: Tailscale, then Wizard, each with its QR', async () => {
  const flow = render(ok({ step: 'phone_seen', wizard_url: WIZ, phones: [{ name: 'Pixel', os: 'android', online: true }] })); flow.pc.refresh(); await tick();
  flow.pc.connectAnother();
  assert.match(flow.html, /Get Tailscale on your other device/);
  assert.match(flow.html, /Scan with your device’s camera\./);
  assert.match(flow.html, /3 · Connect your other device to Wizard/);
  assert.match(setup, /Connect another device/);
});

test('copy failure still tells the owner to select the address', async () => {
  const r = render(ok({ step: 'serving', wizard_url: WIZ })); r.pc.refresh(); await tick();
  const btn = { dataset: { pc: 'copy', text: WIZ }, textContent: 'Copy', isConnected: true };
  r.click(btn); await tick(); await tick();
  assert.equal(btn.textContent, 'Select it');
});
