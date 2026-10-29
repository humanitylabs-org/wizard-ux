// Isolated workspace QA: real Agent Service store, disposable file, no live proxy.
// WORKSPACE_STORE_MODULE must point at server/workspaces.mjs from wizard-agent-service.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export async function workspaceOrigin({ web, module, syncSource, scratch = os.tmpdir() }) {
  if (!module) throw Error('Set WORKSPACE_STORE_MODULE to wizard-agent-service/server/workspaces.mjs');
  const { createWorkspaceStore } = await import(pathToFileURL(path.resolve(module)).href);
  const dir = fs.mkdtempSync(path.join(scratch, 'two-phone-workspaces-'));
  const file = path.join(dir, 'workspaces.json');
  let store = createWorkspaceStore(file);
  const requests = [], stubs = new Set();
  const apps = ['notes', 'calendar', 'files', 'wisdom'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), url: `/qa-app/${id}/`, source: 'apps.json' }));
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://qa');
    try {
      if (u.pathname === '/wizard/v1/workspaces') {
        const row = { method: req.method, query: u.search, ua: req.headers['user-agent'], at: Date.now() }; requests.push(row);
        if (req.method === 'PUT') {
          let body = ''; for await (const chunk of req) body += chunk;
          row.body = JSON.parse(body);
          const result = store.put(row.body); row.status = result.status; row.rev = result.body.rev;
          return json(res, result.status, result.body);
        }
        if (req.method !== 'GET') return json(res, 405, {});
        const abort = new AbortController(); res.on('close', () => abort.abort());
        const value = await store.wait(Number(u.searchParams.get('since') ?? -1), Number(u.searchParams.get('wait') || 0), abort.signal);
        row.rev = value.rev; row.done = Date.now();
        if (!res.destroyed) json(res, 200, value);
        return;
      }
      if (u.pathname.startsWith('/wizard/') || u.pathname.startsWith('/api/')) {
        stubs.add(u.pathname);
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 403, { error: 'QA refuses non-workspace writes' });
        if (u.pathname === '/wizard/v1/bootstrap') return json(res, 200, { bootstrap: 1, settings: { agent: { name: 'Wizard' } }, capabilities: {}, endpoints: { apps: '/wizard/v1/apps', sessions: '/wizard/v1/sessions' } });
        if (u.pathname === '/wizard/v1/apps') return json(res, 200, { apps });
        if (u.pathname === '/wizard/v1/launcher') return json(res, 200, { auto_open: [], autoOpen: [], apps: [] });
        if (u.pathname === '/wizard/v1/agents') return json(res, 200, { agents: [] });
        if (u.pathname === '/wizard/v1/sessions') return json(res, 200, { sessions: [] });
        return json(res, 404, { error: 'not installed in isolated QA' });
      }
      if (u.pathname.startsWith('/qa-app/')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>QA app</title><p>Isolated app frame</p>'); }
      if (!u.pathname.startsWith('/wizard-os-home/')) { res.writeHead(404); return res.end(); }
      const rel = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
      const target = rel === 'core/workspace-sync.js' && syncSource ? path.resolve(syncSource) : path.resolve(web, rel);
      if ((!(rel === 'core/workspace-sync.js' && syncSource) && !target.startsWith(path.resolve(web) + path.sep)) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); return res.end(); }
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
      res.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(target).pipe(res);
    } catch (e) { json(res, e.status || 500, { error: e.message }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/wizard-os-home/index.html`, requests, stubs,
    snapshot: () => store.snapshot(),
    reset(snapshot) { fs.writeFileSync(file, JSON.stringify(snapshot)); store = createWorkspaceStore(file); },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
