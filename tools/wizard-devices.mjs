#!/usr/bin/env node
// wizard-devices: the agent's handle on the Wizard OS devices registry (spec/DEVICES.md).
// The owner asks by voice ("monitor Thales too", "stop watching the old laptop"); the agent runs this.
//
//   wizard-devices list                         registry + live reading of every device + tailnet nodes
//   wizard-devices add <id> --ssh <host> [--name N] [--role R] [--tailnet name,...] [--group agent|human|client|other] [--shell powershell] [--force]
//                                               adds a machine the Wizard already reaches over SSH
//                                               (refuses unless a live probe succeeds, unless --force)
//   wizard-devices remove <id>
//   wizard-devices this [--name N] [--role R] [--tailnet name,...]   name the box the Wizard runs on
//   wizard-devices hide <tailnet-name> | unhide <tailnet-name>       tidy the "On your network" list
//   wizard-devices probe <id|this>              one live reading as JSON
//   wizard-devices group <tailnet-name> <human|client|other|clear>   which group an unread tailnet machine shows under
import {readRegistry, writeRegistry, probeSsh, probeLocal, createDevicesReader, REGISTRY_PATH} from './system-devices.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { const k = rest[i].slice(2); flags[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
  else pos.push(rest[i]);
}
const list = v => typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined;
const die = m => { console.error(m); process.exit(1); };
const fmt = d => {
  const disks = (d.disks || []).map(x => `${x.label} ${x.pct}% (${x.freeGB} GB free of ${x.sizeGB})`).join('; ');
  return `${d.status === 'online' ? '●' : '○'} ${d.name} [${d.id}] ${d.status}${d.platform ? ' · ' + d.platform : ''}${d.cpu != null ? ` · CPU ${d.cpu}%` : ''}${d.memory != null ? ` · RAM ${d.memory}% of ${d.memoryTotalGB} GB` : ''}${disks ? ' · ' + disks : ''}${d.error ? ' · ' + d.error : ''}`;
};

const reg = readRegistry();
switch (cmd) {
  case 'list': case undefined: {
    const out = await createDevicesReader({ttlMs: 0})();
    console.log(`Registry: ${REGISTRY_PATH()}`);
    out.devices.forEach(d => console.log(fmt(d)));
    if (out.network.available) {
      console.log('\nOn your network (not monitored):');
      out.network.peers.forEach(p => console.log(`  ${p.online ? '●' : '○'} ${p.name} · ${p.os} · ${p.group}${p.lastSeen ? ' · last seen ' + p.lastSeen : ''}`));
    }
    break;
  }
  case 'add': {
    const id = String(pos[0] || '').toLowerCase(), host = flags.ssh;
    if (!id || typeof host !== 'string') die('usage: wizard-devices add <id> --ssh <host> [--name N] [--role R]');
    if (reg.devices.some(d => d.id === id)) die(`device "${id}" already exists; remove it first`);
    let reading = null;
    const shell = flags.shell === 'powershell' ? 'powershell' : undefined;
    try { reading = await probeSsh(host, shell); } catch (e) { if (!flags.force) die(`could not read ${host} over SSH (${e.message}). Fix access first, or pass --force.`); }
    const next = writeRegistry({...reg, devices: [...reg.devices, {id, name: typeof flags.name === 'string' ? flags.name : id, role: typeof flags.role === 'string' ? flags.role : undefined, group: typeof flags.group === 'string' ? flags.group : 'agent', connect: {type: 'ssh', host, shell}, tailnet: list(flags.tailnet)}]});
    if (!next.devices.some(d => d.id === id)) die('rejected: id must be lowercase letters/digits/dashes and host a plain SSH host alias');
    console.log(`added ${id}` + (reading ? ` · ${reading.platform} · ${reading.disks.map(x => `${x.label} ${x.pct}%`).join(', ')}` : ' (no live reading yet)'));
    break;
  }
  case 'remove': {
    const id = String(pos[0] || '').toLowerCase();
    if (!reg.devices.some(d => d.id === id)) die(`no device "${id}"`);
    writeRegistry({...reg, devices: reg.devices.filter(d => d.id !== id)});
    console.log(`removed ${id}`);
    break;
  }
  case 'this': {
    writeRegistry({...reg, this: {name: typeof flags.name === 'string' ? flags.name : reg.this.name, role: typeof flags.role === 'string' ? flags.role : reg.this.role, tailnet: list(flags.tailnet) ?? reg.this.tailnet}});
    console.log('updated this device');
    break;
  }
  case 'hide': case 'unhide': {
    const n = String(pos[0] || '').toLowerCase(); if (!n) die(`usage: wizard-devices ${cmd} <tailnet-name>`);
    const hide = new Set(reg.hide); cmd === 'hide' ? hide.add(n) : hide.delete(n);
    writeRegistry({...reg, hide: [...hide]});
    console.log(`${cmd} ${n}`);
    break;
  }
  case 'probe': {
    const id = String(pos[0] || 'this');
    const d = reg.devices.find(x => x.id === id);
    if (id !== 'this' && !d) die(`no device "${id}"`);
    console.log(JSON.stringify(id === 'this' ? await probeLocal() : await probeSsh(d.connect.host, d.connect.shell), null, 2));
    break;
  }
  case 'group': {
    const n = String(pos[0] || '').toLowerCase(), g = String(pos[1] || '');
    if (!n || !['human', 'client', 'other', 'clear'].includes(g)) die('usage: wizard-devices group <tailnet-name> <human|client|other|clear>');
    const groups = {...reg.groups}; if (g === 'clear') delete groups[n]; else groups[n] = g;
    writeRegistry({...reg, groups});
    console.log(`${n} -> ${g}`);
    break;
  }
  default: die('commands: list | add | remove | this | hide | unhide | probe | group');
}
