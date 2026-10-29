import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAddrs, isPublic, sameNetwork, plan, verdict, knockSh, knockPs, createExposureChecker, mergeAccess } from '../tools/system-exposure.mjs';
import { createDevicesReader } from '../tools/system-devices.mjs';
import { createResourceHandler } from '../tools/system-resources.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'expo-'));
const HOME_V4 = '203.0.113.7', VPS_V4 = '198.51.100.9';

test('only public addresses count; tailscale, LAN and link-local are ignored', () => {
  const a = parseAddrs([
    'ts=' + JSON.stringify({ Self: { Addrs: [`${HOME_V4}:41641`, '192.168.1.5:41641', '[2001:db8:1:2::5]:41641', '[fe80::1]:41641', '100.101.1.2:41641'] } }),
    'v6=2001:db8:1:2::6', 'v6=fd7a:115c:a1e0::1', 'listen=22', 'listen=22', 'listen=7070', 'listen=99999', 'junk',
  ].join('\r\n'));
  assert.deepEqual(a.v4, [HOME_V4]); assert.deepEqual(a.v6, ['2001:db8:1:2::5', '2001:db8:1:2::6']); assert.deepEqual(a.listen, [22, 7070]);
  assert.equal(isPublic('10.0.0.1'), false); assert.equal(isPublic('100.64.0.1'), false); assert.equal(isPublic('8.8.8.8'), true);
});

test('two machines behind one router never test each other', () => {
  const home1 = { v4: [HOME_V4], v6: ['2001:db8:1:2::5'] }, home2 = { v4: [HOME_V4], v6: ['2001:db8:1:2:aaaa::9'] }, vps = { v4: [VPS_V4], v6: ['2001:db8:ff::1'] };
  assert.equal(sameNetwork(home1, home2), true); assert.equal(sameNetwork(home1, vps), false);
  const ms = [{ id: 'this', addrs: { ...home1, listen: [22] } }, { id: 'laptop', addrs: { ...home2, listen: [7070] } }, { id: 'vps', addrs: { ...vps, listen: [] } }];
  const { jobs, out } = plan(ms);
  assert.equal(out.this.by.v4, 'vps'); assert.equal(out.laptop.by.v6, 'vps'); assert.equal(out.vps.by.v4, 'this');
  assert.ok(jobs.get('vps').some(j => j.target === 'laptop' && j.port === 7070));
});

test('a lone machine stays "not checked", never guessed safe', () => {
  const ms = [{ id: 'this', name: 'Box', addrs: { v4: [HOME_V4], v6: [], listen: [22] } }];
  const { out } = plan(ms);
  assert.equal(verdict(ms[0], out.this, [], {}).exposure, 'unchecked');
});

test('an answering port is "open to the internet" in plain words', () => {
  const t = { id: 'laptop' }, p = { tested: { v4: true, v6: true }, by: { v4: 'vps', v6: 'vps' }, ports: [22, 7070] };
  const v = verdict(t, p, [{ target: 'laptop', port: 7070, fam: 'v6' }], { vps: 'Cloud server' });
  assert.equal(v.exposure, 'internet'); assert.deepEqual(v.open, [7070]); assert.match(v.details[0], /AnyDesk \(port 7070\) answers from the internet over IPv6/);
  const ok = verdict(t, p, [], { vps: 'Cloud server' });
  assert.equal(ok.exposure, 'tailscale'); assert.match(ok.details[0], /tested from Cloud server/);
});

test('knock scripts carry only validated IP literals and port numbers', () => {
  const bad = [{ addr: '1.2.3.4;rm -rf /', port: 22 }, { addr: '$(id)', port: 22 }, { addr: '8.8.8.8', port: '22 && x' }, { addr: '8.8.8.8', port: 22 }];
  for (const s of [knockSh(bad), knockPs(bad)]) { assert.ok(s.includes('8.8.8.8')); assert.ok(!s.includes('rm -rf')); assert.ok(!s.includes('$(id)')); assert.ok(!s.includes('&& x')); }
});

test('the check notifies once when a machine opens, and shows it in the Devices feed', async () => {
  const dir = tmp(), reg = path.join(dir, 'devices.json'), expo = path.join(dir, 'exposure.json');
  fs.writeFileSync(reg, JSON.stringify({ this: { name: 'Home box' }, devices: [{ id: 'vps', name: 'Cloud server', connect: { type: 'ssh', host: 'vps' },
    access: { exposure: 'internet', how: 'ssh vps', details: ['SSH answers from the internet', 'Emergency way in: the host’s web console'] } }] }));
  const addrs = { this: { v4: [HOME_V4], v6: [], listen: [] }, vps: { v4: [VPS_V4], v6: [], listen: [22] } };
  let open = [], sent = [];
  const checker = createExposureChecker({ registryPath: reg, path: expo, readAddrsImpl: async m => addrs[m.id], knockImpl: async (v, ts) => ts.filter(t => open.includes(`${t.addr}:${t.port}`)), notify: async (t, m) => sent.push(t) });
  let r = await checker.checkNow();
  assert.equal(r.machines.vps.exposure, 'tailscale'); assert.equal(sent.length, 0);
  open = [`${VPS_V4}:22`]; r = await checker.checkNow();
  assert.equal(r.machines.vps.exposure, 'internet'); assert.deepEqual(sent, ['Cloud server is open to the internet']);
  await checker.checkNow(); assert.equal(sent.length, 1, 'same open port: no second notification');
  const feed = await createDevicesReader({ registryPath: reg, exposurePath: expo, probeLocalImpl: async () => ({ platform: 'linux', disks: [] }), probeSshImpl: async () => ({ platform: 'linux', disks: [] }), tailnetImpl: async () => null })();
  const vps = feed.devices.find(d => d.id === 'vps');
  assert.equal(vps.access.exposure, 'internet'); assert.equal(vps.access.auto, true); assert.equal(vps.access.how, 'ssh vps');
  assert.ok(vps.access.details.includes('Emergency way in: the host’s web console')); assert.ok(!vps.access.details.includes('SSH answers from the internet'));
  open = []; r = await checker.checkNow(); assert.equal(r.machines.vps.exposure, 'tailscale');
});

test('an offline machine keeps its last result, marked stale', async () => {
  const dir = tmp(), reg = path.join(dir, 'devices.json'), expo = path.join(dir, 'exposure.json');
  fs.writeFileSync(reg, JSON.stringify({ devices: [{ id: 'vps', connect: { type: 'ssh', host: 'vps' } }] }));
  let up = true;
  const checker = createExposureChecker({ registryPath: reg, path: expo, readAddrsImpl: async m => { if (m.id === 'vps' && !up) throw new Error('offline'); return m.id === 'vps' ? { v4: [VPS_V4], v6: [], listen: [] } : { v4: [HOME_V4], v6: [], listen: [] }; }, knockImpl: async () => [], notify: async () => {} });
  await checker.checkNow(); up = false; const r = await checker.checkNow();
  assert.equal(r.machines.vps.exposure, 'tailscale'); assert.equal(r.machines.vps.stale, true);
  assert.equal(mergeAccess(null, r.machines.vps).stale, true);
});

test('only the tailnet owner can trigger a re-check, by POST, and a fresh result is reused', async () => {
  let runs = 0; const exposure = { checkSoon: async () => { runs++; return { at: 'x', machines: {} }; } };
  const h = createResourceHandler(async () => ({}), async () => ({ devices: [] }), null, exposure);
  const call = (method, url, headers = {}) => new Promise(resolve => { const res = { writeHead(s) { this.s = s; }, end(b) { resolve({ status: this.s, body: b }); } }; h({ method, url, headers }, res); });
  assert.equal((await call('GET', '/api/system/exposure/check', { 'tailscale-user-login': 'me' })).status, 405);
  assert.equal((await call('POST', '/api/system/exposure/check')).status, 403);
  assert.equal((await call('POST', '/api/system/exposure/check', { 'tailscale-user-login': 'me', 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await call('POST', '/api/system/exposure/check', { 'tailscale-user-login': 'me' })).status, 200); assert.equal(runs, 1);
  assert.equal((await call('POST', '/api/system/devices', { 'tailscale-user-login': 'me' })).status, 405);
});
