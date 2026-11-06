// Isolated, read-only review fixture. No owner data, credentials or live upstream.
// PREVIEW_SERVICE points to the paired Agent Service checkout; PREVIEW_STATE is disposable.
import { createServer, request } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
if (!process.env.PREVIEW_SERVICE || !process.env.PREVIEW_STATE) throw Error('Explicit isolated service and state paths required');
const { createWizardServer, listen } = await import(pathToFileURL(join(process.env.PREVIEW_SERVICE, 'server/service.mjs')));
const state = resolve(process.env.PREVIEW_STATE), web = resolve(process.env.PREVIEW_WEB || fileURLToPath(new URL('../web/', import.meta.url)));
mkdirSync(join(state, 'images'), { recursive: true });
// Two distinctive non-secret screenshot illustrations, generated without external assets.
function png(accent) {
  const w = 600, h = 180, rows = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const card = x > 26 && x < 574 && y > 24 && y < 156;
    const bar = card && x > 52 && x < (y < 65 ? 330 : y < 103 ? 490 : 410) && y % 40 < 25;
    const rgb = bar ? accent : card ? [39, 43, 58] : [19, 22, 32];
    const i = y * (w * 3 + 1) + 1 + x * 3; for (let c = 0; c < 3; c++) rows[i + c] = rgb[c];
  }
  const crc = b => { let c = 0xffffffff; for (const v of b) { c ^= v; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), n = Buffer.alloc(4), c = Buffer.alloc(4); n.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([n, t, data, c]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(w); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
for (const [name, color] of [['first.png', [149, 130, 235]], ['second.png', [80, 184, 166]]]) writeFileSync(join(state, 'images', name), png(color));
const sid = 'inline_screenshots_preview', now = Math.floor(Date.now() / 1000);
const reply = `**First screenshot** — the violet layout.\nMEDIA:${join(state, 'images/first.png')}\n**Second screenshot** — the green layout.\nMEDIA:${join(state, 'images/second.png')}\nEach image stays beside its explanation. Tap either to open the full viewer.`;
const rows = [{ id: 1, role: 'user', content: 'Show both screenshots in your reply, beside their explanations.', timestamp: now - 120 }, { id: 2, role: 'assistant', content: reply, timestamp: now - 60 }];
const session = { id: sid, source: 'wizard-mobile', title: 'Inline screenshots · sample', status: 'completed', archived: false, message_count: 2, started_at: now - 120, last_active: now - 60, wizard_last_user_at: now - 120, wizard_last_assistant_at: now - 60, wizard_activity_at: now - 60, latest_message: { role: 'assistant', content: 'Two screenshots, placed beside their explanations.', timestamp: now - 60 }, last_user_message: rows[0] };
const json = (res, value, code = 200) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
const upstream = createServer((req, res) => {
  const p = new URL(req.url, 'http://fixture').pathname;
  if (p.endsWith('/messages')) return json(res, { object: 'list', data: rows, pagination: { returned: 2, offset: 0, limit: 500 } });
  if (p.endsWith('/sessions/' + sid)) return json(res, { session });
  if (p.endsWith('/sessions')) return json(res, { object: 'list', data: [session], pagination: { returned: 1, offset: 0, limit: 50, has_more: false } });
  if (/models/.test(p)) return json(res, { models: [], data: [] });
  if (/health|status/.test(p)) return json(res, { ok: true, status: 'ok' });
  return json(res, {});
});
const up = await listen(upstream);
const service = createWizardServer({ requireJoinedDelegationCapability: false, upstreamOrigin: `http://127.0.0.1:${up.port}`, hermesKey: 'synthetic-preview-only', requireAccess: false, agentArtifactDir: join(state, 'artifacts'), agentArtifactRoots: [join(state, 'images')], settingsPath: join(state, 'settings.json'), agentsDir: join(state, 'agents') });
const api = await listen(service);
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const csp = "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const origin = createServer((req, res) => {
  const u = new URL(req.url, 'http://preview');
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, { error: 'Read-only sample preview; no messages or changes are saved.' }, 403);
  if (u.pathname === '/__preview/receipt') return json(res, { readOnly: true, synthetic: true, ux: process.env.PREVIEW_SHA, service: process.env.PREVIEW_SERVICE_SHA });
  if (u.pathname === '/') { res.writeHead(302, { location: '/wizard-os-home/?session=' + sid }); return res.end(); }
  if (u.pathname.startsWith('/wizard/')) {
    const p = request({ host: '127.0.0.1', port: api.port, path: req.url, method: req.method, headers: { accept: req.headers.accept || '*/*' } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); }); return p.end();
  }
  if (u.pathname.startsWith('/api/')) return json(res, { ok: true });
  let rel; try { rel = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html'; } catch { res.writeHead(400); return res.end(); }
  if (!u.pathname.startsWith('/wizard-os-home/') || rel.split('/').some(s => s === '..' || s.startsWith('.'))) { res.writeHead(404); return res.end(); }
  res.setHeader('content-security-policy', csp); res.setHeader('cache-control', 'no-store');
  if (rel === 'data.js' || rel === 'summaries.js') { res.setHeader('content-type', 'application/javascript'); return res.end(rel === 'data.js' ? 'window.WIZ_DATA={projects:{},threads:[]};' : 'window.WIZ_SUMMARIES={};'); }
  const f = resolve(web, rel);
  if (!f.startsWith(web + sep) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader('content-type', types[extname(f)] || 'application/octet-stream'); res.end(req.method === 'HEAD' ? '' : readFileSync(f));
});
origin.listen(Number(process.env.PORT || 9532), '127.0.0.1', () => console.log('Isolated inline screenshot preview ready'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { origin.close(); service.close(); upstream.close(); });
