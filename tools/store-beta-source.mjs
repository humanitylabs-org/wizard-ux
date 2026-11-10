// Beta source: private GitHub repositories tagged `wizard-app` that the signed-in GitHub account can see.
// Read-only and server-side. The credential (the file the GitHub sign-in writes) never leaves this process; the
// browser only sees the display projection below. No credential => no request and no rows.
import {createHash} from 'node:crypto';
import {githubReader, manifestProjection, token} from './store-link-preview.mjs';
const REPO=/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;
const TOPIC='wizard-app', MAX_REPOS=30, MAX_MANIFESTS=200, PARALLEL=4;

export function createBetaSource({fetchImpl=fetch, readToken=token, now=Date.now, ttl=5*60*1000} = {}) {
  let cache=null, who='', manifests=new Map(), inflight=null;
  const reset=() => { cache=null; who=''; manifests=new Map(); };
  async function load(auth) {
    const read=githubReader({fetchImpl, auth, limit: 2*1024*1024});
    const found=await read('search/repositories?'+new URLSearchParams({q:'topic:'+TOPIC, sort:'updated', per_page:String(MAX_REPOS)}), {base:'/'});
    const repos=(Array.isArray(found?.items) ? found.items : []).filter(x => x?.private === true && typeof x.full_name === 'string' && REPO.test(x.full_name)).slice(0,MAX_REPOS);
    const rows=[]; let skipped=0, next=0;
    const one=async item => {
      const repo=item.full_name;
      try {
        const sha=(await read(repo+'/commits/HEAD')).sha;
        if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw Error('commit');
        const commit=sha.toLowerCase(), k=repo+'@'+commit;
        let app=manifests.get(k);
        if (!app) {
          app=manifestProjection(await read(repo+'/contents/wizard.md?ref='+commit, {raw:true}));
          if (manifests.size >= MAX_MANIFESTS) manifests.clear();
          manifests.set(k, app);
        }
        // Same display fields as every catalog row; `beta` is the source id the Store labels "Beta".
        rows.push({...app, repo, commit, publisher: app.publisher || repo.split('/')[0], category:'app', tags:[], uses:[], provides:[],
          source:'beta', source_name:'Beta', channel:'standard', private:true, url:`https://github.com/${repo}/tree/${commit}`});
      } catch { skipped++; }   // an unreadable repository or an invalid wizard.md never fails the others
    };
    await Promise.all(Array.from({length:Math.min(PARALLEL,repos.length)}, async () => { while (next < repos.length) await one(repos[next++]); }));
    rows.sort((a,b) => a.repo.localeCompare(b.repo));
    return {rows, skipped};
  }
  // -> {signedIn, rows, stale, error}. `force` (the Store's Refresh) bypasses the cache; a failure keeps the last rows.
  return async function betaSource({force=false} = {}) {
    const auth=readToken();
    if (!auth) { reset(); return {signedIn:false, rows:[], stale:false, error:null}; }
    const id=createHash('sha256').update(auth).digest('hex');
    if (id !== who) { reset(); who=id; }
    if (!force && cache && now()-cache.at < ttl) return {signedIn:true, rows:cache.rows, stale:cache.stale, error:cache.error};
    // A result for a credential that was since replaced or removed is dropped, never shown under the new one.
    if (!inflight) inflight=load(auth).then(r => { if (who === id) cache={at:now(), rows:r.rows, stale:false, error:null}; })
      .catch(() => { if (who === id) cache={at:now(), rows:cache?.rows || [], stale:true, error:'beta_unavailable'}; })
      .finally(() => { inflight=null; });
    const waited=inflight; await waited;
    return who === id && cache ? {signedIn:true, rows:cache.rows, stale:cache.stale, error:cache.error} : {signedIn:false, rows:[], stale:false, error:null};
  };
}
