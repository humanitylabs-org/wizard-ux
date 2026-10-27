import test from 'node:test'; import assert from 'node:assert/strict'; import vm from 'node:vm'; import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const context=vm.createContext({window:{WosChat:{esc:s=>String(s??'')}},fetch:()=>{},Set,Map,console});
vm.runInContext(read('web/core/chat-models.js'),context);
const M=context.window.WosModels;
test('a diagnosed sign-in failure shows Sign in, not Retry',()=>{
  for(const [provider,name] of [['claude','Claude'],['chatgpt','ChatGPT']]) {
    const html=M.failureHtml({s:{id:'held',status:'failed',model:provider==='claude'?'claude-opus-4-8':'gpt-6.1-sol',provider,reconnect:{name,provider,appId:'wizard-'+provider,runId:'saved-run'}},canRetry:true});
    assert.match(html,new RegExp(`${name} sign-in expired`));assert.match(html,new RegExp(`Sign in to ${name}`));assert.equal((html.match(/<button/g)||[]).length,1);assert.doesNotMatch(html,/Retry|Choose another model|Fix it/);assert.equal((html.match(/This message is saved/g)||[]).length,1);assert.match(html,/data-recovery-run="saved-run"/);
  }
});
test('an undiagnosed failure keeps the existing Retry, model choice and Dismiss',()=>{
 const html=M.failureHtml({s:{id:'plain',status:'failed',model:'other'},canRetry:true});assert.match(html,/Needs retry/);for(const control of ['data-chretry','data-chretrymodel','data-chdismiss'])assert.ok(html.includes(control));
});
test('diagnosed list rows name the sign-in problem and open the same in-shell fix path',()=>{
 assert.match(read('web/core/chats.js'),/s.reconnect && needs \? esc\(s.reconnect.name\) \+ ' sign-in expired'/);const power=read('web/core/chat-power.js');assert.match(power,/Sign in<\/button>/);assert.match(power,/H.openLink\?\.\(`\/troubleshoot\/\?provider=/);assert.match(power,/if \(rc\) return/);
});
