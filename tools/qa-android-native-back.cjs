// Native WebView branch of qa-android-back. Never a browser install or a real box.
const {chromium}=require('./qa-playwright.cjs'),{execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
module.exports=async()=>{
 const adb=(...args)=>execFileSync(process.env.QA_ADB||'adb',args,{encoding:'utf8',timeout:15000});
 const app=process.env.QA_NATIVE_APP;if(!/^ai\.wizards\.os(?:\.qa)?$/.test(app))throw Error('Explicit Wizard native QA package required');
 const b=await chromium.connectOverCDP(process.env.QA_CDP_URL||'http://127.0.0.1:9333');
 try{
  const p=b.contexts()[0].pages().find(p=>p.url().includes('/wizard-os-home/')&&!p.url().includes('app-session='));if(!p)throw Error('Wizard native WebView missing');
  if(!/^http:\/\/localhost:[0-9]+\//.test(p.url()))throw Error('Disposable loopback fixture required');
  const out=process.env.QA_OUT||path.resolve('qa-live/android');fs.mkdirSync(out,{recursive:true});
  const assert=(c,n)=>{if(!c)throw Error('FAIL '+n);console.log('PASS '+n)};
  const active=()=>adb('shell','dumpsys','activity','activities').includes(app+'/.MainActivity');
  await p.waitForFunction(()=>window.__wos?.live?.ok);
  await p.evaluate(()=>__wos.openWizardThread(WizLive.sessions[0].id));
  await p.locator('[data-part="thread"]').first().waitFor();
  adb('shell','input','keyevent','4');
  await p.waitForFunction(()=>!Object.values(__wos.wins).some(w=>w.app==='chats'&&w.thread));
  assert(active(),'qa-android-back: native thread → Back → list, Wizard stays open');
  fs.writeFileSync(path.join(out,'android-back-list.png'),execFileSync(process.env.QA_ADB||'adb',['exec-out','screencap','-p']));
  for(let n=0;n<4;n++){adb('shell','input','keyevent','4');await p.waitForTimeout(450);assert(active(),'qa-android-back: root Back '+(n+1)+' never exits native Wizard');}
  assert(p.url().includes('/wizard-os-home/'),'qa-android-back: native URL remains Wizard');
 }finally{await b.close();}
};
