/* App Store in the shell's opaque window (browser boundary on; wizard-os 389 O1).
 * The Store's own code keeps calling fetch() on its owner endpoints (../store-data/, ../store-install/, the agents
 * read). In an opaque frame those requests are refused (Origin:null gets no CORS, by design), so this classic script
 * turns exactly those requests into the shell's typed Store operations (browser-boundary.js STORE_OPS) over the
 * boundary port. It is not a relay: every path is matched here to one named operation with exact arguments, the
 * shell re-validates them and maps them back to its own fixed path, and anything else under those prefixes is
 * refused. Owner changes wait for the owner's confirmation in shell UI. Outside the opaque window (boundary off,
 * standalone tab) it does nothing. */
(() => {
  'use strict';
  if (parent === window || globalThis.origin !== 'null' || !window.WizBoundaryClient) return;
  const client = window.WizBoundaryClient, nativeFetch = window.fetch.bind(window);
  const BASE = new URL('../', location.href);   // /wizard-os-home/
  const ID = '([a-z0-9][a-z0-9-]{0,63})';
  const connected = new Promise(resolve => {
    if (client.ready) return resolve();
    addEventListener('wizard:boundary:connected', () => resolve(), { once: true });
  });
  // The shell's skin over the boundary port (the Store's postMessage appearance receiver cannot work from an opaque
  // origin): same v1 shape and checks as store-appearance.js, so Landscapes Light & co. paint the Store too.
  const TOKENS = ['canvas', 'base', 'chrome', 'overlay', 'surface', 'surface-raised', 'text', 'text-secondary', 'text-muted', 'border', 'accent', 'accent-soft', 'on-accent', 'reader-surface'];
  const okToken = v => typeof v === 'string' && v.length > 0 && v.length < 96 && !/[;{}]|url\(/i.test(v) && (!window.CSS?.supports || CSS.supports('color', v));
  client.connect({ onTheme: a => {
    if (!a || a.version !== 1 || !['light', 'dark'].includes(a.colorScheme) || !/^[a-z0-9-]{1,40}$/.test(a.skin || '') || !a.tokens || !TOKENS.every(k => okToken(a.tokens[k]))) return false;
    const root = document.documentElement;
    for (const k of TOKENS) root.style.setProperty('--wz-' + k, a.tokens[k]);
    root.style.colorScheme = a.colorScheme; root.dataset.skin = a.skin; root.dataset.colorScheme = a.colorScheme;
    root.classList.add('wz-hosted'); root.setAttribute('data-wz-hosted', '');
    return true;
  } });
  const json = async request => { try { return JSON.parse(await request.text()); } catch (_) { return null; } };
  const ROUTES = [
    ['GET', /^store-data\/wizard\/v1\/index\/search$/, (m, q) => ['catalog', { offset: Number(q.get('offset') || 0), refresh: q.get('refresh') === '1' }]],
    ['GET', /^store-data\/api\/apps\/installed$/, () => ['installed.runtipi', {}]],
    ['GET', /^store-data\/wizard\/v1\/installed-apps$/, () => ['installed.wizard', {}]],
    ['GET', /^store-data\/wizard\/v1\/link$/, (m, q) => ['link', { repo: q.get('repo') || '', commit: q.get('commit') || null }]],
    ['GET', new RegExp(`^store-data/router/v1/needs/${ID}$`), m => ['router.needs', { app: m[1] }]],
    ['POST', /^store-data\/router\/v1\/approve$/, (m, q, b) => ['router.approve', { app: b?.app, feature: b?.feature, provider: b?.provider, model: b?.model }]],
    ['GET', new RegExp(`^store-install/_remove/${ID}/plan$`), m => ['remove.plan', { id: m[1] }]],
    ['GET', new RegExp(`^store-install/_remove/${ID}$`), m => ['remove.status', { id: m[1] }]],
    ['POST', new RegExp(`^store-install/_remove/${ID}$`), (m, q, b) => ['remove', { id: m[1], repo: b?.repo, commit: b?.commit, dependents: b?.dependents, empties: b?.empties }]],
    ['GET', new RegExp(`^store-install/${ID}$`), m => ['install.status', { id: m[1] }]],
    ['POST', new RegExp(`^store-install/${ID}$`), (m, q, b) => ['install', { id: m[1], source: b?.source, repo: b?.repo, commit: b?.commit, operation: b?.operation }]],
  ];
  const AGENTS = new RegExp(`^/wizard/v1/apps/${ID}/agents$`);
  const respond = (status, value) => new Response(value === null || value === undefined ? '' : JSON.stringify(value),
    { status: status >= 200 && status <= 599 ? status : 502, headers: { 'Content-Type': 'application/json' } });
  async function call(op, args, write) {
    await connected;
    try {
      const out = await client.request('store.call', { op, args }, write ? 180000 : 30000);
      return respond(out?.status, out?.value);
    } catch (e) {
      // A refusal or a cancelled confirmation is an answer, not a network failure: the Store shows it as an error.
      const code = e?.code || 'failed';
      return respond(code === 'cancelled' ? 409 : code === 'not_allowed' || code === 'denied' ? 403 : code === 'bad_request' ? 400 : 503,
        { error: code === 'cancelled' ? 'Cancelled.' : `Wizard refused this Store request (${code}).`, code });
    }
  }
  window.fetch = async function (input, init) {
    const request = new Request(input instanceof Request ? input : new URL(input, location.href), init);
    const url = new URL(request.url);
    if (url.origin !== BASE.origin) return nativeFetch(request);
    const agents = AGENTS.exec(url.pathname);
    if (agents && request.method === 'GET') return call('app.agents', { id: agents[1] }, false);
    if (!url.pathname.startsWith(BASE.pathname)) return nativeFetch(request);
    const rel = url.pathname.slice(BASE.pathname.length);
    if (!/^store-(data|install)\//.test(rel)) return nativeFetch(request);
    if (/^store-data\/logo\//.test(rel) && request.method === 'GET') return nativeFetch(request);   // images: no owner data
    for (const [method, re, args] of ROUTES) {
      const m = re.exec(rel);
      if (!m || method !== request.method) continue;
      const body = method === 'POST' ? await json(request) : null;
      const [op, a] = args(m, url.searchParams, body);
      return call(op, a, method === 'POST');
    }
    return respond(403, { error: 'This Store request is not available in a Wizard window.', code: 'not_allowed' });
  };
})();
