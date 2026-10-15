// Optional owner-supplied private test pins, never sent to the public index.
import {readFileSync} from 'node:fs';
export function privateApps(path = process.env.WAM_PRIVATE_CATALOG) {
  if (!path) return [];
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (doc.schema !== 1 || doc.scope !== 'private-test' || !Array.isArray(doc.apps)) throw Error('invalid_private_catalog');
  return doc.apps.map(a => {
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(a.id) || !/^[0-9a-f]{40}$/.test(a.commit) || !/^[\w.-]+\/[\w.-]+$/.test(a.repo)) throw Error('invalid_private_pin');
    return {id:a.id,name:a.name,summary:a.summary,version:a.version,repo:a.repo,publisher:'Humanity Labs · private test',
      type:'view',category:'app',tags:['private-test'],architectures:a.architectures,uses:[],provides:[],
      url:`https://github.com/${a.repo}/tree/${a.commit}`,private:true,install:{commit:a.commit},
      install_command:`WAM_PRIVATE_CATALOG=/path/to/private-test-catalog.json wam install ${a.id}`};
  });
}
export function withPrivateCatalog(upstream, read = privateApps) {
  return async (path, q) => {
    const rows=read();
    const detail=rows.find(a => path===`/apps/${a.repo}`);
    if (detail) return {status:200,body:detail};
    // Do not leak private names or IDs into upstream searches.
    if (path==='/search') {
      const term=(q.get('q')||'').toLowerCase(), id=q.get('id');
      const filtered=rows.filter(a => (!id || a.id===id) && (!term || `${a.name} ${a.summary}`.toLowerCase().includes(term)) && (!q.get('tag') || q.get('tag')==='private-test') && (!q.get('type') || q.get('type')==='view') && (!q.get('category') || q.get('category')==='app'));
      if (id && rows.some(a=>a.id===id) || q.get('tag')==='private-test' || term && filtered.length) return {status:200,body:{apps:filtered,next_offset:null}};
      const r=await upstream(path,q);
      if (r.status!==200) return rows.length ? {status:200,body:{apps:filtered,next_offset:null,public_index_unavailable:true}} : r;
      const privateIds=new Set(rows.map(a=>a.id));
      return {...r,body:{...r.body,apps:[...filtered,...(r.body.apps||[]).filter(a=>!privateIds.has(a.id))]}};
    }
    return upstream(path,q);
  };
}
