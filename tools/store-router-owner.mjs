// Connection Router owner bridge for the Store's install sheet and "Models and connections" (DECISIONS #65).
// The Router's owner API is box-only: it refuses browser, forwarded and Tailscale headers. This adapter is the trusted
// shell backend that already sits behind the gateway's owner gate. It makes fresh loopback requests carrying none of the
// caller's headers, passes through only three fixed calls, and never forwards a run-scope override token to a browser.
import http from 'node:http';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME = /^[A-Za-z0-9][\w.:/-]{0,127}$/;
export function routerOrigin(v = process.env.WIZARD_STORE_ROUTER_ORIGIN) {
  return typeof v === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(v) ? v : 'http://127.0.0.1:8802';
}

// Plain loopback HTTP: no Origin, cookies, forwarding or app-grant headers ever reach the Router.
export function loopbackJson(origin, method, path, body) {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(origin + path, { method, timeout: 15000,
      headers: raw ? { 'Content-Type': 'application/json', 'Content-Length': raw.length } : {} }, res => {
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > 1024 * 1024) { req.destroy(new Error('too_large')); return; } chunks.push(c); });
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {} resolve({ status: res.statusCode, body: json }); });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(raw || undefined);
  });
}

async function readBody(req, max = 4096) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error('too_large'), { status: 413 }); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Returns true when it handled the request. `path` is relative to the store-data prefix.
export function createRouterOwnerRoutes({ origin = routerOrigin(), call = loopbackJson } = {}) {
  const relay = async (send, method, path, body) => {
    let r; try { r = await call(origin, method, path, body); } catch (_) { send(503, { error: 'router_unavailable' }); return; }
    // Router 0.1.3 has no owner needs read yet; say so instead of "unknown route".
    if (r.status === 404 && (!r.body?.code || r.body?.message === 'Unknown route or method.')) { send(501, { error: 'router_outdated' }); return; }
    send(r.status >= 200 && r.status < 600 ? r.status : 502, r.body && typeof r.body === 'object' ? r.body : { error: 'router_bad_reply' });
  };
  return async (req, res, path, u, send) => {
    if (!path.startsWith('router/v1/')) return false;
    const rest = path.slice('router/v1/'.length);
    if (u.search) { send(400, { error: 'invalid_query' }); return true; }
    const app = rest.match(/^needs\/([a-z0-9][a-z0-9-]{0,63})$/)?.[1];
    if (app && ['GET', 'HEAD'].includes(req.method)) { await relay(send, 'GET', '/v1/owner/needs/' + app); return true; }
    if (rest === 'routes' && ['GET', 'HEAD'].includes(req.method)) { await relay(send, 'GET', '/v1/owner/routes'); return true; }
    if (rest === 'approve' && req.method === 'POST') {
      // A cross-site form cannot set this header or JSON type; a fetch that tries must pass CORS preflight, which we never grant.
      const site = req.headers['sec-fetch-site'];
      if (req.headers['x-wizard-store'] !== '1' || !String(req.headers['content-type'] || '').startsWith('application/json') || (site && site !== 'same-origin')) {
        send(403, { error: 'owner_store_only' }); return true;
      }
      let b; try { b = await readBody(req); } catch (e) { send(e.status || 400, { error: 'invalid_body' }); return true; }
      const ok = b && ID.test(b.app || '') && ID.test(b.feature || '') && ID.test(b.provider || '') && NAME.test(b.model || '');
      if (!ok) { send(400, { error: 'invalid_body' }); return true; }
      // Install scope only: the owner's choice is stored by the Router. Run-scope tokens are for apps, not browsers.
      await relay(send, 'POST', '/v1/owner/approve', { app: b.app, feature: b.feature, provider: b.provider, model: b.model, scope: 'install' });
      return true;
    }
    send(405, { error: 'method_not_allowed' }); return true;
  };
}
