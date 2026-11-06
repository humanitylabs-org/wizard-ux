// A share link is a selection, never an arbitrary fetch URL or executable ref.
const REPO = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;
const bad = error => ({ok:false, error});
export function githubRepo(value) {
  if (typeof value !== 'string' || value.length > 201) return '';
  const repo = value.replace(/^https:\/\/github\.com\//, '').replace(/^github\.com\//, '');
  return REPO.test(repo) ? repo : '';
}
export function parseInstallLink(input) {
  let q;
  try {
    if (input instanceof URLSearchParams) q = input;
    else if (typeof input === 'string' && input.length <= 4096) {
      if (githubRepo(input)) q = new URLSearchParams({repo:input});
      else {
        const u = new URL(input);
        if (u.username || u.password || u.port || u.hash) return bad('Use a Wizard install link.');
        if (u.protocol === 'wizard:') {
          if (u.hostname !== 'install' || u.pathname) return bad('Use a Wizard install link.');
        } else if (u.protocol !== 'https:' || !['/wizard-os-home/', '/wizard-os-home/index.html'].includes(u.pathname) || u.searchParams.get('view') !== 'install') return bad('Use a Wizard install link.');
        q = u.searchParams;
      }
    } else return bad('Use a Wizard install link.');
    for (const k of q.keys()) if (!['repo','commit','from','view'].includes(k) || q.getAll(k).length !== 1) return bad('The link has an unknown or repeated field.');
    if (q.has('view') && q.get('view') !== 'install') return bad('Use a Wizard install link.');
    const repo = githubRepo(q.get('repo'));
    if (!repo) return bad('The repository must be a GitHub owner/repository.');
    const commit = q.get('commit') ?? '';
    if (q.has('commit') && !/^[a-fA-F0-9]{40}$/.test(commit)) return bad('The commit must be a full 40-character GitHub SHA.');
    const from = q.get('from') ?? '';
    if (from.length > 60 || /[<>\x00-\x1f\x7f]/.test(from)) return bad('The sender must be plain text, up to 60 characters.');
    return {ok:true, repo, commit, from};
  } catch (_) { return bad('Use a Wizard install link.'); }
}
export function installShareLink(app) {
  if (/^local\//.test(app?.repo || '')) return '';
  const repo = githubRepo(app?.repo);
  if (!repo || !/^[a-fA-F0-9]{40}$/.test(app?.commit || '')) return '';
  return 'wizard://install?' + new URLSearchParams({repo:'github.com/' + repo, commit:app.commit});
}
