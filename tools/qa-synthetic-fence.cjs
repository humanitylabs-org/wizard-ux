'use strict';
// This admission is deliberately offline: an env flag or a loopback hostname is
// not proof that a service is synthetic. Only a reserved, unroutable origin and
// an explicit local response catalogue are admitted. Unknown requests fail shut.
const fs = require('node:fs'), path = require('node:path');
const FIXTURE_ORIGIN = 'http://wizard-qa.invalid';
function admit(base, fixture) {
 const u = new URL(base);
 if (u.href !== FIXTURE_ORIGIN + '/' || !fixture) throw Error('Synthetic fixture origin and QA_FIXTURE required; owner/network origins refused');
 const document = JSON.parse(fs.readFileSync(fixture, 'utf8'));
 if (document.synthetic !== true || !document.responses || Array.isArray(document.responses)) throw Error('Invalid synthetic response catalogue');
 return { base: FIXTURE_ORIGIN, responses: document.responses };
}
function responseFor(fixture, url, method = 'GET') {
 const u = new URL(url, fixture.base);
 if (u.origin !== fixture.base) throw Error('Non-fixture origin refused before network: ' + u.origin);
 const key = method.toUpperCase() + ' ' + u.pathname + u.search;
 const row = fixture.responses[key];
 if (!row || typeof row.body !== 'string' || !Number.isInteger(row.status) || ![undefined, 'base64'].includes(row.encoding)) throw Error('Uncatalogued fixture request: ' + key);
 if (row.encoding === 'base64' && (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.body) || Buffer.from(row.body, 'base64').toString('base64') !== row.body)) throw Error('Invalid fixture base64');
 return { status: row.status, contentType: row.contentType || 'application/json', body: row.encoding === 'base64' ? Buffer.from(row.body, 'base64') : row.body };
}
// Collect-all refusal ledger. An unknown request is still refused (HTTP 451, no
// data), but the run keeps going so ONE run reports EVERY uncatalogued request.
// failAtExit() makes the process exit non-zero if anything was refused.
const refusals = new Map();
function refuse(key, reason) {
 const row = refusals.get(key) || { request: key, reason: String(reason), count: 0 };
 row.count++; refusals.set(key, row); return row;
}
function refused() { return [...refusals.values()].sort((a, b) => a.request.localeCompare(b.request)); }
function resetRefusals() { refusals.clear(); }
function responseOrRefuse(fixture, url, method = 'GET') {
 try { return responseFor(fixture, url, method); }
 catch (error) {
  if (!/^(?:Uncatalogued fixture request|Non-fixture origin refused)/.test(error.message)) throw error;
  let key = method.toUpperCase() + ' ' + String(url);
  try { const u = new URL(url, fixture.base); key = method.toUpperCase() + ' ' + (u.origin === fixture.base ? '' : u.origin) + u.pathname + u.search; } catch (_) {}
  refuse(key, error.message);
  return { status: 451, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic_request_refused', request: key }) };
 }
}
// outDir may be a thunk (() => OUT): harnesses compute their default output directory after requiring the fixture.
function failAtExit(outDir) {
 const name = require.main ? path.basename(require.main.filename).replace(/\.[cm]?js$/, '') : 'harness';
 process.on('exit', () => {
  const rows = refused(), dir = process.env.QA_REFUSED_DIR || (typeof outDir === 'function' ? outDir() : outDir) || process.env.QA_OUT;
  if (dir) { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'refused-' + name + '.json'), JSON.stringify(rows, null, 2) + '\n'); } catch (_) {} }
  if (rows.length) { console.error('REFUSED ' + rows.length + ' uncatalogued synthetic request(s) in ' + name + ':\n' + rows.map(r => '  ' + r.request + (r.count > 1 ? ' x' + r.count : '')).join('\n')); process.exitCode = 1; }
 });
}
async function fenceContext(ctx, fixture, denied = []) {
 // Browser routing does NOT cover APIRequestContext. Replace that escape hatch
 // with an in-memory facade; never bind or call the original request object.
 const request = async (url, init = {}) => {
  const row = responseFor(fixture, url, init.method || 'GET');
  return { ok: () => row.status >= 200 && row.status < 300, status: () => row.status,
   body: async () => Buffer.from(row.body), text: async () => row.body.toString(),
   json: async () => JSON.parse(row.body.toString()), dispose: async () => {} };
 };
 const api = { fetch: request, dispose: async () => {} };
 for (const method of ['get','head','post','put','patch','delete']) api[method] = (url, init = {}) => request(url, { ...init, method: method.toUpperCase() });
 Object.defineProperty(ctx, 'request', { value: Object.freeze(api), configurable: false });
 await ctx.route('**/*', async route => {
  try { return await route.fulfill(responseFor(fixture, route.request().url(), route.request().method())); }
  catch (error) { denied.push(String(error)); refuse(route.request().method() + ' ' + route.request().url(), error.message); return route.abort('blockedbyclient'); }
 });
 // No socket can escape a response-only fixture.
 await ctx.routeWebSocket('**/*', ws => ws.close());
}
module.exports = { admit, responseFor, responseOrRefuse, refused, resetRefusals, failAtExit, fenceContext, FIXTURE_ORIGIN };
