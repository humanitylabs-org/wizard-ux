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
