// Browse adapter. Gateway owner routes ONLY this prefix through the existing authenticated gate. Read-only except one
// fixed owner call: approving a Connection Router model choice (store-router-owner.mjs).
// No Service lifecycle edits. Fixed source paths; Runtipi credential never leaves this process.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir, machine } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createIndexProxy, readCapped, readWizardApps } from './store-index-views.mjs';
import { buildOverview, gatherSources } from './system-overview.mjs';
import { withPrivateCatalog } from './store-private-catalog.mjs';
import { createRouterOwnerRoutes } from './store-router-owner.mjs';
import { linkPreview } from './store-link-preview.mjs';
import { readPrivilegeStatus } from './privilege-status.mjs';
export const PREFIX = '/wizard-os-home/store-data/';
const APPS = process.env.WIZARD_STORE_APPS_JSON || join(homedir(), '.wizard-os/apps.json');
const ENV = process.env.WIZARD_STORE_RUNTIPI_ENV || join(homedir(), 'runtipi/.env');
// The Agent Service this box runs. Alongside installs use another loopback port (e.g. 8798); only loopback http is accepted.
export function serviceOrigin(v = process.env.WIZARD_STORE_SERVICE_ORIGIN) {
  return typeof v === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(v) ? v : 'http://127.0.0.1:8923';
}
const SERVICE = serviceOrigin();
const LOGO_HOST = /^https:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+\/[0-9a-f]{7,40}\/[\w./-]{1,120}\.(png|jpe?g|webp|gif|svg)$/i;
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
  const host = env.INTERNAL_IP || '127.0.0.1', port = env.NGINX_PORT || '80';
  if (!/^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(host) || !/^\d{1,5}$/.test(port)) throw new Error('runtipi_address_invalid');
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now()/1000), h=b64({alg:'HS256',typ:'JWT'}), p=b64({sub:'cli',iat:now,nbf:now,exp:now+60});
  return { base:`http://${host}:${port}`, token:`${h}.${p}.${createHmac('sha256',env.JWT_SECRET).update(`${h}.${p}`).digest('base64url')}` };
}
// Only installation identity is exposed. Never project config, environment, health or MCP URLs.
export function wamMetadata(doc) {
  if (!Array.isArray(doc?.apps)) throw Error('registry_unavailable');
  return doc.apps.filter(a => /^[a-z0-9][a-z0-9-]{0,63}$/.test(a?.id || '')).slice(0,500).map(a => clean({
    id:a.id, app_id:str(a.app_id,64,/^[a-z0-9][a-z0-9-]{0,63}$/),
    name:str(a.name,80,/^[^<>\x00-\x1f\x7f]*$/), summary:str(a.summary,300,/^[^<>\x00-\x1f\x7f]*$/),
    type:['view','service','agent','external'].includes(a.type)?a.type:undefined,
    repo:str(a.repo,201,/^[\w.-]+\/[\w.-]+$/), commit:str(a.commit,40,/^[a-f0-9]{40}$/),
    version:str(a.version,40), status:str(a.status,24,/^[a-z_-]+$/),
    source:typeof a.source?.local==='string'?'local':str(a.source,64,/^[a-z0-9][a-z0-9-]{0,63}$/), channel:['alpha','standard'].includes(a.channel)?a.channel:undefined,
  }));
}
export function shellMetadata(doc) {
  if (!Array.isArray(doc?.apps)) throw Error('registry_unavailable');
  return doc.apps.filter(a => /^[a-z0-9][a-z0-9-]{0,63}$/.test(a?.id || '')).slice(0,500).map(a => clean({
    id:a.id, url:str(a.url,500,/^(?:\/(?!\/)[^\s]*|https:\/\/[^\s]+)$/),
    status:str(a.status,24,/^[a-z_-]+$/), system:a.system === true,
  }));
}
export function createStoreDataRoutes({ fetchImpl = fetch, index = withPrivateCatalog(createIndexProxy()), readApps = () => readWizardApps(APPS), readWam = () => JSON.parse(readFileSync(APPS,'utf8')), readRuntipi = runtipi, overview, readPrivileges = () => readPrivilegeStatus({fetchImpl}), service = SERVICE, routerOwner = createRouterOwnerRoutes() } = {}) {
  // Installed list straight from Runtipi, reduced to validated scalars (used by the Store and the System overview).
  const installedList = async () => {
    const auth=readRuntipi();
    const r=await fetchImpl(auth.base+'/api/apps/installed',{headers:{Authorization:'Bearer '+auth.token},redirect:'error',signal:AbortSignal.timeout(8000)});
    if (!r.ok) throw new Error('app_data_unavailable');
    return installedMetadata(await r.json());
  };
  const serviceJson = async (p) => { const r=await fetchImpl(service+p,{redirect:'error',signal:AbortSignal.timeout(8000)}); if (!r.ok) throw new Error('service'); return JSON.parse((await readCapped(r,2*1024*1024)).toString('utf8')); };
  const getOverview = overview || (async () => buildOverview(await gatherSources({ fetchJson: serviceJson, readInstalled: installedList })));
  let ovCache = null;
  const logos = new Map();
  return async (req,res) => {
    const send = (status, data, type='application/json') => {
      const body = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
      res.writeHead(status, {'Content-Type':type,'Content-Length':body.length,'Cache-Control':type.startsWith('image/')?'private, max-age=3600':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}); res.end(req.method === 'HEAD' ? undefined : body);
    };
    const routerWrite = req.method === 'POST' && req.url.split('?')[0] === PREFIX + 'router/v1/approve';
    if (!['GET','HEAD'].includes(req.method) && !routerWrite) { send(405,{error:'read_only'}); return; }
    try {
      const raw = req.url.split('?')[0]; let decoded; try { decoded=decodeURIComponent(raw); } catch (_) { send(400,{error:'invalid_path'}); return; }
      if (decoded.includes('\\') || decoded.split('/').some(s => s === '..' || s === '.') || /%2f|%5c|%25/i.test(raw)) { send(400,{error:'invalid_path'}); return; }
      const u=new URL(req.url,'http://localhost');
      if (!u.pathname.startsWith(PREFIX)) { send(404,{error:'not_found'}); return; }
      const path=u.pathname.slice(PREFIX.length);
      if (await routerOwner(req, res, path, u, send)) return;
      if (path === 'wizard/v1/privilege-status') {
        if (u.search) { send(400,{error:'invalid_query'}); return; }
        if (req.headers['sec-fetch-site'] === 'cross-site') { send(403,{error:'cross_site_refused'}); return; }
        try { send(200,await readPrivileges()); } catch (_) { send(503,{error:'privilege_status_unavailable'}); }
        return;
      }
      if (path === 'wizard/v1/installed-apps') {
        if (u.search) { send(400,{error:'invalid_query'}); return; }
        const [wam,shell] = await Promise.allSettled([
          Promise.resolve().then(() => wamMetadata(readWam())),
          serviceJson('/wizard/v1/apps').then(shellMetadata),
        ]);
        send(200,{architecture:({x86_64:'amd64',aarch64:'arm64',arm64:'arm64'})[machine()] || '',
          wam:wam.status==='fulfilled'?wam.value:[], shell:shell.status==='fulfilled'?shell.value:[],
          complete:wam.status==='fulfilled' && shell.status==='fulfilled',
          unavailable:[...(wam.status==='rejected'?['wam']:[]),...(shell.status==='rejected'?['shell']:[])]}); return;
      }
      if (path === 'wizard/v1/link') { const r=await linkPreview(u.searchParams,{fetchImpl,index}); send(r.status,r.body); return; }
      if (path === 'wizard/v1/wizard-apps') { send(200,readApps()); return; }
      if (path.startsWith('wizard/v1/index/')) { const r=await index('/'+path.slice('wizard/v1/index/'.length),u.searchParams); send(r.status,r.body); return; }
      if (path === 'system/v1/overview') {
        if (u.search) { send(400,{error:'invalid_query'}); return; }
        if (!ovCache || Date.now()-ovCache.at > 30000) ovCache = { at: Date.now(), body: await getOverview() };
        send(200, ovCache.body); return;
      }
      const logoId = path.match(/^logo\/([a-z0-9][a-z0-9-]{0,63})$/)?.[1];
      if (logoId) {
        if (u.search) { send(400,{error:'invalid_query'}); return; }
        const hit = logos.get(logoId); if (hit) { send(200, hit.body, hit.type); return; }
        // Only the logo URL the public App Index lists for this exact app id, on GitHub's raw host at a pinned commit.
        const r = await index('/search', new URLSearchParams({ limit: '100' }));
        const src = (r.status === 200 && Array.isArray(r.body?.apps) ? r.body.apps : []).find(a => a?.id === logoId)?.logo;
        if (typeof src !== 'string' || !LOGO_HOST.test(src)) { send(404,{error:'no_logo'}); return; }
        const lr = await fetchImpl(src,{redirect:'error',signal:AbortSignal.timeout(8000)});
        const type=(lr.headers.get('content-type') || '').split(';')[0];
        if (!lr.ok || !/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(type)) { send(502,{error:'invalid_image'}); return; }
        let body; try { body=await readCapped(lr,1024*1024); } catch (_) { send(502,{error:'image_too_large'}); return; }
        if (logos.size > 200) logos.clear();
        logos.set(logoId, { body, type }); send(200, body, type); return;
      }
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
