// Wizard OS outside check: can a stranger on the internet reach each machine, or only Tailscale?
//
// Plain code, no AI and no outside service. Every 15 minutes (and when the owner taps "Check again"):
//  1. Ask each machine for its own internet addresses: `tailscale status --json` (Self.Addrs = the public IPv4 Tailscale
//     sees + global IPv6) plus the global IPv6 the OS holds, and which TCP ports it listens on beyond loopback.
//  2. For each machine pick a vantage on a DIFFERENT network (another machine of this Wizard whose public IPv4 and IPv6
//     /64 differ). Two machines behind the same home router can't judge each other: the router lets local traffic in.
//  3. From the vantage, try a TCP connect to every listening port plus a fixed list of common ones, IPv4 and IPv6.
//     Any answer = open to the internet. Silence or refusal on all of them = Tailscale only.
// Results go to ~/.wizard-os/exposure.json; /api/system/devices shows them as each machine's `access`.
// A machine with no other-network machine to test from stays "unchecked" (never guessed).
// When a machine newly opens up, one notification goes to the owner's Notifications app (if installed).
import net from 'node:net';
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, renameSync, mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, dirname} from 'node:path';
import {readRegistry} from './system-devices.mjs';

export const EXPOSURE_PATH = () => process.env.WIZARD_EXPOSURE_FILE || join(homedir(), '.wizard-os', 'exposure.json');
export const EVERY_MIN = () => Math.max(5, Number(process.env.WIZARD_EXPOSURE_EVERY_MIN) || 15);
const HOST_RE = /^(?!-)[A-Za-z0-9._@:-]{1,253}$/;
// Common ways in, named in plain words. Port 25 is left out: home ISPs answer it themselves, so it lies.
export const COMMON = {21: 'FTP', 22: 'SSH', 23: 'Telnet', 80: 'Web', 135: 'Windows RPC', 139: 'Windows file sharing', 443: 'Web (HTTPS)', 445: 'Windows file sharing',
  1433: 'SQL Server', 2222: 'SSH', 3000: 'Web app', 3306: 'MySQL', 3389: 'Remote Desktop', 5000: 'Web app', 5432: 'PostgreSQL', 5900: 'Screen sharing (VNC)',
  5985: 'Windows remote management', 6379: 'Redis', 7070: 'AnyDesk', 7680: 'Windows Update sharing', 8000: 'Web app', 8080: 'Web app', 8443: 'Web (HTTPS)',
  8888: 'Web app', 9000: 'Web app', 11434: 'Local AI (Ollama)', 27017: 'MongoDB'};
const portName = p => COMMON[p] ? `${COMMON[p]} (port ${p})` : `port ${p}`;

// ---------- addresses ----------
const v4ok = a => { const o = a.split('.').map(Number); if (o.length !== 4 || o.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [x, y] = o; return !(x === 0 || x === 10 || x === 127 || x >= 224 || (x === 100 && y >= 64 && y < 128) || (x === 169 && y === 254) || (x === 172 && y >= 16 && y < 32) || (x === 192 && y === 168)); };
const v6ok = a => /^[0-9a-f:]+$/i.test(a) && a.includes(':') && /^[23]/i.test(a) && net.isIPv6(a);  // global unicast 2000::/3 only
export const isPublic = a => net.isIPv4(a) ? v4ok(a) : v6ok(a);
const prefix64 = a => { const parts = a.toLowerCase().split('::'); const head = parts[0].split(':').filter(Boolean), tail = parts.length > 1 ? parts[1].split(':').filter(Boolean) : [];
  const full = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]; return full.slice(0, 4).map(x => x.replace(/^0+(?=.)/, '')).join(':'); };

// One script per platform: prints ts=<tailscale status json, one line>, v6=<addr> and listen=<port> lines.
export const ADDR_SH = String.raw`
LC_ALL=C; export LC_ALL
for t in tailscale /usr/bin/tailscale /usr/local/bin/tailscale "$HOME/.local/bin/tailscale" /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
  if command -v "$t" >/dev/null 2>&1; then j=$("$t" status --json --peers=false 2>/dev/null | tr -d '\n'); [ -n "$j" ] && { echo "ts=$j"; break; }; fi
done
if command -v ip >/dev/null 2>&1; then ip -6 -o addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print "v6=" a[1]}'; fi
if command -v ss >/dev/null 2>&1; then ss -ltnH 2>/dev/null | awk '{n=split($4,a,":"); h=substr($4,1,length($4)-length(a[n])-1); if (h !~ /^(127\.|\[::1\]|\[::ffff:127\.)/) print "listen=" a[n]}'
elif command -v netstat >/dev/null 2>&1; then netstat -an -p tcp 2>/dev/null | awk '/LISTEN/{n=split($4,a,"."); if ($4 !~ /^127\./) print "listen=" a[n]}'; fi
`;
export const ADDR_PS = String.raw`
$ErrorActionPreference='SilentlyContinue'
$t=(Get-Command tailscale -EA 0).Source; if(-not $t){$t="$env:ProgramFiles\Tailscale\tailscale.exe"}
if(Test-Path $t){ $j=(& $t status --json --peers=false) -join ''; if($j){"ts=$j"} }
Get-NetIPAddress -AddressFamily IPv6 | ? { $_.AddressState -eq 'Preferred' -and $_.IPAddress -match '^[23]' } | % { "v6=$($_.IPAddress)" }
Get-NetTCPConnection -State Listen | ? { $_.LocalAddress -notmatch '^(127\.|::1$)' } | % { "listen=$($_.LocalPort)" }
`;
export function parseAddrs(text) {
  const v4 = new Set(), v6 = new Set(), listen = new Set(); let ts = false;
  for (const line of String(text).replace(/\r/g, '').split('\n').slice(0, 2000)) {
    const i = line.indexOf('='); if (i < 1) continue;
    const k = line.slice(0, i), v = line.slice(i + 1).trim();
    if (k === 'ts') { try { const j = JSON.parse(v); ts = true;
      for (const e of j?.Self?.Addrs || []) { const m = /^\[?([0-9a-fA-F:.]+?)\]?:\d+$/.exec(String(e)); if (m && isPublic(m[1])) (net.isIPv4(m[1]) ? v4 : v6).add(m[1].toLowerCase()); } } catch {} }
    else if (k === 'v6' && isPublic(v)) v6.add(v.toLowerCase());
    else if (k === 'listen') { const p = Number(v); if (Number.isInteger(p) && p > 0 && p < 65536) listen.add(p); }
  }
  return {v4: [...v4].slice(0, 4), v6: [...v6].slice(0, 6), listen: [...listen].sort((a, b) => a - b).slice(0, 80), tailscale: ts};
}

// ---------- knocking ----------
function run(cmd, args, {input = '', timeoutMs = 30000, max = 2_000_000} = {}) {
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
const sshArgs = (host, shell) => ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=5', '--', host, shell === 'powershell' ? 'powershell -NoProfile -NonInteractive -Command -' : 'sh -s'];
const safeTarget = ({addr, port}) => isPublic(addr) && Number.isInteger(port) && port > 0 && port < 65536;
// Knock scripts take only validated IP literals and integers, so nothing the network says reaches a shell unquoted.
export const knockSh = targets => `LC_ALL=C; export LC_ALL
if command -v bash >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1; then
for t in ${targets.filter(safeTarget).map(t => `${t.addr},${t.port}`).join(' ')}; do a=\${t%,*}; p=\${t##*,}; ( timeout 4 bash -c "exec 3<>/dev/tcp/$a/$p" 2>/dev/null && echo "open=$a|$p" ) & done
wait; echo ok=1; fi
`;
export const knockPs = targets => `$ErrorActionPreference='SilentlyContinue'
$k=@(${targets.filter(safeTarget).map(t => `'${t.addr}|${t.port}'`).join(',')})
$js=foreach($x in $k){ $a,$p=$x.Split('|'); $ip=[Net.IPAddress]::Parse($a); $c=New-Object Net.Sockets.TcpClient($ip.AddressFamily); @{c=$c;t=$c.ConnectAsync($ip,[int]$p);x=$x} }
$end=(Get-Date).AddSeconds(4)
foreach($j in $js){ $ms=[Math]::Max(0,[int](($end-(Get-Date)).TotalMilliseconds)); try{ if($j.t.Wait($ms) -and $j.c.Connected){"open=$($j.x)"} }catch{}; $j.c.Close() }
"ok=1"
`;
const parseKnock = text => { const s = String(text).replace(/\r/g, ''); if (!/^ok=1$/m.test(s)) throw new Error('vantage could not test');
  return [...s.matchAll(/^open=([0-9a-fA-F:.]+)\|(\d+)$/gm)].map(m => ({addr: m[1].toLowerCase(), port: Number(m[2])})); };
export function knockLocal(targets, timeoutMs = 4000) {
  return Promise.all(targets.filter(safeTarget).map(t => new Promise(resolve => {
    const s = net.connect({host: t.addr, port: t.port}); let done = false;
    const end = ok => { if (done) return; done = true; s.destroy(); resolve(ok ? t : null); };
    s.setTimeout(timeoutMs, () => end(false)); s.once('connect', () => end(true)); s.once('error', () => end(false));
  }))).then(r => r.filter(Boolean));
}

// ---------- the check ----------
const defaultMachines = reg => [{id: 'this', name: reg.this.name || 'This Wizard', local: true},
  ...reg.devices.filter(d => HOST_RE.test(d.connect.host)).map(d => ({id: d.id, name: d.name, host: d.connect.host, shell: d.connect.shell || 'sh'}))];
export const readAddrs = m => m.local ? run('sh', ['-s'], {input: ADDR_SH, timeoutMs: 15000}).then(parseAddrs)
  : run('ssh', sshArgs(m.host, m.shell), {input: m.shell === 'powershell' ? ADDR_PS : ADDR_SH, timeoutMs: 30000}).then(parseAddrs);
export const knockFrom = (v, targets) => v.local ? knockLocal(targets)
  : run('ssh', sshArgs(v.host, v.shell), {input: v.shell === 'powershell' ? knockPs(targets) : knockSh(targets), timeoutMs: 60000}).then(parseKnock);

// Same network = shares a public IPv4 or an IPv6 /64. Such a pair can't judge each other.
export const sameNetwork = (a, b) => a.v4.some(x => b.v4.includes(x)) || a.v6.some(x => b.v6.map(prefix64).includes(prefix64(x)));
export function plan(machines) {
  const jobs = new Map(), out = {};  // vantage id -> [{addr, port, target}]
  for (const t of machines) {
    if (!t.addrs) { out[t.id] = {reason: 'offline'}; continue; }
    const fams = {v4: t.addrs.v4, v6: t.addrs.v6}, tested = {}, by = {};
    if (!fams.v4.length && !fams.v6.length) { out[t.id] = {reason: 'no-address'}; continue; }
    const ports = [...new Set([...t.addrs.listen, ...Object.keys(COMMON).map(Number)])].sort((a, b) => a - b).slice(0, 96);
    for (const f of ['v4', 'v6']) {
      if (!fams[f].length) continue;
      const v = machines.find(o => o !== t && o.addrs && o.addrs[f].length && !sameNetwork(o.addrs, t.addrs));
      if (!v) { tested[f] = false; continue; }
      tested[f] = true; by[f] = v.id;
      const list = jobs.get(v.id) || []; jobs.set(v.id, list);
      for (const addr of fams[f]) for (const port of ports) list.push({addr, port, target: t.id, fam: f});
    }
    out[t.id] = {tested, by, ports};
  }
  return {jobs, out};
}
const famWords = fams => fams.length === 2 ? 'IPv4 and IPv6' : fams[0] === 'v4' ? 'IPv4' : 'IPv6';
export function verdict(t, p, opens, names) {
  if (p.reason === 'offline') return null;  // keep the last result; an offline machine isn't news
  if (p.reason === 'no-address') return {exposure: 'unchecked', details: ['Couldn’t find its internet address to test']};
  const famsT = Object.keys(p.tested).filter(f => p.tested[f]), famsU = Object.keys(p.tested).filter(f => !p.tested[f]);
  const mine = opens.filter(o => o.target === t.id);
  if (mine.length) {
    const byPort = new Map(); for (const o of mine) { const s = byPort.get(o.port) || new Set(); s.add(o.fam); byPort.set(o.port, s); }
    const lines = [...byPort].sort((a, b) => a[0] - b[0]).slice(0, 5).map(([port, f]) => `${portName(port)} answers from the internet over ${famWords([...f].sort())}`);
    return {exposure: 'internet', open: [...byPort.keys()].sort((a, b) => a - b), details: lines};
  }
  if (!famsT.length) return {exposure: 'unchecked', details: ['Needs another machine on a different network to test it from outside']};
  const from = [...new Set(famsT.map(f => names[p.by[f]] || p.by[f]))].join(' and ');
  const lines = [`Nothing answers from the internet over ${famWords(famsT)} (${p.ports.length} ports, tested from ${from})`];
  if (famsU.length) lines.push(`${famWords(famsU)} not tested: no machine on another network has it`);
  return {exposure: famsU.length ? 'unchecked' : 'tailscale', details: lines};
}

export function readExposure(path = EXPOSURE_PATH()) { try { const j = JSON.parse(readFileSync(path, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
function writeExposure(j, path = EXPOSURE_PATH()) { mkdirSync(dirname(path), {recursive: true}); const tmp = path + '.tmp-' + process.pid; writeFileSync(tmp, JSON.stringify(j, null, 1) + '\n', {mode: 0o600}); renameSync(tmp, path); }

// The owner's Notifications app, found the way the App Manager finds it (apps.json `notifications` spot), MCP `notify`.
export function notificationsUrl(home = process.env.WIZARD_HOME || join(homedir(), '.wizard-os')) {
  try {
    const reg = JSON.parse(readFileSync(join(home, 'apps.json'), 'utf8'));
    let apps = (reg.apps || []).filter(a => a && (a.provides || []).includes('notifications'));
    const chosen = reg.slots?.notifications?.default; if (apps.some(a => a.id === chosen)) apps = apps.filter(a => a.id === chosen);
    return apps.map(a => a.mcp?.url).find(u => typeof u === 'string' && u.startsWith('http://127.0.0.1:')) || null;
  } catch { return null; }
}
export async function notifyOwner(title, message, {url = notificationsUrl(), fetchImpl = fetch} = {}) {
  if (!url) return false;
  try {
    const r = await fetchImpl(url, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream'}, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'notify', arguments: {title, message, priority: 'high'}}})});
    await r.text(); return r.ok;
  } catch { return false; }
}

export function createExposureChecker({registryPath, path, readAddrsImpl = readAddrs, knockImpl = knockFrom, notify = notifyOwner, machinesImpl = null, now = Date.now} = {}) {
  let pending = null, timer = null;
  async function check() {
    const reg = readRegistry(registryPath), machines = (machinesImpl || defaultMachines)(reg);
    const names = Object.fromEntries(machines.map(m => [m.id, m.name]));
    await Promise.all(machines.map(async m => { try { m.addrs = await readAddrsImpl(m); } catch { m.addrs = null; } }));
    const {jobs, out} = plan(machines), opens = [], failed = new Set();
    await Promise.all([...jobs].map(async ([vid, list]) => {
      const v = machines.find(m => m.id === vid);
      try { const hits = await knockImpl(v, list.map(({addr, port}) => ({addr, port}))); for (const h of hits) for (const l of list) if (l.addr === h.addr && l.port === h.port) opens.push(l); }
      catch { failed.add(vid); }
    }));
    for (const p of Object.values(out)) for (const f of Object.keys(p.tested || {})) if (p.tested[f] && failed.has(p.by[f])) p.tested[f] = false;
    const prev = readExposure(path), at = new Date(now()).toISOString(), result = {version: 1, at, every: EVERY_MIN(), machines: {}};
    const newlyOpen = [];
    for (const m of machines) {
      const v = verdict(m, out[m.id], opens, names), old = prev.machines?.[m.id];
      if (!v) { if (old) result.machines[m.id] = {...old, stale: true}; continue; }
      result.machines[m.id] = {...v, at};
      const wasOpen = new Set(old?.exposure === 'internet' ? old.open || [] : []);
      if (v.exposure === 'internet' && v.open.some(p => !wasOpen.has(p))) newlyOpen.push({m, v});
    }
    writeExposure(result, path);
    for (const {m, v} of newlyOpen) await notify(`${m.name} is open to the internet`, `${v.details.join('. ')}. Until it’s closed, strangers can knock on it, not just your Tailscale. Open Settings › Network & security to fix it.`);
    return result;
  }
  const checkNow = () => pending || (pending = check().finally(() => { pending = null; }));
  return {
    checkNow,
    // A recent finished check is reused instead of knocking again (the button can't be used to hammer anything).
    async checkSoon(minGapMs = 30000) { const last = Date.parse(readExposure(path).at || 0) || 0; return pending || now() - last < minGapMs ? (pending || readExposure(path)) : checkNow(); },
    start(everyMs = EVERY_MIN() * 60000, firstMs = 60000) { const tick = () => checkNow().catch(e => console.error('exposure check failed:', e.message)); timer = setTimeout(function loop() { tick(); timer = setTimeout(loop, everyMs); }, firstMs); timer.unref?.(); },
    stop() { clearTimeout(timer); },
  };
}

// Hand notes that claim what is open or closed are older than the automatic check, so they give way to it.
const HAND_EXPOSURE = /internet|answers|\bopen\b|closed|firewall|\bfix\b|from outside/i;
// The access block the Devices feed shows: automatic result first, the owner's own notes (how to get in, extra facts) kept.
export function mergeAccess(hand, auto, nowMs = Date.now()) {
  if (!auto) return hand || null;
  const at = Date.parse(auto.at), stale = auto.stale || !(nowMs - at < 3 * EVERY_MIN() * 60000);
  return {exposure: auto.exposure, checked: auto.at.slice(0, 10), checkedAt: auto.at, auto: true, ...(stale ? {stale: true} : {}),
    ...(hand?.how ? {how: hand.how} : {}), details: [...(auto.details || []), ...(hand?.details || []).filter(t => !HAND_EXPOSURE.test(t))].slice(0, 8)};
}
