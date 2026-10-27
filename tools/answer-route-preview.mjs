// Synthetic read-only review origin: no live upstream, owner data, model or credentials.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
export const SID = 'answer_route_sample';
export const STAMP = 1793000000;
export function sampleRows(direct = true) {
  return [
    { id: 1, role: 'user', content: 'How does this thread switch work?', timestamp: STAMP - 180 },
    { id: 2, role: 'assistant', content: 'You can choose who answers the next message in this thread.', timestamp: STAMP - 150 },
    ...(direct ? [
      { id: 3, role: 'user', content: 'And when I choose Opus direct?', timestamp: STAMP - 100 },
      { id: 'direct:sample', role: 'assistant', content: '**Opus direct** answers through your Claude connection, without Hermes tools, memory or persona.\n\nYou can switch back to Hermes in this same thread.', timestamp: STAMP - 60, route: { kind: 'opus-direct', provider: 'claude', model: 'claude-opus-5-5' } },
    ] : []),
  ];
}
export function sampleSession(id = SID, direct = true) {
  const rows = sampleRows(direct);
  return { id, agent: id === 'answer_private_sample' ? 'private-sample' : 'hermes', source: 'wizard-mobile', title: 'Who answers this thread?', status: 'completed', archived: false, hidden: false, message_count: rows.length, started_at: STAMP - 180, last_active: STAMP - 60, wizard_last_user_at: rows.at(-2).timestamp, wizard_last_assistant_at: rows.at(-1).timestamp, wizard_activity_at: STAMP - 60, wizard_retry_input: rows.at(-2).content, latest_message: rows.at(-1), last_user_message: rows.at(-2), ...(direct ? { answer_route: 'opus-direct' } : {}) };
}
export function createAnswerRoutePreview({ web = resolve(fileURLToPath(new URL('../web/', import.meta.url))), direct = true } = {}) {
  const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
  return createServer((req, res) => {
    const u = new URL(req.url, 'http://sample'), p = u.pathname;
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, { error: { message: 'Read-only sample preview. No messages or changes are saved.' } }, 403);
    if (p === '/__preview/receipt') return json(res, { synthetic: true, readOnly: true, ux: process.env.PREVIEW_SHA || '' });
    if (p === '/') { res.writeHead(302, { location: '/wizard-os-home/?session=' + SID }); return res.end(); }
    if (p === '/wizard/v1/agents') return json(res, { agents: [
      { id: 'hermes', label: 'Hermes', is_default: true, privacy: 'standard', harness: 'hermes', appearance: {}, model: {} },
      { id: 'private-sample', label: 'Private sample', privacy: 'private', harness: 'hermes', appearance: {}, model: {} },
    ] });
    if (p === '/wizard/hermes/api/sessions') {
      const rows = u.searchParams.get('agent') === 'private-sample' ? [sampleSession('answer_private_sample', false)] : [sampleSession(SID, direct), sampleSession('answer_untouched_sample', false)];
      return json(res, { object: 'list', data: u.searchParams.get('offset') > 0 ? [] : rows, pagination: { returned: rows.length, has_more: false }, has_more: false });
    }
    const msg = p.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (msg) { const rows = sampleRows(msg[1] === SID && direct); return json(res, { object: 'list', data: rows, pagination: { returned: rows.length } }); }
    const session = p.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (session) return json(res, { session: sampleSession(session[1], session[1] === SID && direct) });
    const route = p.match(/^\/wizard\/v1\/threads\/([^/]+)\/route$/);
    if (route) {
      if (route[1] === 'answer_private_sample') return json(res, { error: { code: 'thread_route.private_agent', message: 'Private chats stay on their private agent.' } }, 409);
      return json(res, { session_id: route[1], route: route[1] === SID && direct ? 'opus-direct' : 'hermes', available: false, reason: 'Read-only sample. Switching is demonstrated in the browser QA, not saved here.' });
    }
    if (p.includes('ui-preferences') || p.includes('launcher')) return json(res, {}, 404);
    if (/models/.test(p)) return json(res, { models: [], data: [] });
    if (p.startsWith('/wizard/') || p.startsWith('/api/')) return json(res, {});
    let rel; try { rel = decodeURIComponent(p.slice('/wizard-os-home/'.length)) || 'index.html'; } catch { return json(res, {}, 400); }
    if (!p.startsWith('/wizard-os-home/') || rel.split('/').some(s => s === '..' || s.startsWith('.'))) return json(res, {}, 404);
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader('cache-control', 'no-store');
    if (['data.js', 'summaries.js'].includes(rel)) { res.setHeader('content-type', 'application/javascript'); return res.end(rel === 'data.js' ? 'window.WIZ_DATA={projects:{},threads:[]};' : 'window.WIZ_SUMMARIES={};'); }
    const f = resolve(web, rel);
    if (!f.startsWith(web + sep) || !existsSync(f) || !statSync(f).isFile()) return json(res, {}, 404);
    res.setHeader('content-type', types[extname(f)] || 'application/octet-stream'); res.end(req.method === 'HEAD' ? '' : readFileSync(f));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createAnswerRoutePreview({ web: process.env.PREVIEW_WEB && resolve(process.env.PREVIEW_WEB) });
  server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => console.log(JSON.stringify({ origin: `http://127.0.0.1:${server.address().port}`, synthetic: true, readOnly: true })));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
}
