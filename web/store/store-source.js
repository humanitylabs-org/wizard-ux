// Installed provenance wins over catalog availability. Only one source chip per app.
export function sourceLabel(app = {}, installed) {
  const a = installed && (installed.source || installed.repo || installed.local) ? {...installed, publisher:installed.publisher || app.publisher, from:installed.from || app.from, ...(installed.source ? {} : {private:app.private,channel:app.channel})} : app;
  if (a.source === 'link' || a.install_link === true) return {kind:'link', label:'Link', detail:a.from ? `Shared with you by ${a.from}` : ''};
  if (a.source === 'local' || /^local\//.test(a.repo || '') || typeof a.local === 'string' || typeof a.source?.local === 'string') return {kind:'local', label:'Local', detail:''};
  if (a.private === true || a.source === 'owner-private' || a.channel === 'alpha' || (a.source && !['standard','local','link'].includes(a.source))) return {kind:'beta', label:'Beta', detail:a.publisher ? `Shared with you by ${a.publisher}` : ''};
  return {kind:'public', label:'Public', detail:''};
}
// Keep unmatched installed apps discoverable without inventing catalog releases or install actions.
export function installedOnlyApps(catalog, registry = []) {
  const repo = r => String(r || '').replace(/^(?:https:\/\/)?github\.com\//,'').toLowerCase();
  return registry.filter(i => !catalog.some(a => a.id === (i.app_id || i.id) && repo(a.repo) === repo(i.repo))).map(i => ({
    id:i.app_id || i.id, name:i.name || i.app_id || i.id, summary:i.summary || 'Installed on this Wizard',
    type:i.type || 'service', repo:i.repo || '', commit:i.commit || '', version:i.version || '', source:i.source,
    installed_only:true,
  }));
}
