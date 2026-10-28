// Phones & devices on a phone that was just removed from Tailscale kept saying "iphone171 is connected": the status
// request to the unreachable Wizard hung, and failed checks kept the last answer up as current. Now requests time out,
// and after two failed checks in a row the component reports the answer as lost and stops showing it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/core/phone-connect.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function load(fetchImpl) {
  const s = { console, setTimeout, clearTimeout, AbortController, JSON, Date, Promise, String, Object, Array, Math, Set, Map };
  s.window = s;
  s.document = { visibilityState: 'visible', addEventListener() {}, createElement: () => ({}), body: { appendChild() {} } };
  s.addEventListener = () => {};
  s.fetch = fetchImpl;
  vm.runInNewContext(source, s);
  return s.WizPhoneConnect;
}

const seen = { step: 'phone_seen', wizard_url: 'https://wizard.example.ts.net/', device_name: 'wizard.example.ts.net', phones: [{ name: 'iphone171', os: 'iOS', online: true }] };

test('two failed checks in a row stop showing the last answer as current', async () => {
  let up = true;
  const PC = load(async () => { if (!up) throw new TypeError('Load failed'); return { ok: true, status: 200, json: async () => seen }; });
  const pc = PC.create({ active: () => false });
  pc.refresh(); await tick(); await tick();
  assert.equal(pc.on, true); assert.equal(pc.lost, false);

  up = false;
  pc.refresh(); await tick(); await tick();
  assert.equal(pc.lost, false, 'one failed check is a blip: keep the answer, with a banner');
  assert.equal(pc.on, true);
  pc.refresh(); await tick(); await tick();
  assert.equal(pc.lost, true);
  assert.equal(pc.on, false, 'Settings no longer lists the phones or says connected');

  up = true;
  pc.refresh(); await tick(); await tick();
  assert.equal(pc.lost, false, 'one good answer brings it back');
  assert.equal(pc.on, true);
});

test('status requests carry an abort signal, so a Wizard that never answers times out', async () => {
  let signal = null;
  const PC = load(async (url, opts) => { signal = opts.signal; return { ok: true, status: 200, json: async () => seen }; });
  PC.create({ active: () => false }).refresh(); await tick();
  assert.ok(signal && typeof signal.aborted === 'boolean');
});
