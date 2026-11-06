/* Store's exact release install transaction, shared with the app setup checklist.
 * IDs select a server-authorized release; never accept arbitrary install URLs or refs. */
export async function installRelease(a, { base = new URL('../', import.meta.url) } = {}) {
  const selection = { source: a.source, repo: a.repo, commit: a.commit, operation: a.operation || 'install' };
  const endpoint = new URL('store-install/' + encodeURIComponent(a.id), base).href;
  const r = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify(selection) });
  let j = await r.json().catch(() => ({}));
  if (r.status === 404 && !j.error) throw new Error('This Wizard’s App Manager needs updating before Store installs are available.');
  if (r.status === 403 || r.status === 404) throw new Error(j.error || 'Not allowed.');
  if (!r.ok && r.status !== 202) throw new Error(j.error || `Install failed (${r.status}).`);
  for (let i = 0; j.state === 'installing' && i < 360; i++) {
    await new Promise(res => setTimeout(res, 2500));
    const s = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' });
    j = await s.json().catch(() => ({ state: 'installing' }));
  }
  if (j.state !== 'installed') throw new Error(j.error || 'The App Manager did not finish. Refresh to check its status.');
  if (!j.selection || ['source','repo','commit','operation'].some(k => j.selection[k] !== selection[k])) throw new Error('The App Manager returned a different release. Refresh before retrying.');
  return j;
}
