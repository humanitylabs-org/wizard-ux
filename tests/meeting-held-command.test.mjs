import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const a=s.indexOf('  function mayHoldCommand()'),b=s.indexOf('  function shock()',a);
assert(a>=0&&b>a);
function allowed({focused=false,meeting=false,recording=false,sheet=null}={}){
 const c={sheet,FIELDS:{refresh:()=>focused},window:{WizAppCapture:{getState:()=>({recording,meetingId:meeting?'same-meeting':null})}}};
 vm.runInNewContext(s.slice(a,b)+';this.result=mayHoldCommand()',c);return c.result;
}
test('held command remains available with focused meeting notes',()=>assert.equal(allowed({focused:true,meeting:true,recording:true}),true));
test('focused ordinary dictation and unrelated capture keep original hold policy',()=>{
 assert.equal(allowed({focused:true}),false);assert.equal(allowed({focused:true,recording:true}),false);
});
test('stale completed meeting cannot override field hold policy',()=>assert.equal(allowed({focused:true,meeting:true}),false));
test('open sheets keep navigation priority; ordinary unfocused hold remains',()=>{
 assert.equal(allowed({focused:true,meeting:true,recording:true,sheet:'settings'}),false);assert.equal(allowed(),true);
});
