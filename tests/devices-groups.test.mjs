import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbe, cleanRegistry, peerGroup, createDevicesReader } from '../tools/system-devices.mjs';

test('Windows probe output parses into the shared reading shape', () => {
  const r = parseProbe('os=Windows\r\ncpus=4\nmemtotal=8419729408\nmemused=3150155776\ncpuidle=98\nuptime=751145\nwdisk=C:|510481395712|433226383360\nwdisk=Z:|100|50\n'.replace(/\r/g, ''));
  assert.equal(r.platform, 'windows'); assert.equal(r.cpus, 4); assert.equal(r.cpu, 2); assert.equal(r.memory, 37);
  assert.equal(r.disks.length, 1); assert.equal(r.disks[0].label, 'System disk'); assert.equal(r.disks[0].freeGB, 403);
});

test('registry keeps group and powershell shell; unknown values fall back', () => {
  const reg = cleanRegistry({ devices: [{ id: 'sniper', connect: { type: 'ssh', host: 'sniper', shell: 'powershell' }, group: 'agent' }, { id: 'x', connect: { type: 'ssh', host: 'x', shell: 'bash; rm' }, group: 'evil' }], groups: { 'carlos-demo': 'client', bad: 'root' } });
  assert.equal(reg.devices[0].connect.shell, 'powershell'); assert.equal(reg.devices[1].connect.shell, undefined); assert.equal(reg.devices[1].group, 'agent');
  assert.deepEqual(reg.groups, { 'carlos-demo': 'client' });
  assert.equal(peerGroup('iOS', 'localhost', reg), 'human'); assert.equal(peerGroup('linux', 'carlos-demo', reg), 'client'); assert.equal(peerGroup('linux', 'demo', reg), 'other');
});

test('reader passes the shell to the probe and tags peers with their group', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-')), 'devices.json');
  fs.writeFileSync(f, JSON.stringify({ devices: [{ id: 'sniper', connect: { type: 'ssh', host: 'sniper', shell: 'powershell' } }], groups: { 'carlos-demo': 'client' } }));
  const seen = [];
  const read = createDevicesReader({ registryPath: f, probeLocalImpl: async () => ({ platform: 'linux', disks: [] }), probeSshImpl: async (h, sh) => { seen.push([h, sh]); return { platform: 'windows', disks: [] }; },
    tailnetImpl: async () => ({ self: { name: 'box', dns: 'box' }, peers: [{ name: 'sniper', dns: 'sniper', os: 'windows', online: true }, { name: 'carlos-demo', dns: 'carlos-demo', os: 'linux', online: true }, { name: 'Pixel', dns: 'pixel', os: 'android', online: false }] }) });
  const out = await read();
  assert.deepEqual(seen, [['sniper', 'powershell']]);
  assert.equal(out.devices[1].group, 'agent'); assert.equal(out.devices[0].group, 'agent');
  assert.deepEqual(out.network.peers.map(p => [p.name, p.group]), [['carlos-demo', 'client'], ['Pixel', 'human']]);
});

test('registry keeps a device\'s Machines use and the managed Wizards list; the reader passes both through', async () => {
  const reg = cleanRegistry({ devices: [{ id: 'vps', connect: { type: 'ssh', host: 'vps' }, use: 'standby' }, { id: 'pc', connect: { type: 'ssh', host: 'pc' }, use: 'main' }],
    managed: [{ id: 'acme', name: 'Acme', org: 'Acme Inc', where: 'wizard.acme.example', peer: 'Acme-Demo', peerName: 'Acme demo box' }, { id: 'bad id', name: 'X' }, { id: 'nowhere', name: 'N', where: 'not a host; rm -rf' }] });
  assert.equal(reg.devices[0].use, 'standby'); assert.equal(reg.devices[1].use, undefined);
  assert.deepEqual(reg.managed, [{ id: 'acme', name: 'Acme', org: 'Acme Inc', where: 'wizard.acme.example', peer: 'acme-demo', peerName: 'Acme demo box' }, { id: 'nowhere', name: 'N' }]);
  assert.equal(cleanRegistry({}).managed, undefined, 'stock registries stay as they were');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-')), 'devices.json');
  fs.writeFileSync(f, JSON.stringify({ devices: [{ id: 'vps', connect: { type: 'ssh', host: 'vps' }, use: 'standby' }], managed: [{ id: 'acme', name: 'Acme', peer: 'acme-demo' }, { id: 'solo', name: 'Solo' }] }));
  const read = createDevicesReader({ registryPath: f, probeLocalImpl: async () => ({ platform: 'linux', disks: [] }), probeSshImpl: async () => ({ platform: 'linux', disks: [] }),
    tailnetImpl: async () => ({ self: { name: 'box', dns: 'box' }, peers: [{ name: 'acme-demo', dns: 'acme-demo', os: 'linux', online: true }] }) });
  const out = await read();
  assert.equal(out.devices[1].use, 'standby');
  assert.deepEqual(out.managed, [{ id: 'acme', name: 'Acme', peer: 'acme-demo', peerName: 'acme-demo', peerOnline: true }, { id: 'solo', name: 'Solo' }]);
  fs.writeFileSync(f, JSON.stringify({ devices: [] }));
  assert.equal((await createDevicesReader({ registryPath: f, probeLocalImpl: async () => ({ platform: 'linux', disks: [] }), tailnetImpl: async () => null })()).managed, undefined);
});
