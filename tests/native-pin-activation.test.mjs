import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=process.env.HOME_SCREEN_SOURCE || new URL('../',import.meta.url).pathname;
// Execute the actual embedded JavaScript expression. This is NOT a Java/Android compile test.
const java=fs.readFileSync(root+'/android/app/src/main/java/ai/wizards/os/HomeScreenShortcuts.java','utf8');
function expression(app){
 const block=java.split('String activation = ')[1]?.split('view.evaluateJavascript(activation,')[0];
 assert.ok(block,'scoped native pin expression must exist');
 return vm.runInNewContext(block.trim().replace(/;\s*$/,'').replace(/JSONObject\.quote\(app\)/g,'JSON.stringify(app)'),{app});
}
test('embedded native pin expression requires active selected pending frontend, not arbitrary ID/shell',()=>{
 const expr=expression('wisdom');
 function run({active=true,pending=true,id='wisdom',registered=true,shell=false}={}){
  const context={navigator:{userActivation:{isActive:active}},WizHomeScreenApps:{state:{pending,appId:id}},
   WizHomeScreenPolicy:{isShell:()=>shell,within:()=>true},WizCore:{apps:()=>({APP:registered?{wisdom:{kind:'wizard',url:'/wisdom/'}}:{}})}};
  context.window=context;return vm.runInNewContext(expr,context);
 }
 assert.equal(run(),true);
 for(const options of [{active:false},{pending:false},{id:'wizard-signal'},{registered:false},{shell:true}])assert.equal(run(options),false,JSON.stringify(options));
 assert.equal(vm.runInNewContext(expression('wizard-signal'),{navigator:{userActivation:{isActive:false}}}),false);
});
