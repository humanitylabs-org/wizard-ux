/* Owner lifecycle client, shared by the trusted Store and System views. Manager credentials stay server-side. */
(() => {
  'use strict';
  const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const KEY = /^[A-Za-z0-9_-]{16,128}$/;
  const ACTIONS = { install: 'POST', start: 'POST', stop: 'POST', restart: 'POST', update: 'PATCH', uninstall: 'DELETE' };
  const BUSY = new Set(['installing', 'starting', 'stopping', 'updating', 'restarting', 'uninstalling']);
  // Outcomes that may hide an effect: the retry must reuse the same key so the bridge replays or reconciles it.
  // invalid_response: a reply that isn't the Service's JSON, e.g. an outer proxy's 502/504 page after the Service
  // dropped the connection mid-operation (Tailscale Serve answers so) -- a lost reply, not a definitive failure.
  const UNCERTAIN = new Set(['operation_unconfirmed', 'terminal_status_unconfirmed', 'projection_refresh_failed', 'invalid_response']);
  const uncertainError = e => !e.status || UNCERTAIN.has(e.code);
  let current = null, sessionLoad = null;
  const keys = new Map();
  try {
    const saved = JSON.parse(sessionStorage.getItem('wizard-app-operations') || '{}');
    for (const [name, key] of Object.entries(saved)) if (/^[a-z0-9-]+:(install|start|stop|restart|update|uninstall)$/.test(name) && KEY.test(key)) keys.set(name, key);
  } catch {}
  const save = () => { try { sessionStorage.setItem('wizard-app-operations', JSON.stringify(Object.fromEntries(keys))); } catch {} };
  const keyFor = name => { if (!keys.has(name)) { keys.set(name, crypto.randomUUID().replace(/-/g, '')); save(); } return keys.get(name); };
  const clear = name => { keys.delete(name); save(); };
  const error = (message, code, status) => Object.assign(new Error(message), { code, status });
  async function json(path, init = {}) {
    const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
    let data; try { data = await r.json(); } catch { throw error('The installation service returned an unreadable reply.', 'invalid_response', r.status); }
    if (!r.ok) throw error(data.error || `HTTP ${r.status}`, data.error || 'request_failed', r.status);
    return data;
  }
  async function session(force) {
    if (!force && current && Date.now() < current.until) return current;
    if (!sessionLoad) sessionLoad = json('/wizard/v1/app-lifecycle/session').then(s => {
      if (typeof s.csrf !== 'string' || !s.csrf) throw error('Owner session unavailable.', 'owner_session_required', 403);
      // Renew two minutes early (the Service rotates then too), so no write starts on a session about to expire.
      return (current = { csrf: s.csrf, until: Date.now() + Math.max(0, Number(s.expires_in || 0) - 120) * 1000 });
    }).finally(() => { sessionLoad = null; });
    return sessionLoad;
  }
  async function available() {
    if (/\.staging\.wizard\.example$/.test(location.hostname) || window.WizAppInstallReadOnly === true) return false;
    try { return (await json('/wizard/v1/bootstrap')).capabilities?.app_installation === true; } catch { return false; }
  }
  async function installed() {
    const result = await json('/api/apps/installed');
    return (Array.isArray(result.installed) ? result.installed : []).filter(x => ID.test(x?.info?.id || ''));
  }
  async function refresh() {
    try {
      const host = window.top === window ? window : parent;
      await host.WizCore?.apps?.refresh?.();
      host.dispatchEvent(new CustomEvent('wizard:apps-changed'));
    } catch { /* the shell's focus refresh catches up; a read failure cannot change a successful mutation */ }
  }
  const active = new Map();
  async function operate(id, action, form = {}, progress) {
    if (!ID.test(id) || !ACTIONS[action]) throw error('Unsupported app action.', 'invalid_action', 400);
    if (!await available()) throw error('This preview is browse-only.', 'read_only', 405);
    const name = `${id}:${action}`;
    if (active.has(name)) return active.get(name);
    const promise = (async () => {
      const key = keyFor(name);
      const body = action === 'uninstall' ? { removeBackups: false } : action === 'update' ? { performBackup: true } : form;
      const send = s => json(`/api/app-lifecycle/${encodeURIComponent(id + ':wizardapps')}/${action}`, {
        method: ACTIONS[action], headers: { 'Content-Type': 'application/json', 'X-Wizard-CSRF': s.csrf, 'Idempotency-Key': key }, body: JSON.stringify(body),
      });
      progress?.({ state: 'working', action, id });
      let result;
      try {
        try { result = await send(await session(false)); }
        catch (e) { if (e.code !== 'owner_session_required') throw e; result = await send(await session(true)); }
      } catch (e) {
        // Only a lost reply or an unconfirmed outcome keeps the key (retry replays it). A definitive failure, 5xx
        // included (bridge unavailable, store refresh failed), is journaled under its key: retry after repair
        // needs a new one, and the bridge still refuses a new key while that app has an unfinished operation.
        if (!uncertainError(e)) clear(name);
        progress?.({ state: 'error', action, id, uncertain: uncertainError(e), error: e.code });
        throw e;
      }
      // The production bridge waits for terminal state. Verify the published read projection, too.
      let last, hadRead = false, missing = 0;
      for (let i = 0; i < 30; i++) {
        try {
          const rows = await installed(); hadRead = true;
          last = rows.find(x => x.info.id === id);
          if (action === 'uninstall' && !last) { clear(name); await refresh(); return { ...result, status: 'removed' }; }
          if (last && !BUSY.has(last.app?.status)) {
            const status = last.app?.status;
            if ((action === 'install' || action === 'start' || action === 'restart') && status !== 'running') throw error('The app did not reach Running.', 'lifecycle_failed', 422);
            if (action === 'stop' && status !== 'stopped') throw error('The app did not stop.', 'operation_unconfirmed', 502);
            clear(name); await refresh(); return { ...result, status };
          }
          if (!last && action === 'install' && ++missing >= 3) { clear(name); throw error('The app did not install. You can try again.', 'lifecycle_failed', 422); }
        } catch (e) { if (e.code === 'lifecycle_failed' || e.code === 'operation_unconfirmed') throw e; }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      // Publication still pending: keep the key, so a retry replays this operation instead of submitting a new one.
      await refresh();
      return { ...result, status: hadRead && last ? last.app?.status || 'pending' : 'pending', pending: true };
    })().finally(() => { active.delete(name); });
    active.set(name, promise);
    return promise;
  }
  async function install(app, progress, seen = new Set()) {
    if (!ID.test(app?.id || '')) throw error('Invalid app dependency.', 'invalid_dependency', 400);
    const have = new Map((await installed()).map(x => [x.info.id, x.app?.status]));
    if (have.get(app.id) === 'running') { await refresh(); return { success: true, status: 'running', existing: true }; }
    // Installed but stopped (the app or a dependency): Get starts it; an install would be a no-op.
    if (have.get(app.id) === 'stopped') return operate(app.id, 'start', {}, progress);
    if (seen.has(app.id)) throw error('Invalid app dependency.', 'invalid_dependency', 400);
    seen.add(app.id);
    for (const id of (Array.isArray(app.uses) ? app.uses : []).filter(x => ID.test(x)).slice(0, 24)) {
      if (have.get(id) === 'running') continue;
      const d = await json('/wizard/v1/index/search?q=' + encodeURIComponent(id) + '&limit=48');
      const dependency = (d.apps || []).find(a => a.id === id);
      if (!dependency) throw error('Required app is not in this Store: ' + id, 'dependencies_required', 409);
      await install(dependency, progress, seen);
    }
    if (have.get(app.id) === 'running') { await refresh(); return { success: true, status: 'running', existing: true }; }
    return operate(app.id, 'install', {}, progress);
  }
  window.WizAppLifecycle = { available, installed, install, operate, refresh };
})();
