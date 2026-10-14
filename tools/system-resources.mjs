// Narrow private backend adapter: Runtipi's existing system/load, numeric allowlist only.
// The private gateway authenticates the Tailnet principal and strips client-supplied identity.
// No Agent Service restart or queue ownership; no application/API writes.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createDevicesReader} from './system-devices.mjs';
export const RESOURCE_FIELDS=['cpuLoad','percentUsedMemory','percentUsed','memoryTotal','diskUsed','diskSize'];
export function readConfig(path=process.env.WIZARD_RUNTIPI_ENV_FILE||join(homedir(),'runtipi/.env')) {
  const env=Object.fromEntries(readFileSync(path,'utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
  if(!env.JWT_SECRET)throw new Error('Runtipi resource configuration unavailable');
  return {origin:`http://${env.INTERNAL_IP||'127.0.0.1'}:${env.NGINX_PORT||80}`,secret:env.JWT_SECRET};
}
export function createResourceReader({origin,secret,fetchImpl=fetch,now=Date.now}) {
  return async()=>{const n=Math.floor(now()/1000),b=j=>Buffer.from(JSON.stringify(j)).toString('base64url'),h=b({alg:'HS256',typ:'JWT'}),p=b({sub:'cli',iat:n,nbf:n,exp:n+60});const token=`${h}.${p}.${createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`;
    const r=await fetchImpl(origin+'/api/system/load',{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('Server readings unavailable');const raw=await r.text();if(raw.length>16384)throw new Error('Invalid server reading');const j=JSON.parse(raw),out={};for(const k of RESOURCE_FIELDS)out[k]=typeof j[k]==='number'&&Number.isFinite(j[k])?j[k]:null;return out;
  };
}
// /api/system/devices: every machine this Wizard runs on or can reach (wizard-os spec/DEVICES.md).
export function createResourceHandler(read,readDevices=null) {
  return async(req,res)=>{const send=(status,j)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?'':JSON.stringify(j));};
    let u;try{u=new URL(req.url,'http://localhost');}catch{return send(400,{error:'invalid_request'});}
    const devices=u.pathname==='/api/system/devices'&&readDevices;
    if(u.pathname!=='/api/system/load'&&!devices)return send(404,{error:'not_found'});
    if(!['GET','HEAD'].includes(req.method))return send(405,{error:'read_only'});
    if(!req.headers['tailscale-user-login'])return send(403,{error:'private_access_required'});
    if(req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'cross_site_refused'});
    if(devices){try{return send(200,await readDevices());}catch{return send(503,{error:'devices_unavailable'});}}
    try{return send(200,await read());}catch{return send(503,{error:'server_resources_unavailable'});}
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const port=Number(process.argv[2]||9582);const read=createResourceReader(readConfig());http.createServer(createResourceHandler(read,createDevicesReader())).listen(port,'127.0.0.1',()=>console.log(`Private read-only server resources on loopback :${port}`));}
