// Read-only identity/release decisions shared by Store rendering and contract tests.
// A launcher is evidence of an installed app, NOT evidence of its release version.
const HOST_ALIASES = {
  'wizard-notes': {repo:'humanitylabs-org/wizard-notes', id:'notes', url:'/notes/'},
  'android-apps': {repo:'humanitylabs-org/android-apps', id:'android-apps', url:'/android-apps/'},
  'wizard-calendar': {repo:'humanitylabs-org/wizard-calendar', id:'calendar', url:'/wizard-calendar/'},
  'wizard-music': {repo:'humanitylabs-org/wizard-music', id:'wizard-music', url:'/wizard-music/'},
  'wizard-search': {repo:'humanitylabs-org/wizard-search', id:'search-preview', url:'/wizard-search/'},
  photos: {repo:'humanitylabs-org/wizard-photos-app', id:'photos', url:'/photos/'},
  console: {repo:'humanitylabs-org/vps-terminal', id:'console', url:'/console/'},
};
// Reviewed repository equivalence: forks, renames and private mirrors that publish the same app. Never inferred from names.
const REPO_GROUPS = [
  ['oscarhenrycollins/chatgpt-connection','humanitylabs-org/chatgpt-connection'],
  ['oscarhenrycollins/claude-connection','humanitylabs-org/claude-connection'],
  ['oscarhenrycollins/wizard-tinfoil','humanitylabs-org/wizard-tinfoil'],
  ['oscarhenrycollins/profiles','humanitylabs-org/profiles'],
  ['oscarhenrycollins/browser','humanitylabs-org/browser'],
  ['oscarhenrycollins/wizard-mail','defleur-agents/wizard-mail'],
  ['humanitylabs-org/wizard-food-app','humanitylabs-org/food'], // one GitHub repository, renamed
  ['humanitylabs-org/wizard-shopping','humanitylabs-org/wizard-shopping-history'], // same pinned commit
  ['humanitylabs-org/wizard-search','local/search-preview'],
  ['humanitylabs-org/wizard-notes','local/notes'],
];
const CANON = new Map(REPO_GROUPS.flatMap(g => g.map(r => [r, g[0]])));
// Reviewed installed ids: the same app installed under a staging or earlier id (catalog id -> installed ids).
const INSTALLED_IDS = {'wizard-search':['search-preview'], usuals:['food'], 'wizard-notes':['notes']};
const repo = s => { const r = typeof s === 'string' ? s.replace(/^(?:https:\/\/)?github\.com\//,'').toLowerCase() : ''; return CANON.get(r) || r; };
const sameRepo = (a,b) => !!repo(a) && repo(a) === repo(b);
const identity = (a,i) => { const id = i.app_id || i.id; return id === a.id || (INSTALLED_IDS[a.id] || []).includes(id); };
// One installed registry entry is this catalog listing (same id or reviewed alias, same or equivalent repository).
export const sameInstalled = (a,i) => !!i && identity(a,i) && sameRepo(a.repo,i.repo);
export function architectureReason(a, architecture) {
  const supported = a.architectures || [];
  if (!supported.length) return '';
  if (!architecture) return 'Compatibility unavailable. Refresh before installing.';
  return supported.includes(architecture) ? '' : `This release runs on ${supported.join(' · ')}, not this Wizard (${architecture}). Choose a compatible release.`;
}
// The shell registry id an App Index listing installs as, when a reviewed host alias renames it (else its own id).
export const hostAppId = a => HOST_ALIASES[a?.id]?.id || a?.id || '';
export const isUserApp = a => !['wizard-shell','wizard-ux'].includes(a.id) && a.category !== 'interface' && !(a.provides || []).includes('shell');
// Store kinds describe the owner's experience, not the runtime packaging tier.
// Explicit Agents/Connectors keep their roles; only screenless apps are Agent apps.
export function storeKind(a) {
  if (a.type === 'agent' || a.category === 'agent') return 'agents';
  if (a.type === 'external' || a.category === 'connector') return 'connections';
  return a.type === 'view' || a.has_view === true ? 'apps' : 'agent-apps';
}
const alphabetical = (a,b) => String(a || '').localeCompare(String(b || ''),'en');
export const compareApps = (a,b) => Number(!!b.alpha_badge)-Number(!!a.alpha_badge) || alphabetical(a.name,b.name) || alphabetical(a.id,b.id) || alphabetical(a.repo,b.repo);
export function resolveInstalled(a, snapshot, runtipi) {
  const matches = (snapshot.wam || []).filter(i => identity(a,i));
  // An installed-only row is the registry entry itself: nothing to compare it with.
  const same = matches.filter(i => sameRepo(a.repo,i.repo) || (a.installed_only === true && !a.repo && !i.repo));
  if (same.length) {
    const i = same.find(i => i.commit && i.commit === a.commit) || same.find(i => (a.releases || []).some(r => r.commit && r.commit === i.commit)) || same[0];
    // A source is proved only by an exact catalog pin (or the matching local sidecar).
    const r = (a.releases || [a]).find(r => r.commit && r.commit === i.commit);
    const sidecar = a.installed_commit === i.commit && a.installed_app_id === i.id;
    const track = sidecar ? (a.releases || [a]).find(r => r.source === a.installed_source) : null;
    return {...i, source:i.source || (sidecar ? a.installed_source : (r?.source || '')), channel:i.channel || r?.channel || track?.channel || ''};
  }
  if (matches.length) return {conflict:true}; // Never fall back to a same-ID launcher for another repo.
  const shell = (snapshot.shell || []).filter(i => i.url && !i.system);
  const alias = HOST_ALIASES[a.id];
  // Host launchers do not carry repository pins. Only reviewed id/repo/path aliases
  // may bridge that missing identity; a same-ID foreign catalog is not this app.
  const host = alias && sameRepo(alias.repo,a.repo) && shell.find(i => i.id === alias.id && i.url === alias.url);
  if (host) return {id:host.id, status:host.status || 'unknown'};
  if(shell.some(i => i.id === a.id || i.id === alias?.id)) return {conflict:true};
  const managed = (runtipi || []).find(i => i.info?.id === a.id);
  // Runtipi proves presence by package ID, not which shell launcher owns the repo.
  return managed ? {id:'',status:managed.app?.status || 'unknown'} : null;
}
// Installed identity proved for this exact row: same repository in the WAM registry, or a reviewed host alias.
// A Runtipi-only match (id '') or a same-ID copy from another repository proves nothing about which source it is.
export const exactInstall = (a,i) => !!i && !i.conflict && (i.repo ? sameRepo(a.repo,i.repo) : !!i.id);
// One entry per app ID. Rows from one repository (however its name is spelled) are one source. Same-ID rows from
// different repositories become one conflicted row that keeps the exactly installed repository (when exactly one
// is installed) and lists each repository once in `sources`.
export function mergeConflicts(apps, installedOf = () => null) {
  const groups = new Map();
  for (const a of apps) { if (!groups.has(a.id)) groups.set(a.id, new Map()); const g = groups.get(a.id), k = repo(a.repo) || a.repo; if (!g.has(k)) g.set(k, []); g.get(k).push(a); }
  const out = [];
  for (const byRepo of groups.values()) {
    const sources = [...byRepo.values()].map(rows => { const exact = rows.find(a => exactInstall(a, installedOf(a))); return {row:exact || rows[0], installed:!!exact}; });
    if (sources.length < 2) {
      // Listings spelled with different but equivalent repositories (a fork or mirror) were flagged by the index; they are one source.
      const r = sources[0].row, mirrored = new Set([...byRepo.values()].flat().map(x => String(x.repo || '').replace(/^(?:https:\/\/)?github\.com\//,'').toLowerCase())).size > 1;
      out.push(r.conflict && mirrored ? {...r, conflict:false} : r); continue;
    }
    const installed = sources.filter(s => s.installed), one = installed.length === 1 ? installed[0] : null;
    const ordered = one ? [one, ...sources.filter(s => s !== one)] : sources;
    out.push({...(one || sources[0]).row, conflict:true, sources:ordered.map(({row:a}) => ({repo:a.repo, version:a.version, publisher:a.publisher, source:a.source,
      installed:a === one?.row}))});
  }
  return out;
}
export function preferredRelease(a,i) {
  return (a.releases || []).find(r => i?.commit && sameRepo(i.repo,r.repo) && i.commit === r.commit) || a;
}
function semver(s) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(s || '');
  if (!m || (m[4] || '').split('.').some(x => /^0\d+$/.test(x))) return null;
  return {core:m.slice(1,4).map(BigInt), pre:m[4]?.split('.')};
}
export function newerVersion(a,b) {
  a=semver(a); b=semver(b); if(!a || !b) return false;
  for(let n=0;n<3;n++) if(a.core[n]!==b.core[n]) return a.core[n]>b.core[n];
  if(!a.pre || !b.pre) return !!b.pre && !a.pre;
  for(let n=0;n<Math.max(a.pre.length,b.pre.length);n++) {
    const x=a.pre[n],y=b.pre[n]; if(x===y) continue;
    if(x===undefined || y===undefined) return y===undefined;
    const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);
    return xn && yn ? BigInt(x)>BigInt(y) : xn!==yn ? !xn : x>y;
  }
  return false;
}
export function releaseState(a,i,explicit,complete) {
  // A shared ID blocks installs, but never hides the copy that is provably installed from this row's repository.
  if(i?.conflict || (a.conflict && !exactInstall(a,i))) return 'conflict';
  if(!i) return complete ? 'get' : 'unknown';
  if(a.commit && i.commit === a.commit && sameRepo(a.repo,i.repo)) return 'installed';
  const newer = sameRepo(a.repo,i.repo) && a.commit && i.commit && i.source && i.channel && a.source === i.source && a.channel === i.channel && newerVersion(a.version,i.version);
  if(newer) return complete ? 'update' : 'unknown';
  if(explicit) return complete ? 'switch' : 'unknown';
  // An unknown/different/older pin isn't an upgrade; default action opens the existing copy.
  return 'installed';
}
