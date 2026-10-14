// Share files fixture: the exact v1 resumable uploads + shares contract (briefs/share-files.md, "API contract"),
// on disk so a restart resumes, plus just enough of the Agent Service for the Wizard OS shell to boot and send
// a chat. The client lane (web composer, Android share sheet) builds and QA's against this until the server
// lane's wizard-agent-service is staged.
//
//   node tools/share-fixture.mjs [port=9650] [--web=<repo>/web] [--data=<dir>] [--host=0.0.0.0]
//        [--agents=0|1|2]      0: no agents registry (GET /wizard/v1/agents → 404, a box without Agents),
//                              1: just the main agent, 2 (default): main + a Private agent
//        [--resumable=0]       advertise no capabilities.resumable_uploads (old clients' fallback path)
//        [--throttle=<MB/s>]   cap PATCH intake speed so QA can interrupt an upload mid-way
//        [--max=<bytes>]       box cap (WIZARD_UPLOAD_MAX_BYTES); a bigger upload → 507 insufficient_storage
//        [--chunk=<bytes>]     suggested chunk_bytes (default 8 MiB)
//
// Contract (Agent Service v1):
//   GET  /wizard/v1/bootstrap                → capabilities.resumable_uploads, endpoints.uploads/shares
//   POST /wizard/v1/uploads {client_upload_id, filename, mime, bytes, sha256?} → 201 {upload_id, offset, bytes, chunk_bytes, status, file?}
//   GET  /wizard/v1/uploads/<id>             → {upload_id, offset, bytes, status, file?}
//   PATCH /wizard/v1/uploads/<id>  raw bytes, Content-Type application/offset+octet-stream, Upload-Offset: n
//                                            → 204 Upload-Offset: <new> | 409 {error:'offset_mismatch', offset}
//   POST /wizard/v1/uploads/<id>/complete    → 200 {file}  (idempotent; verifies size + sha256)
//   POST /wizard/v1/shares {client_share_id, agent?, thread?, note?, files:[{filename, mime, bytes, sha256?}]}
//                                            → 201 {share_id, agent, thread_id, status, uploads:[{upload_id, offset, bytes, chunk_bytes}]}
//   GET  /wizard/v1/shares/<id>              → {share_id, status, thread_id, agent, error?}
//   When a share's last upload completes, exactly one user message (files + note) lands in thread_id and a run starts.
//
// QA hooks: GET /__fixture/state (shares, uploads, deliveries, runs) · POST /__fixture/reset.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const pos = args.filter(a => !a.startsWith('--'));
const PORT = Number(pos[0] || 9650);
const HOST = flag('host', '0.0.0.0');
const WEB = path.resolve(flag('web', path.join(HERE, '..', 'web')));
const DATA = path.resolve(flag('data', path.join(process.env.TMPDIR || '/tmp', 'share-fixture')));
const AGENTS_N = Number(flag('agents', '2'));
const RESUMABLE = flag('resumable', '1') !== '0';
const THROTTLE = Number(flag('throttle', '0')) * 1024 * 1024; // bytes per second, 0 = unthrottled
const MAX = Number(flag('max', '0'));
const CHUNK = Number(flag('chunk', String(8 * 1024 * 1024)));
const MAX_CHUNK = 64 * 1024 * 1024;
const OLD_LIMIT = 64 * 1024 * 1024;
const DIRS = { up: path.join(DATA, 'uploads'), files: path.join(DATA, 'files'), shares: path.join(DATA, 'shares') };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
const STATE = path.join(DATA, 'state.json');
const TYPES = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const now = () => Math.floor(Date.now() / 1000);
const hex = n => crypto.randomBytes(n).toString('hex');
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

/* ---------------- durable state (small JSON; payloads stream to their own files) ---------------- */
let S = load();
function load() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }
  catch { return { uploads: {}, byClient: {}, shares: {}, sharesByClient: {}, files: {}, sessions: {}, runs: {}, deliveries: [] }; }
}
function save() {
  const tmp = STATE + '.tmp';
  const fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, JSON.stringify(S)); fs.fsyncSync(fd); fs.closeSync(fd);
  fs.renameSync(tmp, STATE);
}

/* ---------------- agents ---------------- */
const AGENTS = [
  { id: 'hermes', label: 'Wizard', is_default: true, status: 'running', privacy: 'standard', appearance: { glyph: 'wizard', hue: 270 } },
  { id: 'private', label: 'Private', is_default: false, status: 'running', privacy: 'private', appearance: { glyph: 'lock', hue: 160 } },
  { id: 'stopped', label: 'Sleepy', is_default: false, status: 'stopped', privacy: 'standard', appearance: { glyph: 'moon', hue: 40 } },
].slice(0, AGENTS_N >= 2 ? 3 : 1);
const agentById = id => AGENTS.find(a => a.id === id);
const defaultAgent = () => AGENTS[0];

/* ---------------- http helpers ---------------- */
function send(res, code, body, headers = {}) {
  const b = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(b);
}
async function readJson(req, limit = 1 << 20) {
  const parts = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('too large'), { status: 413 }); parts.push(c); }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
}
function freeBytes() {
  try { const s = fs.statfsSync(DATA); return Number(s.bavail) * Number(s.bsize); } catch { return Number.MAX_SAFE_INTEGER; }
}
const RESERVE = Number(process.env.WIZARD_UPLOAD_RESERVE_BYTES || 0); // fixture default 0 (QA disks are small); server default 5 GiB
const cleanName = s => String(s || 'upload').replace(/[\\/\u0000-\u001f"]/g, '_').slice(0, 240) || 'upload';
const cleanMime = s => (/^[\w.+-]+\/[\w.+-]+$/.test(String(s || '')) ? String(s) : 'application/octet-stream').slice(0, 160);

/* ---------------- uploads ---------------- */
const pubUpload = u => ({ upload_id: u.id, offset: u.offset, bytes: u.bytes, chunk_bytes: CHUNK, status: u.status, ...(u.file ? { file: S.files[u.file] } : {}) });
function createUpload({ client_upload_id, filename, mime, bytes, sha256 }, share = '') {
  const key = String(client_upload_id || '');
  if (!/^[\w.:-]{6,160}$/.test(key)) return [400, { error: 'client_upload_id_required' }];
  const n = Number(bytes);
  if (!Number.isSafeInteger(n) || n < 0) return [400, { error: 'bytes_required' }];
  if (S.byClient[key]) return [201, pubUpload(S.uploads[S.byClient[key]])];
  if ((MAX && n > MAX) || n > freeBytes() - RESERVE) return [507, { error: 'insufficient_storage' }];
  const id = 'up_' + hex(16);
  S.uploads[id] = { id, client: key, filename: cleanName(filename), mime: cleanMime(mime), bytes: n, sha256: /^[0-9a-f]{64}$/.test(String(sha256 || '')) ? sha256 : '', offset: 0, status: 'uploading', share, created: now(), patches: 0, conflicts: 0 };
  S.byClient[key] = id;
  fs.closeSync(fs.openSync(path.join(DIRS.up, id + '.part'), 'w'));
  save();
  log('upload:create', id, n, S.uploads[id].filename);
  return [201, pubUpload(S.uploads[id])];
}

/* Streams one chunk straight to the part file at the current offset, fsyncs, and advances the offset to what was
 * written. A dropped connection keeps the bytes that did land (the client reconciles with GET). */
async function patchUpload(req, res, u) {
  if (!String(req.headers['content-type'] || '').startsWith('application/offset+octet-stream')) return send(res, 415, { error: 'offset_octet_stream_required' });
  const at = Number(req.headers['upload-offset']);
  if (!Number.isSafeInteger(at) || at !== u.offset) { u.conflicts++; save(); log('upload:409', u.id, 'client', at, 'server', u.offset); req.resume(); return send(res, 409, { error: 'offset_mismatch', offset: u.offset }); }
  if (u.status === 'complete') { req.resume(); return send(res, 409, { error: 'offset_mismatch', offset: u.offset }); }
  const len = Number(req.headers['content-length']);
  if (Number.isFinite(len) && len > MAX_CHUNK) { req.resume(); return send(res, 413, { error: 'chunk_too_large', max: MAX_CHUNK }); }
  const fd = await fsp.open(path.join(DIRS.up, u.id + '.part'), 'r+');
  let pos = u.offset, over = false, t0 = Date.now(), got = 0;
  try {
    for await (const c of req) {
      if (pos + c.length > u.bytes) { over = true; break; }
      await fd.write(c, 0, c.length, pos); pos += c.length; got += c.length;
      if (THROTTLE) { const ahead = got / THROTTLE * 1000 - (Date.now() - t0); if (ahead > 0) await new Promise(r => setTimeout(r, ahead)); }
    }
  } catch (e) { log('upload:aborted', u.id, 'at', pos, String(e.code || e.message)); }
  finally { try { await fd.sync(); } catch {} await fd.close(); }
  const aborted = req.aborted || !req.complete;
  u.offset = pos; u.patches++; save();
  if (over) return send(res, 409, { error: 'offset_mismatch', offset: u.offset });
  if (aborted) { log('upload:partial', u.id, u.offset, '/', u.bytes); return; }
  res.writeHead(204, { 'Upload-Offset': String(u.offset), 'Cache-Control': 'no-store' }); res.end();
}

async function sha256File(p) {
  const h = crypto.createHash('sha256');
  for await (const c of fs.createReadStream(p, { highWaterMark: 1 << 20 })) h.update(c);
  return h.digest('hex');
}
async function completeUpload(u) {
  if (u.status === 'complete') return [200, { file: S.files[u.file] }];
  if (u.offset !== u.bytes) return [409, { error: 'incomplete', offset: u.offset, bytes: u.bytes }];
  const part = path.join(DIRS.up, u.id + '.part');
  const digest = await sha256File(part);
  if (u.sha256 && digest !== u.sha256) return [422, { error: 'sha256_mismatch' }];
  if (u.status === 'complete') return [200, { file: S.files[u.file] }]; // a concurrent complete won the race
  const id = 'wf_' + hex(16);
  fs.renameSync(part, path.join(DIRS.files, id));
  S.files[id] = { id, filename: u.filename, mime: u.mime, bytes: u.bytes, sha256: digest, note: '', duplicate_of: null, created_at: new Date().toISOString(), source: 'Wizard app', status: 'ready', path: `Inbox/${new Date().toISOString().slice(0, 10)}/${u.filename}` };
  u.status = 'complete'; u.file = id; save();
  log('upload:complete', u.id, '→', id, u.bytes);
  if (u.share) maybeDeliver(S.shares[u.share]);
  return [200, { file: S.files[id] }];
}

/* ---------------- shares ---------------- */
const pubShare = sh => ({ share_id: sh.id, agent: sh.agent, thread_id: sh.thread, status: sh.status, ...(sh.error ? { error: sh.error } : {}) });
function createShare(b) {
  const key = String(b.client_share_id || '');
  if (!/^[\w.:-]{6,160}$/.test(key)) return [400, { error: 'client_share_id_required' }];
  if (S.sharesByClient[key]) { const sh = S.shares[S.sharesByClient[key]]; return [201, { ...pubShare(sh), uploads: sh.uploads.map(id => { const u = S.uploads[id]; return { upload_id: id, offset: u.offset, bytes: u.bytes, chunk_bytes: CHUNK }; }) }]; }
  const files = Array.isArray(b.files) ? b.files : [];
  if (!files.length || files.length > 100) return [400, { error: 'files_required' }];
  const agent = b.agent ? agentById(String(b.agent)) : defaultAgent();
  if (!agent) return [409, { error: 'unknown_agent' }];
  if (agent.status !== 'running') return [409, { error: 'agent_stopped' }];
  let thread = String(b.thread || '');
  if (thread && !S.sessions[thread]) return [409, { error: 'unknown_thread' }];
  if (thread && S.sessions[thread].agent !== agent.id) return [409, { error: 'thread_agent_mismatch' }];
  const total = files.reduce((n, f) => n + (Number(f.bytes) || 0), 0);
  if ((MAX && files.some(f => Number(f.bytes) > MAX)) || total > freeBytes() - RESERVE) return [507, { error: 'insufficient_storage' }];
  const id = 'sh_' + hex(12);
  if (!thread) thread = `wizard_${Date.now()}_${hex(6)}`;
  const sh = { id, client: key, agent: agent.id, thread, newThread: !b.thread, note: String(b.note || '').slice(0, 20000), status: 'uploading', uploads: [], created: now() };
  S.shares[id] = sh; S.sharesByClient[key] = id;
  for (let i = 0; i < files.length; i++) {
    const [code, u] = createUpload({ ...files[i], client_upload_id: `${key}:${i}` }, id);
    if (code !== 201) { delete S.shares[id]; delete S.sharesByClient[key]; save(); return [code, u]; }
    sh.uploads.push(u.upload_id);
  }
  save();
  log('share:create', id, agent.id, thread, files.length, 'files', total, 'bytes');
  return [201, { ...pubShare(sh), uploads: sh.uploads.map(uid => { const u = S.uploads[uid]; return { upload_id: uid, offset: u.offset, bytes: u.bytes, chunk_bytes: CHUNK }; }) }];
}
function maybeDeliver(sh) {
  if (!sh || sh.status !== 'uploading') return;
  if (!sh.uploads.every(id => S.uploads[id]?.status === 'complete')) return;
  sh.status = 'delivering'; save();
  const files = sh.uploads.map(id => S.files[S.uploads[id].file]);
  const s = S.sessions[sh.thread] || (S.sessions[sh.thread] = { id: sh.thread, title: files[0].filename, agent: sh.agent, source: 'share', started_at: now(), messages: [], archived: false });
  const text = sh.note || `Shared ${files.length} ${files.length === 1 ? 'file' : 'files'}`;
  addMessage(s, 'user', chipsText(text, files));
  S.deliveries.push({ share_id: sh.id, thread_id: sh.thread, agent: sh.agent, files: files.map(f => f.id), at: now() });
  startRun(s, `Got ${files.length} ${files.length === 1 ? 'file' : 'files'}.`);
  sh.status = 'delivered'; save();
  log('share:delivered', sh.id, '→', sh.thread, 'deliveries now', S.deliveries.filter(d => d.share_id === sh.id).length);
}

/* ---------------- minimal Agent Service for the shell ---------------- */
let rowId = 1;
const chipsText = (text, files) => `${text}\n\n[WIZARD_FILE_CHIPS_V1]\n${JSON.stringify(files.map(f => ({ id: f.id, filename: f.filename, mime: f.mime, bytes: f.bytes })))}\n[/WIZARD_FILE_CHIPS_V1]`;
function addMessage(s, role, content) { s.messages.push({ id: rowId++ + s.messages.length * 1000, session_id: s.id, role, content, timestamp: Date.now() / 1000 }); s.updated_at = now(); }
function startRun(s, reply) {
  const id = 'run_' + hex(8);
  S.runs[id] = { id, session_id: s.id, status: 'running', output: '' }; s.status = 'running'; s.run = id; save();
  setTimeout(() => { addMessage(s, 'assistant', reply); S.runs[id].status = 'completed'; S.runs[id].output = reply; s.status = 'completed'; save(); }, 600);
  return id;
}
const sessionRow = s => {
  const last = s.messages[s.messages.length - 1], lastU = [...s.messages].reverse().find(m => m.role === 'user');
  return { id: s.id, title: s.title || 'Untitled chat', source: s.source || 'wizard-mobile', status: s.status || 'completed', archived: !!s.archived, message_count: s.messages.length,
    started_at: s.started_at, last_active: s.updated_at || s.started_at, agent: s.agent,
    latest_message: last ? { role: last.role, content: typeof last.content === 'string' ? last.content.slice(0, 200) : '', timestamp: last.timestamp } : null,
    last_user_message: lastU ? { role: 'user', content: typeof lastU.content === 'string' ? lastU.content.slice(0, 200) : '', timestamp: lastU.timestamp } : null,
    wizard_run_id: s.run || '' };
};
function seed() {
  if (Object.keys(S.sessions).length) return;
  const t = now();
  S.sessions.qa_existing_thread = { id: 'qa_existing_thread', title: 'Trip planning', agent: 'hermes', source: 'wizard-mobile', started_at: t - 3600, messages: [], archived: false };
  addMessage(S.sessions.qa_existing_thread, 'user', 'Plan the trip');
  addMessage(S.sessions.qa_existing_thread, 'assistant', 'Here is a plan.');
  S.sessions.qa_second_thread = { id: 'qa_second_thread', title: 'Receipts', agent: 'hermes', source: 'wizard-mobile', started_at: t - 7200, messages: [], archived: false };
  addMessage(S.sessions.qa_second_thread, 'user', 'Keep my receipts');
  if (AGENTS.length > 1) {
    S.sessions.qa_private_thread = { id: 'qa_private_thread', title: 'Private notes', agent: 'private', source: 'wizard-mobile', started_at: t - 600, messages: [], archived: false };
    addMessage(S.sessions.qa_private_thread, 'user', 'A private note');
  }
  save();
}
seed();

async function shell(req, res, url) {
  const p = url.pathname, m = req.method;
  const agentQ = url.searchParams.get('agent') || 'hermes';
  if (p === '/wizard/hermes/api/sessions' && m === 'GET') {
    const rows = Object.values(S.sessions).filter(s => (s.agent || 'hermes') === agentQ).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    const off = Number(url.searchParams.get('offset') || 0), lim = Number(url.searchParams.get('limit') || 100);
    return send(res, 200, { data: rows.slice(off, off + lim).map(sessionRow), has_more: off + lim < rows.length });
  }
  if (p === '/wizard/hermes/api/sessions' && m === 'POST') {
    const b = await readJson(req); const id = String(b.id || `wizard_${Date.now()}_${hex(6)}`);
    if (!S.sessions[id]) { S.sessions[id] = { id, title: 'Untitled chat', agent: agentQ, source: 'wizard-mobile', started_at: now(), messages: [], archived: false }; save(); }
    return send(res, 201, { session: sessionRow(S.sessions[id]), ...sessionRow(S.sessions[id]) });
  }
  let mm = p.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages|\/model)?$/);
  if (mm) {
    const s = S.sessions[decodeURIComponent(mm[1])];
    if (!s) return send(res, 404, { error: 'not_found' });
    if (mm[2] === '/messages') return send(res, 200, { data: s.messages, has_more: false });
    if (m === 'PATCH') { const b = await readJson(req); if (typeof b.title === 'string') s.title = b.title; if ('archived' in b) s.archived = !!b.archived; save(); }
    return send(res, 200, { session: sessionRow(s), ...sessionRow(s) });
  }
  if (p === '/wizard/hermes/v1/runs' && m === 'POST') {
    const b = await readJson(req, 4 << 20);
    const sid = String(b.session_id || ''); const s = S.sessions[sid] || (S.sessions[sid] = { id: sid, title: 'Untitled chat', agent: agentQ, source: 'wizard-mobile', started_at: now(), messages: [], archived: false });
    const ids = Array.isArray(b.wizard_file_ids) ? b.wizard_file_ids : [];
    const files = ids.map(id => S.files[id]).filter(Boolean);
    const input = typeof b.input === 'string' ? b.input : Array.isArray(b.input) ? b.input.map(x => x.content || x.text || '').join('\n') : '';
    addMessage(s, 'user', files.length ? chipsText(input, files) : input);
    if (s.title === 'Untitled chat') s.title = (input || files[0]?.filename || 'Chat').slice(0, 40);
    const run = startRun(s, files.length ? `Got ${files.length} attached ${files.length === 1 ? 'file' : 'files'}.` : 'OK.');
    S.runs[run].file_ids = ids; S.runs[run].missing = ids.filter(id => !S.files[id]); save();
    log('run', run, sid, 'files', ids.join(','), S.runs[run].missing.length ? 'MISSING ' + S.runs[run].missing : '');
    return send(res, 202, { run_id: run, id: run, status: 'running', session_id: sid });
  }
  mm = p.match(/^\/wizard\/hermes\/v1\/runs\/([^/]+)(\/stop)?$/);
  if (mm) { const r = S.runs[mm[1]]; return r ? send(res, 200, r) : send(res, 404, { error: 'not_found' }); }
  if (p === '/wizard/hermes/api/model/options') return send(res, 200, { model: 'fixture-model', provider: 'fixture', providers: [{ slug: 'fixture', name: 'Synthetic fixture route', authenticated: true, is_current: true, models: ['fixture-model'] }] });
  if (p === '/wizard/thread-seen') { const b = m === 'PUT' ? await readJson(req) : null; return send(res, 200, { state: b }); }
  if (p === '/wizard/thread-dispositions') { req.resume(); return send(res, 200, { state: {} }); }
  if (p === '/wizard/v1/apps') return send(res, 200, { apps: [] });
  mm = p.match(/^\/wizard\/files\/([^/]+)\/content$/);
  if (mm && S.files[mm[1]]) {
    const f = S.files[mm[1]];
    res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.bytes }); return fs.createReadStream(path.join(DIRS.files, f.id)).pipe(res);
  }
  if (p === '/wizard/files/upload' && m === 'POST') return oldUpload(req, res);
  if (m === 'GET' && p.startsWith('/wizard/')) return send(res, 200, {});
  if (p.startsWith('/wizard/')) { log('unhandled', m, p); req.resume(); return send(res, 200, { ok: true }); }
  return null;
}
async function oldUpload(req, res) {
  const id = 'wf_' + hex(16), dst = path.join(DIRS.files, id); let n = 0;
  const out = fs.createWriteStream(dst);
  for await (const c of req) { n += c.length; if (n > OLD_LIMIT) { out.destroy(); fs.rmSync(dst, { force: true }); req.resume(); return send(res, 413, { error: 'too_large' }); } out.write(c); }
  await new Promise(r => out.end(r));
  S.files[id] = { id, filename: cleanName(req.headers['x-wizard-filename']), mime: cleanMime(req.headers['x-wizard-mime']), bytes: n, sha256: '', status: 'ready' };
  S.oldUploads = (S.oldUploads || 0) + 1; save();
  log('old-upload', id, n);
  return send(res, 201, { file: S.files[id] });
}

/* ---------------- static web ---------------- */
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname.replace(/^\/wizard-os-home\/?/, ''));
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(WEB, rel);
  if (!file.startsWith(WEB + path.sep)) return send(res, 403, { error: 'forbidden' });
  try {
    const st = await fsp.stat(file); if (!st.isFile()) throw new Error('dir');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch { send(res, 404, { error: 'not_found' }); }
}

/* ---------------- router ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const p = url.pathname, m = req.method;
  try {
    if (p === '/' ) { res.writeHead(302, { Location: '/wizard-os-home/' }); return res.end(); }
    if (p.startsWith('/wizard-os-home')) return serveStatic(req, res, url);
    if (p === '/__fixture/state') return send(res, 200, {
      shares: Object.values(S.shares).map(sh => ({ ...pubShare(sh), note: sh.note, uploads: sh.uploads.map(id => ({ id, offset: S.uploads[id].offset, bytes: S.uploads[id].bytes, status: S.uploads[id].status, patches: S.uploads[id].patches, conflicts: S.uploads[id].conflicts })) })),
      uploads: Object.values(S.uploads).map(u => ({ id: u.id, client: u.client, filename: u.filename, bytes: u.bytes, offset: u.offset, status: u.status, share: u.share, patches: u.patches, conflicts: u.conflicts, file: u.file || '' })),
      deliveries: S.deliveries, runs: Object.values(S.runs), oldUploads: S.oldUploads || 0,
      sessions: Object.values(S.sessions).map(s => ({ id: s.id, agent: s.agent, title: s.title, messages: s.messages.length, user_messages: s.messages.filter(x => x.role === 'user').map(x => String(x.content).slice(0, 400)) })),
    });
    if (p === '/__fixture/reset' && m === 'POST') { fs.rmSync(DATA, { recursive: true, force: true }); for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true }); S = load(); seed(); return send(res, 200, { ok: true }); }
    if (p === '/wizard/v1/bootstrap') return send(res, 200, {
      bootstrap: 1,
      settings: { owner: { name: '', place: '' }, agent: { name: 'Wizard' }, clock: { timezone: 'UTC', day_starts_at: '00:00' }, voice: { language: 'en', vocabulary: [] }, network: { base_url: '', aliases: [] } },
      capabilities: { files: true, approvals: true, steer: true, markdown: true, ...(RESUMABLE ? { resumable_uploads: true } : {}), ...(AGENTS_N ? { agents: true } : {}) },
      endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', upload: '/wizard/files/upload', apps: '/wizard/v1/apps', ...(RESUMABLE ? { uploads: '/wizard/v1/uploads', shares: '/wizard/v1/shares' } : {}) },
    });
    if (p === '/wizard/v1/agents' && m === 'GET') return AGENTS_N ? send(res, 200, { agents: AGENTS }) : send(res, 404, { error: 'not_found' });
    if (RESUMABLE) {
      if (p === '/wizard/v1/uploads' && m === 'POST') { const [c, j] = createUpload(await readJson(req)); return send(res, c, j); }
      let mm = p.match(/^\/wizard\/v1\/uploads\/(up_[0-9a-f]{32})(\/complete)?$/);
      if (mm) {
        const u = S.uploads[mm[1]]; if (!u) { req.resume(); return send(res, 404, { error: 'not_found' }); }
        if (!mm[2] && m === 'GET') return send(res, 200, pubUpload(u));
        if (!mm[2] && m === 'PATCH') return patchUpload(req, res, u);
        if (mm[2] && m === 'POST') { req.resume(); const [c, j] = await completeUpload(u); return send(res, c, j); }
        return send(res, 405, { error: 'method' });
      }
      if (p === '/wizard/v1/shares' && m === 'POST') { const [c, j] = createShare(await readJson(req)); return send(res, c, j); }
      mm = p.match(/^\/wizard\/v1\/shares\/(sh_[0-9a-f]{24})$/);
      if (mm && m === 'GET') { const sh = S.shares[mm[1]]; return sh ? send(res, 200, pubShare(sh)) : send(res, 404, { error: 'not_found' }); }
    }
    if (await shell(req, res, url) === null) send(res, 404, { error: 'not_found' });
  } catch (e) {
    log('error', m, p, e.message);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
  }
});
server.requestTimeout = 0; server.headersTimeout = 60_000;
server.listen(PORT, HOST, () => log(`share fixture on http://${HOST}:${PORT}/ web=${WEB} data=${DATA} agents=${AGENTS.length} resumable=${RESUMABLE} throttle=${THROTTLE / 1048576}MB/s`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log('exit', sig); process.exit(0); });
