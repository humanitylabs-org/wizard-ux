// Fake Agent Service for the Setup app (QA + local demos). No tailnet, no Wizard box, no private data.
// Serves <web dir> at /wizard-os-home/ and fakes the Setup API from the phone-setup contract:
//   GET  /wizard/v1/setup            { first_run, items:[{id:'phone', title, state}] }
//   POST /wizard/v1/setup/seen       marks first run done
//   GET  /wizard/v1/setup/phone      { step, auth_url, https_enable_url, wizard_url, device_name, phones, install_url, error }
//   POST /wizard/v1/setup/phone/start  off → (after startDelayMs) signin with auth_url
//   POST /wizard/v1/setup/phone/reset  → off
// With --walk, a started sign-in keeps going by itself: signin → https → serving → phone_seen, walkMs apart.
// Test control (never part of the real API):
//   POST /__fake/state  JSON merged into the state ({ firstRun, owner, phone:{…}, fail:{ '<path>': status } })
//   GET  /__fake/log    every API request seen [{ t, method, path }]   POST /__fake/reset  back to defaults
// Everything else under /wizard/ answers 404 (the shell already copes with a box that lacks an endpoint).
// Usage: node tools/fake-setup-api.cjs [port=9473] [webDir=<repo>/web] [--walk] [--owner=Name]
const http = require('http'), fs = require('fs'), path = require('path');
const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), pos = args.filter(a => !a.startsWith('--'));
const PORT = +(pos[0] || process.env.FAKE_SETUP_PORT || 9473);
const WEB = path.resolve(pos[1] || path.join(__dirname, '..', 'web'));
const WALK = flags.includes('--walk');
const OWNER = (flags.find(f => f.startsWith('--owner=')) || '').slice(8);
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; font-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'";
const STUBS = { 'data.js': 'window.WIZ_DATA={projects:{},threads:[]};', 'summaries.js': "window.WIZ_SUMM={days:{},weeks:{},month:''};" };
const EXAMPLE = { auth_url: 'https://login.tailscale.com/a/example-sign-in', https_enable_url: 'https://login.tailscale.com/f/serve?node=example', device_name: 'wizard.tail1234.ts.net', wizard_url: 'https://wizard.tail1234.ts.net/' };

const fresh = () => ({ firstRun: true, owner: OWNER, startDelayMs: 0, walkMs: 4000, fail: {}, delay: {},
  phone: { step: 'off', auth_url: null, https_enable_url: null, wizard_url: null, device_name: null, phones: [], install_url: 'https://tailscale.com/download', error: null } });
let S = fresh(), LOG = [], timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, ms));
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
const itemState = () => ({ off: 'todo', unavailable: 'todo', signin: 'in_progress', https: 'in_progress', serving: 'in_progress', phone_seen: 'done' }[S.phone.step] || 'todo');
const setStep = (step, extra = {}) => {
  const p = S.phone;
  const base = { step, error: null, auth_url: null, https_enable_url: null, wizard_url: null, device_name: null };
  if (step === 'signin') base.auth_url = EXAMPLE.auth_url;
  if (step === 'https') { base.https_enable_url = EXAMPLE.https_enable_url; base.device_name = EXAMPLE.device_name; }
  if (step === 'serving' || step === 'phone_seen') { base.wizard_url = EXAMPLE.wizard_url; base.device_name = EXAMPLE.device_name; }
  if (step === 'phone_seen' && !p.phones.length) base.phones = [{ name: 'Pixel 8', os: 'android', online: true }];
  if (step === 'off') base.phones = [];
  S.phone = { ...p, ...base, ...extra };
};
function walk() {
  const order = ['signin', 'https', 'serving', 'phone_seen'];
  const next = () => { const i = order.indexOf(S.phone.step); if (i < 0 || i === order.length - 1) return; setStep(order[i + 1]); later(next, S.walkMs); };
  later(next, S.walkMs);
}
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch (e) { r({}); } }); });

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname, m = req.method;
  if (p.startsWith('/__fake/')) {
    if (p === '/__fake/log') return json(res, 200, LOG);
    if (p === '/__fake/state' && m === 'GET') return json(res, 200, S);
    if (p === '/__fake/reset') { clearTimers(); S = fresh(); LOG = []; return json(res, 200, S); }
    if (p === '/__fake/state') {
      const b = await readBody(req);
      if (b.phone) { if (b.phone.step && Object.keys(b.phone).length === 1) setStep(b.phone.step); else S.phone = { ...S.phone, ...b.phone }; }
      for (const k of ['firstRun', 'owner', 'startDelayMs', 'walkMs', 'fail', 'delay']) if (k in b) S[k] = b[k];
      return json(res, 200, S);
    }
    return json(res, 404, {});
  }
  if (p.startsWith('/wizard/')) {
    if (p.startsWith('/wizard/v1/setup')) LOG.push({ t: Date.now(), method: m, path: p });
    const f = S.fail[p] || S.fail[m + ' ' + p];
    if (f) return f === 'drop' ? req.socket.destroy() : json(res, f, { error: 'fake', detail: 'forced ' + f });
    const d = S.delay[p]; if (d) await new Promise(r => setTimeout(r, d));
    if (p === '/wizard/hermes/api/sessions' && m === 'GET') return json(res, 200, { data: [], has_more: false }); // an empty, healthy box: no 'Reconnecting…' in screenshots
    if (p === '/wizard/v1/bootstrap' && m === 'GET') return json(res, 200, { bootstrap: 1, settings: { owner: { name: S.owner, place: '' }, agent: { name: 'Wizard' }, clock: { timezone: '', day_starts_at: '00:00' }, voice: { language: '', vocabulary: [] } }, capabilities: {}, endpoints: {} });
    if (p === '/wizard/v1/setup' && m === 'GET') return json(res, 200, { first_run: !!S.firstRun, items: [{ id: 'phone', title: 'Use Wizard on your phone', state: itemState() }] });
    if (p === '/wizard/v1/setup/seen' && m === 'POST') { S.firstRun = false; return json(res, 200, { ok: true }); }
    if (p === '/wizard/v1/setup/phone' && m === 'GET') return json(res, 200, S.phone);
    if (p === '/wizard/v1/setup/phone/start' && m === 'POST') {
      if (S.phone.step === 'unavailable') return json(res, 200, S.phone);
      if (S.phone.step === 'off') {
        clearTimers(); S.phone = { ...S.phone, error: null };
        const go = () => { setStep('signin'); if (WALK) walk(); };
        if (S.startDelayMs > 0) later(go, S.startDelayMs); else go();
      } else if (S.phone.error) S.phone = { ...S.phone, error: null };
      return json(res, 200, S.phone);
    }
    if (p === '/wizard/v1/setup/phone/reset' && m === 'POST') { clearTimers(); setStep('off'); return json(res, 200, S.phone); }
    return json(res, 404, { error: 'not_found' });
  }
  let rel = p.startsWith('/wizard-os-home/') ? p.slice('/wizard-os-home/'.length) : p === '/wizard-os-home' ? '' : null;
  if (rel == null) { res.writeHead(302, { location: '/wizard-os-home/' }); return res.end(); }
  rel = decodeURIComponent(rel) || 'index.html';
  if (rel.includes('..') || rel.split('/').some(s => s.startsWith('.'))) { res.writeHead(404); return res.end(); }
  let file = path.join(WEB, rel);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    if (STUBS[rel]) { res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' }); return res.end(STUBS[rel]); }
    res.writeHead(404); return res.end();
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'content-security-policy': CSP });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`fake-setup-api http://127.0.0.1:${PORT}/wizard-os-home/ → ${WEB}${WALK ? ' (walk)' : ''}`));
