import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {parseProbe,cleanRegistry,createDevicesReader} from './tools/system-devices.mjs';
import {createResourceHandler} from './tools/system-resources.mjs';

const MAC=`os=Darwin\ncpus=10\nmemtotal=34359738368\nmemused=22548578304\ncpuidle=40.5\nuptime=388000
disk=/dev/disk3s1s1|239362496|12348620|9994252|/
disk=/dev/disk3s6|239362496|10486460|9994252|/System/Volumes/VM
disk=/dev/disk3s5|239362496|197865956|9994252|/System/Volumes/Data
disk=/dev/disk5s1|3219456|3098224|107784|/private/var/run/com.apple.security.cryptexd/mnt/x
disk=/dev/disk7s1|1953276972|1309598260|643385900|/Volumes/Media Drive`;
const LINUX=`os=Linux\ncpus=8\nmemtotal=33000000000\nmemused=14000000000\ncpuidle=80\nuptime=100
disk=/dev/sda1|405196772|257038268|148142120|/
disk=/dev/sda15|106858|6182|100676|/boot/efi
disk=/dev/loop3|65536|65536|0|/snap/core/1
disk=tmpfs|1000000000|0|1000000000|/dev/shm
disk=/dev/sdb1|1048576000|524288000|524288000|/srv/data`;

test('macOS probe: APFS Data volume is the internal disk; external volumes keep their names',()=>{const r=parseProbe(MAC);assert.equal(r.platform,'macos');assert.equal(r.cpu,60);assert.equal(r.memory,66);assert.deepEqual(r.disks.map(d=>d.label),['Internal disk','Media Drive']);assert.equal(r.disks[0].pct,96);assert.equal(r.disks[0].freeGB,10);assert.equal(r.disks[1].mount,'/Volumes/Media Drive');});
test('Linux probe: root and real data disks only, df-style fill',()=>{const r=parseProbe(LINUX);assert.deepEqual(r.disks.map(d=>d.label),['System disk','data']);assert.equal(r.disks[0].pct,63);assert.equal(r.disks[0].usedGB,245);assert.equal(r.disks[0].sizeGB,386);});
test('Unknown platform is refused',()=>assert.throws(()=>parseProbe('os=Plan9')));
test('Registry drops unsafe hosts, bad ids and duplicates',()=>{const r=cleanRegistry({devices:[{id:'ok',connect:{type:'ssh',host:'box'}},{id:'ok',connect:{type:'ssh',host:'box2'}},{id:'x',connect:{type:'ssh',host:'-oProxyCommand=evil'}},{id:'Bad Id',connect:{type:'ssh',host:'h'}},{id:'y',connect:{type:'http',host:'h'}},{id:'this',connect:{type:'ssh',host:'h'}}]});assert.deepEqual(r.devices.map(d=>d.id),['ok']);});

test('Reader: this box always first, registered machines matched to tailnet, rest listed with lights',async()=>{
  const fs=await import('node:fs');const path=process.env.TMPDIR+'/qa-devices-'+process.pid+'.json';
  fs.writeFileSync(path,JSON.stringify({this:{tailnet:['gw']},devices:[{id:'bravo',name:'Bravo',connect:{type:'ssh',host:'bravo'}},{id:'charlie',name:'Charlie',connect:{type:'ssh',host:'charlie'}}],hide:['printer']}));
  const tail={self:{name:'alpha',dns:'alpha',os:'linux',online:true},peers:[{name:'bravo',dns:'bravo',os:'macOS',online:true},{name:'charlie',dns:'charlie',os:'linux',online:false,lastSeen:'2026-10-13T00:00:00Z'},{name:'gw',dns:'gw',os:'linux',online:true},{name:'printer',dns:'printer',os:'linux',online:true},{name:'Phone',dns:'phone',os:'android',online:true}]};
  const read=createDevicesReader({registryPath:path,probeLocalImpl:async()=>parseProbe(LINUX),probeSshImpl:async h=>{if(h==='charlie')throw new Error('timed out');return parseProbe(MAC);},tailnetImpl:async()=>tail});
  const j=await read();fs.unlinkSync(path);
  assert.deepEqual(j.devices.map(d=>[d.id,d.status]),[['this','online'],['bravo','online'],['charlie','offline']]);
  assert.equal(j.devices[0].name,'Alpha');assert.equal(j.devices[2].lastSeen,'2026-10-13T00:00:00Z');
  assert.deepEqual(j.network.peers.map(p=>p.name),['Phone']);
  assert.equal(JSON.stringify(j).includes('100.'),false);
});
test('Default install: no registry file gives only this box',async()=>{const read=createDevicesReader({registryPath:'/nonexistent/devices.json',probeLocalImpl:async()=>parseProbe(LINUX),tailnetImpl:async()=>null});const j=await read();assert.equal(j.devices.length,1);assert.equal(j.network.available,false);});

test('Devices route: identity required, read-only, generic failure',async()=>{let calls=0;const s=http.createServer(createResourceHandler(async()=>({}),async()=>{calls++;if(calls>1)throw new Error('secret detail');return {devices:[]};}));await new Promise(r=>s.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+s.address().port+'/api/system/devices';
  try{assert.equal((await fetch(base)).status,403);assert.equal((await fetch(base,{method:'POST',headers:{'tailscale-user-login':'q'}})).status,405);assert.equal(calls,0);
    const ok=await fetch(base,{headers:{'tailscale-user-login':'q'}});assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');
    const bad=await fetch(base,{headers:{'tailscale-user-login':'q'}});assert.equal(bad.status,503);assert.deepEqual(await bad.json(),{error:'devices_unavailable'});}finally{await new Promise(r=>s.close(r));}});
