/* Store "Remove app": one exact-identity request to this Wizard's App Manager (wam store_remove.py).
 * The plan says what removal affects; the POST carries back only the identity and consequences the owner saw.
 * Success means the App Manager's job says removed for that identity; the Store then reads its installed lists back. */
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/, REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/, SHA = /^[a-f0-9]{40}$/;
const UPDATE = 'This Wizard’s App Manager needs updating before apps can be removed here.';
const CHECK = 'Wizard couldn’t confirm the removal. Refresh to check.';
const fail = (message, unknown = false) => Object.assign(new Error(message), { unknown });
const endpoint = (id, base, suffix = '') => new URL('store-install/_remove/' + encodeURIComponent(id) + suffix, base).href;
const json = r => r.json().catch(() => ({}));

export async function removalPlan(id, { base = new URL('../', import.meta.url), fetchImpl = fetch } = {}) {
  if (!ID.test(id || '')) throw fail('Not a valid app.');
  const r = await fetchImpl(endpoint(id, base, '/plan'), { credentials: 'same-origin', cache: 'no-store' });
  const j = await json(r);
  if (r.status === 404 && !j.app) throw fail(UPDATE);
  if (!r.ok) throw fail(j.error || `Couldn’t check this app (${r.status}).`);
  if (j.app !== id) throw fail('The App Manager answered for a different app. Refresh and try again.');
  return j;
}

export async function removeInstalledApp(plan, { base = new URL('../', import.meta.url), fetchImpl = fetch, wait = ms => new Promise(r => setTimeout(r, ms)), polls = 180 } = {}) {
  if (!plan?.installed || !plan.removable) throw fail('This app can’t be removed here.');
  const id = plan.app, ident = plan.identity || {};
  if (!ID.test(id || '') || !REPO.test(ident.repo || '') || !SHA.test(ident.commit || '')) throw fail('This app’s installed identity isn’t valid. Refresh and try again.');
  const body = { repo: ident.repo, commit: ident.commit, dependents: (plan.dependents || []).map(d => d.id), empties: (plan.empties || []).map(e => e.slot) };
  let r;
  try {
    r = await fetchImpl(endpoint(id, base), { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify(body) });
  } catch (_) { throw fail(CHECK, true); }   // the request may have arrived: never assume either way
  let j = await json(r);
  if (r.status === 404) throw fail(j.error || UPDATE);
  if (!r.ok && r.status !== 202) throw fail(j.error || `Not removed (${r.status}).`);
  for (let i = 0; j.state === 'removing' && i < polls; i++) {
    await wait(2500);
    try {
      const s = await fetchImpl(endpoint(id, base), { credentials: 'same-origin', cache: 'no-store' });
      if (!s.ok) throw fail(CHECK, true);
      j = await json(s);
    } catch (_) { throw fail(CHECK, true); }
  }
  const same = j.identity?.repo === body.repo && j.identity?.commit === body.commit;
  if (j.state === 'removed') { if (!same) throw fail('The App Manager reported a different app. Refresh to check.', true); return j; }
  if (j.state === 'failed') throw fail(j.error || 'Not removed.');
  throw fail(j.error || CHECK, true);
}

/* After a confirmed removal: this device's copy of the app's own data that the shell kept for it while its window was
 * sandboxed (wizard-os#133; core/browser-boundary.js appStorage and appIdb): its saved settings
 * (`wos.app-storage.v1.<id>`) and its databases (shell IndexedDB `wos-app-idb-v1`, keys starting with the app id).
 * The confirm sheet says the app data is deleted, so these go too; a later reinstall starts empty. Never creates the
 * shell database when it is not there. Resolves true when nothing of the app is left (or there was nothing). */
export async function forgetAppData(id, { storage = globalThis.localStorage, idb = globalThis.indexedDB, keyRange = globalThis.IDBKeyRange } = {}) {
  if (!ID.test(id || '')) return false;
  let ok = true;
  try { storage?.removeItem?.('wos.app-storage.v1.' + id); } catch (_) { ok = false; }
  // The databases its same-origin page opened (core/app-services.js noteIdb) are no longer its own: turning the browser
  // boundary on later never copies them to a reinstall.
  try {
    const o = JSON.parse(storage?.getItem?.('wos.app-idb-owners.v1') || '{}');
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const left = Object.fromEntries(Object.entries(o).filter(([, v]) => v?.app !== id));
      if (Object.keys(left).length !== Object.keys(o).length) { if (Object.keys(left).length) storage.setItem('wos.app-idb-owners.v1', JSON.stringify(left)); else storage.removeItem('wos.app-idb-owners.v1'); }
    }
  } catch (_) { ok = false; }
  // Likewise the settings keys its same-origin page wrote (core/app-services.js noteLs) and the note of what was copied.
  try {
    const o = JSON.parse(storage?.getItem?.('wos.app-ls-owners.v1') || '{}');
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const left = Object.fromEntries(Object.entries(o).filter(([, v]) => v?.app !== id));
      if (Object.keys(left).length !== Object.keys(o).length) { if (Object.keys(left).length) storage.setItem('wos.app-ls-owners.v1', JSON.stringify(left)); else storage.removeItem('wos.app-ls-owners.v1'); }
    }
    for (const note of ['wos.app-ls-carried.v1', 'wos.app-ls-changed.v1']) {
      const c = JSON.parse(storage?.getItem?.(note) || '{}');
      if (c && typeof c === 'object' && !Array.isArray(c) && Object.prototype.hasOwnProperty.call(c, id)) {
        delete c[id];
        if (Object.keys(c).length) storage.setItem(note, JSON.stringify(c)); else storage.removeItem(note);
      }
    }
  } catch (_) { ok = false; }
  if (!idb?.open || !keyRange?.bound) return ok;
  try {
    const d = await new Promise((res, rej) => {
      const r = idb.open('wos-app-idb-v1');
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) {} };   // not there: leave it so
      r.onsuccess = () => res(r.result);
      r.onerror = () => { const e = r.error; if (e?.name === 'AbortError') res(null); else rej(e); };
      r.onblocked = () => rej(new Error('blocked'));
    });
    if (!d) return ok;
    try {
      const names = [...(d.objectStoreNames || [])].filter(n => n === 'dbs' || n === 'rows');
      if (!names.length) return ok;
      // [id] < [id, …] < [id + '\0']: exactly this app's rows, never another id that starts the same way.
      const range = keyRange.bound([id], [id + '\u0000'], false, true);
      await new Promise((res, rej) => {
        const tx = d.transaction(names, 'readwrite');
        for (const n of names) tx.objectStore(n).delete(range);
        tx.oncomplete = res; tx.onabort = tx.onerror = () => rej(tx.error);
      });
    } finally { d.close(); }
  } catch (_) { ok = false; }
  return ok;
}

/* The Store's note of the apps it removed on this device (`wos.app-removed.v1`: { id: { at, pending? } }, kept 30
 * days). core/app-services.js reads it: a window of the app that was open before `at` never writes the app's data
 * again (its frame lives on until the shell's app list refreshes). `pending` = its data here is not deleted yet; the
 * Store tries again on its next load while the app is still gone, and so does sweepGone below. */
const REMOVED = 'wos.app-removed.v1', KEEP = 30 * 864e5;
function removedNotes(storage, now) {
  let o = {}; try { o = JSON.parse(storage?.getItem?.(REMOVED) || '{}') || {}; } catch (_) {}
  const out = {};
  if (typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) if (ID.test(k) && Number.isFinite(v?.at) && now - v.at < KEEP) out[k] = v.pending === true ? { at: v.at, pending: true } : { at: v.at };
  return out;
}
function saveNotes(storage, o) { try { if (Object.keys(o).length) storage.setItem(REMOVED, JSON.stringify(o)); else storage.removeItem(REMOVED); return true; } catch (_) { return false; } }
// Before deleting: from now on no open window of the app writes its data. Pending until forgetAppData succeeds.
export function markRemoved(id, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  if (!ID.test(id || '')) return false;
  const o = removedNotes(storage, now); o[id] = { at: now, pending: true };
  return saveNotes(storage, o);
}
export function settleRemoved(id, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  const o = removedNotes(storage, now); if (!o[id]) return false;
  o[id] = { at: o[id].at }; return saveNotes(storage, o);
}
// The removed apps whose data on this device is still waiting to be deleted.
export const pendingForgets = ({ storage = globalThis.localStorage, now = Date.now() } = {}) => Object.entries(removedNotes(storage, now)).filter(([, v]) => v.pending).map(([k]) => k);
// Mark (not again on a retry), delete (one more try on failure), settle. True when the data here is gone; false
// leaves it pending.
export async function forgetRemoved(id, { retry = false, ...opts } = {}) {
  if (!retry) markRemoved(id, opts);
  const ok = await forgetAppData(id, opts) || await forgetAppData(id, opts);
  if (ok) settleRemoved(id, opts);
  return ok;
}

/* Apps removed some other way (the agent, the box command, the Store on another device): this device only learns it
 * from the box's app list (core/apps.js calls sweepGone after each fresh read). A list can miss an app for a moment
 * (a broken recipe, an update in between), and deleting is final, so an app the Store removed here goes at once, but
 * any other app with data here (also one the Store removed that came back since) goes only once 2 reads, 24 hours
 * apart or more, both missed it (`wos.app-gone.v1`:
 * { id: { at, reads } }, the first miss). Back in a list: its note goes. Resolves the ids whose data was deleted. */
const GONE = 'wos.app-gone.v1', GONE_WAIT = 24 * 36e5, GONE_READS = 2, PREFIX = 'wos.app-storage.v1.';
// The shell's notes that name an app: which settings keys and databases its same-origin page wrote (owners: { name:
// { app } }) and which keys were copied for it (carried, changed: { app: [keys] }). forgetAppData clears each one, so
// an app removed before the boundary is turned on loses them too, whatever data it had (wizard-ux#1434).
export const APP_NOTES = { owners: ['wos.app-ls-owners.v1', 'wos.app-idb-owners.v1'], byApp: ['wos.app-ls-carried.v1', 'wos.app-ls-changed.v1'] };
// The app ids this device keeps data for: saved settings, the notes above, and databases (shell IndexedDB, never
// created here).
export async function keptAppIds({ storage = globalThis.localStorage, idb = globalThis.indexedDB } = {}) {
  const ids = new Set();
  try { for (let i = 0; i < (storage?.length || 0); i++) { const k = storage.key(i); if (k?.startsWith(PREFIX) && ID.test(k.slice(PREFIX.length))) ids.add(k.slice(PREFIX.length)); } } catch (_) {}
  const note = k => { try { const o = JSON.parse(storage?.getItem?.(k) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (_) { return {}; } };
  for (const k of APP_NOTES.owners) for (const v of Object.values(note(k))) if (typeof v?.app === 'string' && ID.test(v.app)) ids.add(v.app);
  for (const k of APP_NOTES.byApp) for (const id of Object.keys(note(k))) if (ID.test(id)) ids.add(id);
  if (!idb?.open) return ids;
  try {
    const d = await new Promise((res, rej) => {
      const r = idb.open('wos-app-idb-v1');
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) {} };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { const e = r.error; if (e?.name === 'AbortError') res(null); else rej(e); };
      r.onblocked = () => rej(new Error('blocked'));
    });
    if (!d) return ids;
    try {
      if (![...(d.objectStoreNames || [])].includes('dbs')) return ids;
      const keys = await new Promise((res, rej) => { const q = d.transaction(['dbs'], 'readonly').objectStore('dbs').getAllKeys(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
      for (const k of keys) if (Array.isArray(k) && ID.test(k[0] || '')) ids.add(k[0]);
    } finally { d.close(); }
  } catch (_) {}
  return ids;
}
export async function sweepGone(listed, { storage = globalThis.localStorage, now = Date.now(), ...opts } = {}) {
  const keep = new Set([...(listed || [])].map(String));
  if (!keep.size) return [];   // an empty list is a broken read, never a sign that every app is gone
  const o = { storage, now, ...opts }, pending = new Set(pendingForgets(o)), kept = await keptAppIds(o);
  let notes = {}; try { notes = JSON.parse(storage?.getItem?.(GONE) || '{}') || {}; } catch (_) {}
  const next = {}, done = [];
  for (const id of new Set([...kept, ...pending])) {
    // Listed again (reinstalled): a removal still pending here is over; a later miss starts the day's wait anew.
    if (keep.has(id)) { if (pending.has(id)) settleRemoved(id, o); continue; }
    const n = notes[id], first = Number.isFinite(n?.at) && n.at <= now && Number.isSafeInteger(n?.reads) && n.reads > 0 ? n : { at: now, reads: 0 };
    const seen = { at: first.at, reads: first.reads + 1 };
    if ((pending.has(id) || (seen.reads >= GONE_READS && now - seen.at >= GONE_WAIT)) && await forgetRemoved(id, { ...o, retry: pending.has(id) })) { done.push(id); continue; }
    if (!pending.has(id)) next[id] = seen;
  }
  try { if (Object.keys(next).length) storage.setItem(GONE, JSON.stringify(next)); else storage?.removeItem?.(GONE); } catch (_) {}
  return done;
}

// Only an exact App Manager install (repository and full commit), under its own registry id, that is not part of
// Wizard. The server decides again.
export function canRemove(installed, complete) {
  return complete === true && !!installed && !installed.conflict && installed.system !== true && ID.test(installed.id || '')
    && (!installed.app_id || installed.app_id === installed.id) && REPO.test(installed.repo || '') && SHA.test(installed.commit || '');
}

const names = list => list.map(x => x.name || x.id || x.slot).join(', ');
export function confirmView(plan, app = {}, { esc, loading = false, error = '', busy = false } = {}) {
  const name = esc(app?.name || plan?.name || 'This app');
  const head = sub => `<div class="list-head"><button class="back" data-back aria-label="Back">‹</button><div><h2>Remove ${name}?</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div></div>`;
  const alert = message => message ? `<div class="link-error" role="alert">${esc(message)}</div>` : '';
  const close = '<div class="rm-acts"><button type="button" class="rm-cancel" data-back>Back</button></div>';
  if (loading) return head('') + '<p class="mc-lede" role="status">Checking what removing it affects…</p>';
  if (!plan) return head('') + alert(error || CHECK) + close;
  const shown = app?.installed, ident = plan.identity || {};
  if (plan.installed && shown && (ident.repo !== shown.repo || (ident.commit || '') !== (shown.commit || '')))
    return head(ident.repo || '') + alert(`${app.name || plan.name} changed since this page loaded. Refresh and try again.`) + close;
  if (!plan.installed || !plan.removable) return head(ident.repo || '') + alert(plan.reason || 'This app can’t be removed here.') + close;
  const deps = plan.dependents || [], empties = plan.empties || [], n = plan.backups;
  return head(ident.repo) + `<section class="rm-body">
    <p class="d-sum">${name} and its app data on this Wizard will be deleted.</p>
    ${deps.length ? `<p class="d-note">${esc(names(deps))} ${deps.length === 1 ? 'uses' : 'use'} ${name} and may stop working.</p>` : ''}
    ${empties.length ? `<p class="d-note">Nothing else on this Wizard provides ${esc(names(empties))}.</p>` : ''}
    ${Number.isSafeInteger(n) && n > 0 ? `<p class="d-note">${n} earlier backup${n === 1 ? ' is' : 's are'} kept.</p>` : ''}
    ${alert(error)}
    <div class="rm-acts"><button type="button" class="rm-cancel" data-back>Cancel</button><button type="button" class="rm-go" data-remove-confirm${busy ? ' disabled aria-busy="true"' : ''}>${busy ? 'Removing…' : 'Remove app'}</button></div></section>`;
}
