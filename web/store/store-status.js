// Read-only identity/release decisions shared by Store rendering and contract tests.
// A launcher is evidence of an installed app, NOT evidence of its release version.
const HOST_ALIASES = {
  'android-apps': {repo:'humanitylabs-org/android-apps', id:'android-apps', url:'/android-apps/'},
  'wizard-calendar': {repo:'humanitylabs-org/wizard-calendar', id:'calendar', url:'/wizard-calendar/'},
  'wizard-music': {repo:'humanitylabs-org/wizard-music', id:'wizard-music', url:'/wizard-music/'},
  'wizard-search': {repo:'humanitylabs-org/wizard-search', id:'wizard-search', url:'/wizard-search/'},
};
const repo = s => typeof s === 'string' ? s.toLowerCase() : '';
const sameRepo = (a,b) => !!repo(a) && repo(a) === repo(b);
const identity = (a,i) => (i.app_id || i.id) === a.id;
export function architectureReason(a, architecture) {
  const supported = a.architectures || [];
  if (!supported.length) return '';
  if (!architecture) return 'Compatibility unavailable. Refresh before installing.';
  return supported.includes(architecture) ? '' : `This release runs on ${supported.join(' · ')}, not this Wizard (${architecture}). Choose a compatible release.`;
}
export const isUserApp = a => !['wizard-shell','wizard-ux'].includes(a.id) && a.category !== 'interface' && !(a.provides || []).includes('shell');
const alphabetical = (a,b) => String(a || '').localeCompare(String(b || ''),'en');
export const compareApps = (a,b) => Number(!!b.alpha_badge)-Number(!!a.alpha_badge) || alphabetical(a.name,b.name) || alphabetical(a.id,b.id) || alphabetical(a.repo,b.repo);
export function resolveInstalled(a, snapshot, runtipi) {
  const matches = (snapshot.wam || []).filter(i => identity(a,i));
  const same = matches.filter(i => sameRepo(a.repo,i.repo));
  if (same.length) {
    const i = same.find(i => i.commit && i.commit === a.commit) || same.find(i => (a.releases || []).some(r => r.commit && r.commit === i.commit)) || same[0];
    // A source is proved only by an exact catalog pin (or the matching local sidecar).
    const r = (a.releases || [a]).find(r => r.commit && r.commit === i.commit);
    const sidecar = a.installed_commit === i.commit && a.installed_app_id === i.id;
    const track = sidecar ? (a.releases || [a]).find(r => r.source === a.installed_source) : null;
    return {...i, source:sidecar ? a.installed_source : (i.source || r?.source || ''), channel:i.channel || r?.channel || track?.channel || ''};
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
  if(a.conflict || i?.conflict) return 'conflict';
  if(!i) return complete ? 'get' : 'unknown';
  if(a.commit && i.commit === a.commit && sameRepo(a.repo,i.repo)) return 'installed';
  const newer = sameRepo(a.repo,i.repo) && a.commit && i.commit && i.source && i.channel && a.source === i.source && a.channel === i.channel && newerVersion(a.version,i.version);
  if(newer) return complete ? 'update' : 'unknown';
  if(explicit) return complete ? 'switch' : 'unknown';
  // An unknown/different/older pin isn't an upgrade; default action opens the existing copy.
  return 'installed';
}
