// Wizard OS devices: every machine this Wizard runs on or has been given access to, with live readings.
// Spec: wizard-os/spec/DEVICES.md.
//
//  - "this" device is always present: the box the Wizard is installed on, read locally.
//  - Other devices come from the registry file (~/.wizard-os/devices.json). The agent adds them
//    with `wizard-devices add <id> --ssh <host>` once it has working access; nothing is hard-coded.
//  - When Tailscale is available, every tailnet node is listed with its online light, so the owner
//    sees the machines the Wizard could be given next (like the Tailscale admin list).
//
// Read-only. Probes run one fixed POSIX script over `ssh -T <host> sh -s`; the host value is validated
// and passed as an argv item, never through a shell. Output is parsed into an allowlisted numeric shape.
import {spawn} from 'node:child_process';
import {readFileSync, existsSync, writeFileSync, renameSync, copyFileSync, mkdirSync} from 'node:fs';
import {homedir, hostname} from 'node:os';
import {join, dirname, basename} from 'node:path';

export const REGISTRY_PATH = () => process.env.WIZARD_DEVICES_FILE || join(homedir(), '.wizard-os', 'devices.json');
const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HOST_RE = /^(?!-)[A-Za-z0-9._@:-]{1,253}$/;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
const GiB = 1024 ** 3;
// agent = machines the Wizard reads and runs work on; human = the owner's own devices; client = Wizards run for clients.
export const GROUPS = new Set(['agent', 'human', 'client', 'other']);
// What an agent device does for the Wizard on the owner's Machines map (main is always "this").
export const USES = new Set(['standby', 'helper']);
export const peerGroup = (os, name, reg) => reg.groups[String(name).toLowerCase()] || (/^(ios|android|macos|ipados)$/i.test(os || '') ? 'human' : 'other');

// ---------- registry ----------
export function cleanRegistry(raw) {
  const j = raw && typeof raw === 'object' ? raw : {};
  const names = v => (Array.isArray(v) ? v : []).map(x => clip(x, 64).toLowerCase()).filter(Boolean).slice(0, 8);
  const thisBox = {name: clip(j.this?.name, 40) || null, role: clip(j.this?.role, 60) || null, tailnet: names(j.this?.tailnet), ...(clip(j.this?.wizard, 40) ? {wizard: clip(j.this.wizard, 40)} : {}), ...(clip(j.this?.owner, 40) ? {owner: clip(j.this.owner, 40)} : {})};
  const seen = new Set(['this']), devices = [];
  for (const d of Array.isArray(j.devices) ? j.devices : []) {
    const id = clip(d?.id, 32).toLowerCase();
    if (!ID_RE.test(id) || seen.has(id)) continue;
    const c = d.connect || {};
    if (c.type !== 'ssh' || !HOST_RE.test(String(c.host || ''))) continue;
    seen.add(id);
    devices.push({id, name: clip(d.name, 40) || id, role: clip(d.role, 60) || null, group: GROUPS.has(d.group) ? d.group : 'agent', ...(USES.has(d.use) ? {use: d.use} : {}), connect: {type: 'ssh', host: String(c.host), ...(c.shell === 'powershell' ? {shell: 'powershell'} : {})}, tailnet: names(d.tailnet)});
    if (devices.length >= 24) break;
  }
  // Tailnet machines the Wizard does not read: which group the owner sees them under (human / client / other).
  const groups = {};
  for (const [k, v] of Object.entries(j.groups && typeof j.groups === 'object' ? j.groups : {}).slice(0, 100)) { const n = clip(k, 64).toLowerCase(); if (n && GROUPS.has(v)) groups[n] = v; }
  // Wizards the owner looks after on other boxes (the Machines workspace switcher): what is known, never probed.
  // Who uses a managed Wizard: names the owner wrote down and/or a head count. Shown beside its Main, never probed.
  const managedPeople = m => {
    const people = (Array.isArray(m.people) ? m.people : []).map(n => clip(n, 40)).filter(Boolean).slice(0, 24);
    const n = Number(m.peopleCount), count = Number.isInteger(n) && n > people.length && n <= 999 ? n : 0;
    return {...(people.length ? {people} : {}), ...(count ? {peopleCount: count} : {})};
  };
  const managed = [], mseen = new Set();
  for (const m of Array.isArray(j.managed) ? j.managed : []) {
    const id = clip(m?.id, 32).toLowerCase(), name = clip(m?.name, 40);
    if (!ID_RE.test(id) || !name || mseen.has(id)) continue;
    mseen.add(id);
    const where = clip(m.where, 120), peer = clip(m.peer, 64).toLowerCase();
    managed.push({id, name, ...(clip(m.org, 60) ? {org: clip(m.org, 60)} : {}), ...(/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(where) ? {where} : {}), ...(peer ? {peer, peerName: clip(m.peerName, 40) || peer} : {}), ...managedPeople(m)});
    if (managed.length >= 12) break;
  }
  return {version: 1, this: thisBox, devices, hide: names(j.hide), groups, ...(managed.length ? {managed} : {})};
}
export function readRegistry(path = REGISTRY_PATH()) {
  try { return cleanRegistry(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (e) { if (e.code !== 'ENOENT') console.error('devices registry unreadable:', e.message); return cleanRegistry({}); }
}
export function writeRegistry(reg, path = REGISTRY_PATH()) {
  const clean = cleanRegistry(reg);
  mkdirSync(dirname(path), {recursive: true});
  if (existsSync(path)) copyFileSync(path, path + '.bak');
  const tmp = path + '.tmp-' + process.pid;
  writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n', {mode: 0o600});
  renameSync(tmp, path);
  return clean;
}

// ---------- probe ----------
// One script for Linux and macOS. Prints key=value lines; df rows as disk=<fs>|<1k-blocks>|<used>|<avail>|<mount>.
export const PROBE = String.raw`
LC_ALL=C; export LC_ALL
os=$(uname -s); echo "os=$os"
if [ "$os" = Darwin ]; then
  echo "cpus=$(sysctl -n hw.ncpu)"
  echo "memtotal=$(sysctl -n hw.memsize)"
  ps_=$(sysctl -n hw.pagesize)
  vm_stat | awk -v ps="$ps_" '/^Pages active/{a=$3}/^Pages wired down/{w=$4}/occupied by compressor/{c=$5}END{gsub(/\./,"",a);gsub(/\./,"",w);gsub(/\./,"",c);printf "memused=%.0f\n",(a+w+c)*ps}'
  top -l 2 -n 0 -s 1 | awk '/^CPU usage/{for(i=1;i<=NF;i++) if($(i+1) ~ /^idle/) {v=$i}}END{gsub(/%/,"",v); if(v!="") print "cpuidle=" v}'
  bt=$(sysctl -n kern.boottime | sed 's/^[^0-9]*\([0-9]*\).*/\1/'); echo "uptime=$(( $(date +%s) - bt ))"
else
  echo "cpus=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc)"
  awk '/^MemTotal:/{t=$2}/^MemAvailable:/{a=$2}END{printf "memtotal=%.0f\nmemused=%.0f\n",t*1024,(t-a)*1024}' /proc/meminfo
  a=$(head -1 /proc/stat); sleep 1; b=$(head -1 /proc/stat)
  echo "$a
$b" | awk '{i=$5+$6; t=0; for(k=2;k<=NF;k++) t+=$k; if(NR==1){i0=i;t0=t}else{dt=t-t0; if(dt>0) printf "cpuidle=%.1f\n",(i-i0)*100/dt}}'
  echo "uptime=$(cut -d. -f1 /proc/uptime)"
fi
df -kP 2>/dev/null | awk 'NR>1{m=$6; for(i=7;i<=NF;i++) m=m" "$i; print "disk="$1"|"$2"|"$3"|"$4"|"m}'
`;

// Windows (OpenSSH default shell is cmd): the same key=value shape from PowerShell, read from stdin.
export const PROBE_WIN = String.raw`
$ErrorActionPreference='SilentlyContinue'
$cs=Get-CimInstance Win32_ComputerSystem; $os=Get-CimInstance Win32_OperatingSystem
"os=Windows"
"cpus=$($cs.NumberOfLogicalProcessors)"
"memtotal=$([int64]$os.TotalVisibleMemorySize*1024)"
"memused=$(([int64]$os.TotalVisibleMemorySize-[int64]$os.FreePhysicalMemory)*1024)"
$l=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
if($l -ne $null){"cpuidle=$(100-$l)"}
"uptime=$([int64]((Get-Date)-$os.LastBootUpTime).TotalSeconds)"
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { "wdisk=$($_.DeviceID)|$($_.Size)|$($_.FreeSpace)" }
`;

const LINUX_SKIP = /^\/(boot|snap|run|dev|sys|proc|var\/lib\/(docker|containers|kubelet)|var\/snap)(\/|$)/;
export function parseProbe(text) {
  const kv = {}, rows = [], wrows = [];
  for (const line of String(text).split('\n').slice(0, 400)) {
    const i = line.indexOf('='); if (i < 1) continue;
    const k = line.slice(0, i), v = line.slice(i + 1).trim();
    if (k === 'disk') rows.push(v.split('|')); else if (k === 'wdisk') wrows.push(v.split('|')); else kv[k] = v;
  }
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const mac = kv.os === 'Darwin', linux = kv.os === 'Linux', win = kv.os === 'Windows';
  if (!mac && !linux && !win) throw new Error('unsupported platform');
  const disks = [], devs = new Set();
  for (const [drive, sizeS, freeS] of win ? wrows : []) {
    const size = num(sizeS), av = num(freeS);
    if (!/^[A-Z]:$/.test(String(drive)) || !(size >= GiB) || !Number.isFinite(av)) continue;
    disks.push({label: drive === 'C:' ? 'System disk' : clip(drive, 4), mount: clip(drive, 4), usedGB: Math.round((size - av) / GiB), sizeGB: Math.round(size / GiB), freeGB: Math.round(av / GiB), pct: Math.round((size - av) / size * 100)});
  }
  for (const [fs, blocks, used, avail, ...rest] of rows) {
    const mount = rest.join('|'), size = num(blocks) * 1024, av = num(avail) * 1024, us = num(used) * 1024;
    if (!fs?.startsWith('/dev/') || !mount || !(size >= GiB) || !Number.isFinite(av)) continue;
    let label;
    if (mac) {
      // APFS volumes share one container: the Data volume shows the real fill of the internal disk.
      if (mount === '/System/Volumes/Data') label = 'Internal disk';
      else if (mount.startsWith('/Volumes/') && !/^\/Volumes\/(Recovery|Preboot|VM|Update|com\.apple)/.test(mount)) label = basename(mount);
      else continue;
    } else {
      if (fs.startsWith('/dev/loop') || LINUX_SKIP.test(mount)) continue;
      label = mount === '/' ? 'System disk' : basename(mount);
    }
    if (devs.has(fs)) continue; devs.add(fs);
    // Linux reserves root blocks, so fill = used/(used+avail) (what df and Runtipi report); APFS = (size-avail)/size.
    const usedB = mac ? size - av : us, total = mac ? size : us + av;
    disks.push({label: clip(label, 40), mount: clip(mount, 120), usedGB: Math.round(usedB / GiB), sizeGB: Math.round((mac ? size : size) / GiB), freeGB: Math.round(av / GiB), pct: total > 0 ? Math.round(usedB / total * 100) : null});
  }
  disks.sort((a, b) => (b.label === 'Internal disk' || b.label === 'System disk') - (a.label === 'Internal disk' || a.label === 'System disk'));
  if (mac && !disks.some(d => d.label === 'Internal disk')) {
    const root = rows.find(r => r.slice(4).join('|') === '/');
    if (root) { const size = num(root[1]) * 1024, av = num(root[3]) * 1024; if (size >= GiB) disks.unshift({label: 'Internal disk', mount: '/', usedGB: Math.round((size - av) / GiB), sizeGB: Math.round(size / GiB), freeGB: Math.round(av / GiB), pct: Math.round((size - av) / size * 100)}); }
  }
  const memTotal = num(kv.memtotal), memUsed = num(kv.memused), idle = num(kv.cpuidle);
  const pct = v => v == null ? null : Math.max(0, Math.min(100, Math.round(v)));
  return {
    platform: mac ? 'macos' : win ? 'windows' : 'linux',
    cpus: num(kv.cpus),
    cpu: idle == null ? null : pct(100 - idle),
    memory: memTotal && memUsed != null ? pct(memUsed / memTotal * 100) : null,
    memoryTotalGB: memTotal ? Math.round(memTotal / GiB) : null,
    memoryUsedGB: memTotal && memUsed != null ? Math.round(memUsed / GiB) : null,
    uptimeSec: num(kv.uptime),
    disks: disks.slice(0, 8),
  };
}

function run(cmd, args, {input = '', timeoutMs = 9000, max = 65536} = {}) {
  return new Promise((resolve, reject) => {
    let out = '', err = '', done = false;
    const p = spawn(cmd, args, {stdio: ['pipe', 'pipe', 'pipe']});
    const t = setTimeout(() => { if (!done) { done = true; p.kill('SIGKILL'); reject(new Error('timed out')); } }, timeoutMs);
    p.stdout.on('data', d => { out += d; if (out.length > max) p.kill('SIGKILL'); });
    p.stderr.on('data', d => { if (err.length < 4096) err += d; });
    p.on('error', e => { if (!done) { done = true; clearTimeout(t); reject(e); } });
    p.on('close', code => { if (done) return; done = true; clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').pop() || 'exit ' + code)); });
    p.stdin.on('error', () => {}); p.stdin.end(input);
  });
}
export const probeLocal = () => run('sh', ['-s'], {input: PROBE}).then(parseProbe);
export function probeSsh(host, shell) {
  if (!HOST_RE.test(host)) return Promise.reject(new Error('invalid host'));
  const remote = shell === 'powershell' ? 'powershell -NoProfile -NonInteractive -Command -' : 'sh -s';
  return run('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', '-o', 'ServerAliveInterval=5', '--', host, remote], {input: shell === 'powershell' ? PROBE_WIN : PROBE, timeoutMs: 20000}).then(t => parseProbe(String(t).replace(/\r/g, '')));
}

// ---------- tailnet ----------
const TS_BINS = () => [process.env.WIZARD_TAILSCALE_BIN, 'tailscale', join(homedir(), '.local/bin/tailscale'), '/usr/bin/tailscale', '/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'].filter(Boolean);
const TS_SOCKETS = () => [process.env.WIZARD_TAILSCALE_SOCKET, null, process.getuid ? `/run/user/${process.getuid()}/tailscale/tailscaled.sock` : null].filter((v, i, a) => a.indexOf(v) === i);
let tsRoute = null;
export async function tailnetStatus() {
  const routes = tsRoute ? [tsRoute] : TS_BINS().flatMap(bin => TS_SOCKETS().map(sock => ({bin, sock})));
  for (const r of routes) {
    try {
      const args = r.sock ? ['--socket=' + r.sock, 'status', '--json'] : ['status', '--json'];
      const j = JSON.parse(await run(r.bin, args, {timeoutMs: 4000, max: 2_000_000}));
      if (!j?.Self) continue;
      tsRoute = r;
      const peer = p => ({name: clip(p.HostName, 64), dns: clip(String(p.DNSName || '').split('.')[0], 64).toLowerCase(), os: clip(p.OS, 16), online: !!p.Online, lastSeen: p.LastSeen && !p.LastSeen.startsWith('0001') ? p.LastSeen : null});
      return {self: peer({...j.Self, Online: true}), peers: Object.values(j.Peer || {}).map(peer).slice(0, 100)};
    } catch { if (tsRoute) { tsRoute = null; } }
  }
  return null;
}

// ---------- assembly ----------
const pretty = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
export function createDevicesReader({registryPath, probeLocalImpl = probeLocal, probeSshImpl = probeSsh, tailnetImpl = tailnetStatus, now = Date.now, ttlMs = 25000} = {}) {
  const cache = new Map(); // id -> {at, data, error, pending}
  async function reading(key, fn) {
    let c = cache.get(key); if (!c) cache.set(key, c = {at: 0, data: null, error: null, pending: null, okAt: 0});
    if (now() - c.at < ttlMs) return c;
    if (!c.pending) c.pending = fn().then(d => { c.data = d; c.error = null; c.okAt = now(); }, e => { c.error = clip(e.message, 120) || 'unavailable'; }).finally(() => { c.at = now(); c.pending = null; });
    await c.pending;
    return c;
  }
  return async () => {
    const reg = readRegistry(registryPath);
    const [tn, local, ...remote] = await Promise.all([
      reading('_tailnet', async () => { const t = await tailnetImpl(); if (!t) throw new Error('no tailnet'); return t; }),
      reading('this', probeLocalImpl),
      ...reg.devices.map(d => reading('ssh:' + d.connect.host, () => probeSshImpl(d.connect.host, d.connect.shell))),
    ]);
    const net = tn.data;
    const matchKeys = (d, extra = []) => new Set([d.id, d.name, d.connect?.host, ...d.tailnet, ...extra].filter(Boolean).map(s => String(s).toLowerCase().split('.')[0]));
    const findPeer = keys => net?.peers.find(p => keys.has(p.name.toLowerCase()) || keys.has(p.dns));
    const used = new Set();
    const shape = (base, c, peer) => {
      const fresh = c.data && !c.error;
      const status = fresh ? 'online' : c.data ? (peer && !peer.online ? 'offline' : 'stale') : peer && !peer.online ? 'offline' : c.error ? (peer?.online ? 'unreachable' : 'offline') : 'connecting';
      return {...base, status, error: c.error && !fresh ? c.error : null, readAt: c.okAt ? new Date(c.okAt).toISOString() : null, lastSeen: !fresh && peer?.lastSeen ? peer.lastSeen : null, ...(c.data || {platform: null, cpu: null, memory: null, memoryTotalGB: null, disks: []})};
    };
    const thisKeys = new Set([...reg.this.tailnet, net?.self.name.toLowerCase(), net?.self.dns].filter(Boolean));
    thisKeys.forEach(k => used.add(k));
    const devices = [shape({id: 'this', kind: 'this', group: 'agent', name: reg.this.name || pretty(net?.self.name) || pretty(hostname().split('.')[0]), role: reg.this.role || 'Wizard runs here'}, local, null)];
    reg.devices.forEach((d, i) => {
      const peer = findPeer(matchKeys(d)); if (peer) used.add(peer.name.toLowerCase());
      devices.push(shape({id: d.id, kind: 'ssh', group: d.group, name: d.name, role: d.role, ...(d.use ? {use: d.use} : {})}, remote[i], peer));
    });
    const hide = new Set(reg.hide);
    const network = net ? {available: true, peers: net.peers.filter(p => !used.has(p.name.toLowerCase()) && !used.has(p.dns) && !hide.has(p.name.toLowerCase()) && !hide.has(p.dns)).map(({name, dns, os, online, lastSeen}) => ({name, os, online, lastSeen: online ? null : lastSeen, group: peerGroup(os, reg.groups[dns] ? dns : name, reg)})).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name))} : {available: false, peers: []};
    const managed = (reg.managed || []).map(m => { const p = m.peer && net?.peers.find(x => x.name.toLowerCase() === m.peer || x.dns === m.peer); return {...m, ...(m.peer ? {peerOnline: p ? !!p.online : null} : {})}; });
    const me = {...(reg.this?.wizard ? {wizard: reg.this.wizard} : {}), ...(reg.this?.owner ? {owner: reg.this.owner} : {})};
    return {at: new Date(now()).toISOString(), devices, network, ...(Object.keys(me).length ? {this: me} : {}), ...(managed.length ? {managed} : {})};
  };
}
