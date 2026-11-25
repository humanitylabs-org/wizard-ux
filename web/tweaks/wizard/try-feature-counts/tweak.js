// Share feature counts (wizard-app-manager issue 701): a box-side switch. While it is on, this shell reads the Try new
// features state (tried, thumbs) of every app that declares switches the way the Tracker's Try it does (same origin, the
// owner's Serve login, X-Wizard-Switch: 1) and hands it to this box's App Manager, which sends only anonymous counts
// (wizard-app-manager wam/switch_feedback.py). Apps the App Manager already reads itself (owner proof) are left to it.
// Runs a few seconds after the shell starts, then at most every 10 minutes while the shell is visible.
const EVERY_MS = 10 * 60 * 1000, FIRST_MS = 4000;
const APP = /^[a-z0-9][a-z0-9-]{0,62}$/, PATHS = ['/api/switches', '/api/view/switches'];
const home = p => { try { return new URL(p, document.baseURI || location.href).pathname; } catch (e) { return '/wizard-os-home/' + p; } };

async function listing(fetchFn, app) {
  for (const p of PATHS) {
    const r = await fetchFn('/' + encodeURIComponent(app) + p, { credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', 'X-Wizard-Switch': '1' } });
    if (r.status === 404) continue;
    const j = /json/.test(r.headers.get('content-type') || '') ? await r.json().catch(() => null) : null;
    return r.ok && j && Array.isArray(j.switches) ? j.switches : null;
  }
  return null;
}

/** Read every switch-declaring app the App Manager couldn't call itself and post what it says to the App Manager. */
async function collect(fetchFn) {
  const r = await fetchFn(home('store-install/_feature-switches'), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
  const cat = r.ok ? await r.json().catch(() => null) : null;
  const apps = (cat && Array.isArray(cat.apps) ? cat.apps : []).filter(a => a && a.ok === false && APP.test(String(a.id || '')));
  const out = [];
  for (const a of apps) {
    try {
      const sw = await listing(fetchFn, a.id);
      if (sw) out.push({ id: a.id, switches: sw.filter(s => s && typeof s.id === 'string').map(s => ({ id: s.id, issues: s.issues || [], tried: s.tried === true, vote: s.vote === 'up' || s.vote === 'down' ? s.vote : null })) });
    } catch (e) { /* that app is restarting or gone: next time */ }
  }
  if (!out.length) return { apps: 0 };
  const p = await fetchFn(home('store-install/_switch-feedback'), { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify({ apps: out }) });
  return { apps: out.length, status: p.status };
}

export default function setup(api) {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function' || typeof document === 'undefined') return () => {};
  let last = 0, busy = false, dead = false;
  const run = () => {
    if (dead || busy || document.visibilityState === 'hidden' || Date.now() - last < EVERY_MS) return;
    busy = true; last = Date.now();
    collect((...a) => window.fetch(...a)).catch(() => {}).finally(() => { busy = false; });
  };
  const first = setTimeout(run, FIRST_MS), timer = setInterval(run, EVERY_MS);
  const onShow = () => run();
  document.addEventListener('visibilitychange', onShow);
  return () => { dead = true; clearTimeout(first); clearInterval(timer); document.removeEventListener('visibilitychange', onShow); };
}
setup.collect = collect;   // for tests (tests/try-feature-counts.test.mjs)
