#!/usr/bin/env node
// Install the coupled adapter/helper/skill into an explicitly named existing deployment.
import {readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync,chmodSync,rmSync,renameSync} from 'node:fs';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {subscribe,refresh,run,readJSON,atomic,locked} from './wizard-alpha.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const quote=s=>`'${s.replaceAll("'", "'\\''")}'`;
const jsonOut=s=>JSON.parse(s.slice(s.indexOf('[')));
async function main() {
  const f={}; for(let i=2;i<process.argv.length;i+=2) f[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
  if(!f.deployment || !f.home) throw Error('deployment_and_home_required');
  const home=resolve(f.home),d=readJSON(f.deployment);
  for(const k of ['tools_dir','store_dir','env_file','prefix','hermes_home']) if(!isAbsolute(d[k] || '')) throw Error('absolute_deployment_paths_required');
  if(!['systemd-env','container-env','process-env'].includes(d.context) || !Array.isArray(d.restart) || !d.restart.length || !Array.isArray(d.hermes) || !d.hermes.length) throw Error('unsupported_deployment');
  const env={...process.env,HERMES_HOME:d.hermes_home};
  const external=d.skill_mode==='external';
  const skillDir=external?join(d.prefix,'skills'):join(d.hermes_home,'skills');
  const oldDirs=external?jsonOut((await run([...d.hermes,'config','get','skills.external_dirs','--json'],{env})).stdout):[skillDir];
  if(!Array.isArray(oldDirs)) throw Error('external_skill_dirs_not_array');
  return locked(home,'setup',async()=>{
    const receiptPath=join(home,'setup-receipt.json');
    if(f.rollback==='yes') {
      const r=readJSON(receiptPath);
      for(const file of r.files) if(existsSync(file.target) && digest(file.target)!==file.hash) throw Error('deployment_changed_since_setup');
      for(const file of r.files) { if(file.backup) copyFileSync(file.backup,file.target); else rmSync(file.target,{force:true}); }
      if(r.added_skill_dir) await run([...d.hermes,'config','set','skills.external_dirs',JSON.stringify(oldDirs.filter(x=>x!==skillDir))],{env});
      await run(d.restart); renameSync(receiptPath,join(home,`setup-rollback-${Date.now()}.json`)); console.log(JSON.stringify({rolled_back:true,installed_apps_and_data_retained:true})); return;
    }
    if(existsSync(receiptPath)) throw Error('setup_already_managed_rollback_before_replacing');
    const subscription=await subscribe(f.repo,f.ref || 'main',home);
    const files=[], backupDir=join(home,'setup-backup'); mkdirSync(backupDir,{recursive:true,mode:0o700});
    const save=(target,content,mode=0o600)=>{
      const backup=existsSync(target)?join(backupDir,String(files.length)):null;
      if(backup) copyFileSync(target,backup);
      mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,content,{mode});chmodSync(target,mode);
      files.push({target,backup,hash:digest(target)});
    };
    try {
      // Companion modules are copied together; existing unrelated web/core files stay untouched.
      for(const name of ['store-data-origin.mjs','store-index-views.mjs','store-private-catalog.mjs','system-overview.mjs','wizard-alpha.mjs','wizard-alpha-activate.py','wizard-alpha-wam.py']) save(join(d.tools_dir,name),readFileSync(join(root,'tools',name)),0o644);
      for(const name of ['index.html','store.js','store.css']) save(join(d.store_dir,name),readFileSync(join(root,'web/store',name)),0o644);
      save(join(skillDir,'wizard-alpha/SKILL.md'),readFileSync(join(root,'skills/wizard-alpha/SKILL.md')),0o644);
      save(join(skillDir,'wizard-alpha/README.md'),readFileSync(join(root,'docs/wizard-alpha.md')),0o644);
      save(join(d.prefix,'bin/wizard-alpha'),`#!/bin/sh\nexport WIZARD_ALPHA_HOME=${quote(home)}\nexec ${quote(process.execPath)} ${quote(join(d.tools_dir,'wizard-alpha.mjs'))} "$@"\n`,0o755);
      const before=existsSync(d.env_file)?readFileSync(d.env_file,'utf8'):'';
      save(d.env_file,before.split('\n').filter(l=>!/^WIZARD_ALPHA_HOME=/.test(l)).join('\n').trimEnd()+`\nWIZARD_ALPHA_HOME=${JSON.stringify(home)}\n`);
      if(!oldDirs.includes(skillDir)) await run([...d.hermes,'config','set','skills.external_dirs',JSON.stringify([...oldDirs,skillDir])],{env});
      if(external) {
        const readback=jsonOut((await run([...d.hermes,'config','get','skills.external_dirs','--json'],{env})).stdout);
        if(!readback.includes(skillDir)) throw Error('skill_registration_failed');
      } else {
        const list=await run([...d.hermes,'skills','list'],{env});
        if(!list.stdout.includes('wizard-alpha')) throw Error('native_skill_discovery_failed');
      }
      await run(d.restart);
      const u=new URL(d.probe_url); if(u.protocol!=='https:' && !(u.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname))) throw Error('private_probe_origin_required');
      const headers=d.probe_headers_file?readJSON(d.probe_headers_file):{};
      let verified=false;
      for(let i=0;i<15;i++) {
        try {
          const r=await fetch(u,{headers,redirect:'error',signal:AbortSignal.timeout(5000)}),doc=await r.json();
          if(r.ok && doc.sources?.some(s=>s.id===subscription.source && s.revision===subscription.revision && !s.stale)) {verified=true;break;}
        } catch {}
        await new Promise(r=>setTimeout(r,1000));
      }
      if(!verified) throw Error('deployed_store_feed_not_verified');
      atomic(receiptPath,{schema:1,source:subscription.source,revision:subscription.revision,files,added_skill_dir:!oldDirs.includes(skillDir),verified:true});
      console.log(JSON.stringify({setup:true,source:subscription.source,revision:subscription.revision,store_verified:true,helper:join(d.prefix,'bin/wizard-alpha'),skill_directory:skillDir}));
    } catch(e) {
      for(const file of files.reverse()) {if(file.backup) copyFileSync(file.backup,file.target);else rmSync(file.target,{force:true});}
      if(!oldDirs.includes(skillDir)) await run([...d.hermes,'config','set','skills.external_dirs',JSON.stringify(oldDirs)],{env}).catch(()=>{});
      await run(d.restart).catch(()=>{}); throw e;
    }
  });
}
main().catch(e=>{console.error(JSON.stringify({error:/^[a-z_]+$/.test(e.message)?e.message:'setup_failed'}));process.exitCode=1;});
