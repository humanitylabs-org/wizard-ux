// Run ONLY on Thales, under /usr/bin/lockf worker.lock. All suites use intercepted APIs.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{spawnSync}=require('child_process');
if(!process.env.WIZARD_WORK_ROOT)throw Error('Remote Thales-only QA');
const root=__dirname,base=path.dirname(root),evidence=path.join(base,'evidence');
const suites=['qa-microphone-lock.cjs','qa-awake.cjs','qa-device.cjs','qa-dock-morph.cjs','qa-hold-command.cjs','qa-voice-nav.cjs','qa-model-route-contract.cjs','qa-cancel-recover.cjs','qa-app-capture/run.cjs'];
const results=fs.existsSync(path.join(evidence,'regressions.json'))?JSON.parse(fs.readFileSync(path.join(evidence,'regressions.json'))).results:[];
for(const tree of (process.env.QA_TREES||'baseline,candidate').split(','))for(const suite of (process.env.QA_SUITES?process.env.QA_SUITES.split(','):suites)){
 const dir=path.join(base,tree),shots=path.join(evidence,tree,suite.replace(/[/.]/g,'-'));fs.mkdirSync(shots,{recursive:true});
 const env={...process.env,QA_WEB_DIR:dir,QA_SHOTS:shots,QA_BLOCK_WRITES:'1',PLAYWRIGHT_PATH:process.env.PW,PLAYWRIGHT_MODULE:process.env.PW,CHROMIUM:process.env.QA_CHROME,CAPTURE_EVIDENCE:shots,SOURCE_SHA:process.env.SOURCE_SHA};
 const args=['-r',path.join(dir,'qa-thales-loader.cjs')];
 if(['qa-awake.cjs','qa-hold-command.cjs'].includes(suite))args.push('-r',path.join(dir,'qa-microphone-lock-fixtures.cjs'));
 args.push(path.join(dir,suite));
 const start=Date.now(),r=spawnSync(process.execPath,args,{env,timeout:220000,encoding:'utf8',maxBuffer:20*1024*1024});
 const log=path.join(evidence,tree+'-'+suite.replace(/[/.]/g,'-')+'.log');fs.writeFileSync(log,(r.stdout||'')+(r.stderr||'')+(r.error?String(r.error):''));
 const row={tree,suite,exit:r.status,signal:r.signal,ms:Date.now()-start,log,summary:((r.stdout||'').match(/\d+ pass[^\n]*|\d+ passed[^\n]*/g)||[]).slice(-1)[0],failures:(r.stdout||'').split('\n').filter(x=>x.startsWith('FAIL'))};const old=results.findIndex(x=>x.tree===tree&&x.suite===suite);if(old>=0)results.splice(old,1);results.push(row);console.log(JSON.stringify(row));
 fs.writeFileSync(path.join(evidence,'regressions.json'),JSON.stringify({hostname:os.hostname(),results},null,2));
}
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(dir,x.name)):[path.join(dir,x.name)]);
const hashes={hostname:os.hostname(),trees:{}};for(const tree of ['baseline','candidate']){hashes.trees[tree]={};const dir=path.join(base,tree);for(const f of [...walk(path.join(dir,'web')).map(f=>path.relative(dir,f)),'qa-microphone-lock.cjs','qa-microphone-lock-fixtures.cjs','qa-microphone-lock-remote.cjs'])hashes.trees[tree][f]=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,f))).digest('hex');}fs.writeFileSync(path.join(evidence,'remote-hashes.json'),JSON.stringify(hashes,null,2));
