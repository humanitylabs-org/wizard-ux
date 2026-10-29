// Fixed GitHub endpoints only. No redirects, unbounded bodies, browser credentials or client-selected refs.
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readCapped} from './store-index-views.mjs';
import {parseInstallLink} from '../web/store/install-link.js';
const scalar = (v, max) => typeof v === 'string' && v.length <= max && !/[<>\x00-\x1f\x7f]/.test(v) ? v : '';
export function manifestProjection(markdown) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1];
  if (!front) throw Error('manifest');
  const fields = {}, lines = front.split(/\r?\n/);
  // We need only top-level display scalars, not a general YAML/config evaluator. Complex values fail closed.
  for (let n = 0; n < lines.length; n++) {
    const m = /^(id|name|summary|type|version|publisher):\s*(.*?)\s*$/.exec(lines[n]);
    if (!m) continue;
    if (Object.hasOwn(fields, m[1])) throw Error('duplicate');
    let value = m[2];
    if (/^[>|][-+]?$/.test(value)) {
      const block=[]; while (n + 1 < lines.length && /^(?:\s+|$)/.test(lines[n+1])) block.push(lines[++n].trim());
      value=block.join(' ').trim();
    } else if (value.startsWith('"')) { try { value=JSON.parse(value); } catch { throw Error('scalar'); } }
    else if (value.startsWith("'")) { if (!value.endsWith("'")) throw Error('scalar'); value=value.slice(1,-1).replace(/''/g,"'"); }
    else { value=value.replace(/\s+#.*$/, ''); if (/^[\[\]{&*!]/.test(value)) throw Error('scalar'); }
    fields[m[1]]=value;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(fields.id || '') || !['view','service','agent','external'].includes(fields.type) || !scalar(fields.name,80)) throw Error('manifest');
  return {id:fields.id, name:fields.name, summary:scalar(fields.summary,300), type:fields.type, version:scalar(fields.version,40), publisher:scalar(fields.publisher,80)};
}
function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return readFileSync(join(homedir(),'.wizard-os/github-token'),'utf8').trim(); } catch { return ''; }
}
export async function linkPreview(q, {fetchImpl=fetch, index, readToken=token} = {}) {
  const parsed=parseInstallLink(q);
  if (!parsed.ok || q.has('from') || q.has('view')) return {status:400, body:{error:parsed.error || 'The preview accepts only a repository and commit.'}};
  const {repo}=parsed;
  const auth=readToken();
  const headers={Accept:'application/vnd.github+json', ...(auth ? {Authorization:'Bearer '+auth} : {})};
  const request=async (path, raw=false) => {
    const r=await fetchImpl('https://api.github.com/repos/'+repo+path, {headers:{...headers,...(raw ? {Accept:'application/vnd.github.raw+json'} : {})}, redirect:'error',signal:AbortSignal.timeout(8000)});
    if (!r.ok) throw Error('unavailable');
    const text=(await readCapped(r,raw ? 64*1024 : 256*1024)).toString('utf8');
    return raw ? text : JSON.parse(text);
  };
  try {
    const commit=parsed.commit || (await request('/commits/HEAD')).sha;
    if (!/^[a-fA-F0-9]{40}$/.test(commit || '')) throw Error('commit');
    const app=manifestProjection(await request('/contents/wizard.md?ref='+commit,true));
    let catalog;
    try { const r=await index?.('/apps/'+repo,new URLSearchParams()); if(r?.status===200) catalog=r.body; } catch { /* preview still works when catalog is unavailable */ }
    return {status:200,body:{...app,repo,commit,source:'link',...(typeof catalog?.private === 'boolean'?{private:catalog.private}:{}),...(catalog?.source?{catalog_source:catalog.source}:{})}};
  } catch { return {status:422,body:{error:'The GitHub app could not be previewed. Check repository access and its wizard.md manifest.'}}; }
}
