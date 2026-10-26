// Existing safety suites against disposable canonical IDs, candidate and exact live base.
const {fixture}=require('./offline-chats-fixture.cjs'),{spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const candidate=path.resolve(__dirname,'..'),baseline=path.resolve(process.env.QA_BASELINE_TREE||'../baseline'),out=path.resolve(process.env.QA_OUT||'qa-live/offline-regressions');
fs.mkdirSync(out,{recursive:true});const results=[];
async function run(label,tree,name,script,args=[],extra={}){
 const dir=path.join(out,label,name);fs.mkdirSync(dir,{recursive:true});
 const f=fixture(tree,{apps:[{id:'wizard-manager',name:'Manager',url:'/wizard-manager/',source:'apps.json'}]});const origin=await f.start();
 try{
  const file=fs.openSync(path.join(dir,'stdout.txt'),'w');
  const env={...process.env,QA_TREE:tree,QA_WEB_DIR:tree,WEB:path.join(tree,'web'),UPSTREAM:origin,ID:'flight-1',QA_URL:origin+'/wizard-os-home/',QA_OUT:dir,PORT:'9499',WIZARD_WORK_ROOT:dir,...extra};
  // The fixture must keep its event loop running while each child awaits responses.
  const child=spawn(process.execPath,[path.join(tree,script),...args.map(a=>a==='$URL'?origin+'/wizard-os-home/':a)],{cwd:tree,env,stdio:['ignore',file,file]});
  const timer=setTimeout(()=>child.kill('SIGKILL'),180000);const code=await new Promise(r=>child.on('exit',(c,s)=>r(s||c)));clearTimeout(timer);fs.closeSync(file);
  results.push({tree:label,suite:name,code,log:path.join(dir,'stdout.txt')});console.log(label,name,code);
 }finally{await f.close();}
}
(async()=>{
 for(const [label,tree]of [['baseline',baseline],['candidate',candidate]]){
  await run(label,tree,'qa-outbox','qa-outbox.cjs');
  await run(label,tree,'qa-pending-echo','qa-pending-echo.cjs',['$URL']);
  await run(label,tree,'qa-chats-snapshot','qa-chats-snapshot.cjs');
  await run(label,tree,'qa-sent-voice','qa-manager-native.cjs',[],{QA_SENT_ONLY:'1'});
 }
 fs.writeFileSync(path.join(out,'regressions.json'),JSON.stringify(results,null,2));
 const newFailures=results.filter(r=>r.tree==='candidate'&&r.code!==0&&results.find(b=>b.tree==='baseline'&&b.suite===r.suite)?.code===0);
 if(newFailures.length){console.error('NEW REGRESSIONS',newFailures);process.exitCode=1;}
})().catch(e=>{console.error(e);process.exitCode=1});
