// Read-only browse adapter. Gateway owner routes ONLY this prefix through the existing authenticated gate.
// No Service lifecycle edits. Fixed source paths; Runtipi credential never leaves this process.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createIndexProxy, readCapped, readWizardApps } from './store-index-views.mjs';
export const PREFIX = '/wizard-os-home/store-data/';
const APPS = join(homedir(), '.wizard-os/apps.json');
const ENV = join(homedir(), 'runtipi/.env');
// Every emitted value is rebuilt from a validated scalar: an allowed key holding an object never leaks through.
const str = (v, max, re) => typeof v === 'string' && v.length <= max && (!re || re.test(v)) ? v : undefined;
const ver = v => (typeof v === 'number' && Number.isFinite(v)) ? v : str(v, 32, /^[\w.+-]+$/);
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
export function installedMetadata(doc) {
  return { installed: (Array.isArray(doc?.installed) ? doc.installed : []).filter(x => /^[a-z0-9][a-z0-9-]{0,63}$/.test(x?.info?.id || '')).slice(0, 500).map(x => ({
    info: clean({ id: x.info.id, urn: str(x.info.urn, 130, /^[a-z0-9-]{1,64}:[a-z0-9-]{1,64}$/), name: str(x.info.name, 80), short_desc: str(x.info.short_desc, 300),
      categories: Array.isArray(x.info.categories) ? x.info.categories.filter(c => str(c, 32, /^[\w -]+$/)).slice(0, 12) : undefined, no_gui: typeof x.info.no_gui === 'boolean' ? x.info.no_gui : undefined }),
    app: clean({ status: str(x.app?.status, 24, /^[a-z_-]+$/), version: ver(x.app?.version), ignoredVersion: ver(x.app?.ignoredVersion) }),
    metadata: clean({ latestVersion: ver(x.metadata?.latestVersion) })
  })) };
}
function runtipi() {
  const env = Object.fromEntries(readFileSync(ENV, 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]; }));
  if (!env.JWT_SECRET) throw new Error('credential_unavailable');
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now()/1000), h=b64({alg:'HS256',typ:'JWT'}), p=b64({sub:'cli',iat:now,nbf:now,exp:now+60});
  return { base:`http://${env.INTERNAL_IP || '127.0.0.1'}:${env.NGINX_PORT || 80}`, token:`${h}.${p}.${createHmac('sha256',env.JWT_SECRET).update(`${h}.${p}`).digest('base64url')}` };
}
export function createStoreDataRoutes({ fetchImpl = fetch, index = createIndexProxy(), readApps = () => readWizardApps(APPS), readRuntipi = runtipi } = {}) {
  return async (req,res) => {
    const send = (status, data, type='application/json') => {
      const body = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
      res.writeHead(status, {'Content-Type':type,'Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (!['GET','HEAD'].includes(req.method)) { send(405,{error:'read_only'}); return; }
    try {
      const raw = req.url.split('?')[0]; let decoded; try { decoded=decodeURIComponent(raw); } catch (_) { send(400,{error:'invalid_path'}); return; }
      if (decoded.includes('\\') || decoded.split('/').some(s => s === '..' || s === '.') || /%2f|%5c|%25/i.test(raw)) { send(400,{error:'invalid_path'}); return; }
      const u=new URL(req.url,'http://localhost');
      if (!u.pathname.startsWith(PREFIX)) { send(404,{error:'not_found'}); return; }
      const path=u.pathname.slice(PREFIX.length);
      if (path === 'wizard/v1/wizard-apps') { send(200,readApps()); return; }
      if (path.startsWith('wizard/v1/index/')) { const r=await index('/'+path.slice('wizard/v1/index/'.length),u.searchParams); send(r.status,r.body); return; }
      const isInstalled=path === 'api/apps/installed';
      const logo=/^api\/marketplace\/apps\/[a-z0-9-]{1,64}(?::|%3[aA])[a-z0-9-]{1,64}\/image$/.test(path);
      if (!isInstalled && !logo) { send(404,{error:'not_found'}); return; }
      if (u.search) { send(400,{error:'invalid_query'}); return; }
      const auth=readRuntipi();
      const r=await fetchImpl(auth.base+'/'+path,{headers:{Authorization:`Bearer ${auth.token}`},redirect:'error',signal:AbortSignal.timeout(8000)});
      if (!r.ok) { send(r.status === 404 ? 404 : 502,{error:'app_data_unavailable'}); return; }
      if (isInstalled) { send(200,installedMetadata(await r.json())); return; }
      const type=r.headers.get('content-type') || '';
      if (!/^image\/(png|jpeg|webp|gif|svg\+xml)(;|$)/.test(type)) { send(502,{error:'invalid_image'}); return; }
      let body; try { body=await readCapped(r,2*1024*1024); } catch (_) { send(502,{error:'image_too_large'}); return; }
      send(200,body,type);
    } catch (_) { send(502,{error:'browse_data_unavailable'}); }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port=Number(process.argv[2] || 9584);
  http.createServer(createStoreDataRoutes()).listen(port,'127.0.0.1',()=>console.log(`Store browse data ${PREFIX} on loopback :${port}`));
}
