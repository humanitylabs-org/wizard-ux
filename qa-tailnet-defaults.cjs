// Preview QA must select its isolated origin explicitly, never a retired DNS default.
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass=0,fail=0;
function ok(v,n) { console.log((v?'PASS ':'FAIL ')+n); v?pass++:fail++; }
const previews = [
  ['qa-bound-staged.cjs', 'ORIGIN'],
  ['qa-helper-viewport.cjs', 'ORIGIN'],
  ['qa-helper-status.cjs', 'ORIGIN'],
  ['qa-home-screen-apps.cjs', 'origin'],
  ['qa-store-system.cjs', 'BASE'],
  ['tools/shots-store-system.cjs', 'B'],
  ['tools/qa_home_screen_companion.cjs', 'origin'],
];
for (const [name, variable] of previews) {
  const text=fs.readFileSync(path.join(__dirname,name),'utf8');
  // Exercise just the origin admission/declaration, without browser or device side effects.
  const guard=text.split('\n').find(l=>l.startsWith('if (!process.') && l.includes('QA_ORIGIN'));
  const declaration=text.split('\n').find(l=>new RegExp('^const '+variable+'\\s*=').test(l));
  const expression=declaration?.match(new RegExp('^const '+variable+'\\s*=([^;,]+)'))?.[1];
  ok(!!guard && !!expression, name+': explicit preview-origin admission');
  if (!guard || !expression) continue;
  const source=guard+'\n'+expression;
  let missing=false;
  try { vm.runInNewContext(source,{process:{env:{},argv:[]},URL}); }
  catch(e) { missing=e.message.includes('QA_ORIGIN'); }
  ok(missing,name+': missing origin fails clearly');
  const selected='https://preview.example:9451';
  const result=vm.runInNewContext(source,{process:{env:{QA_ORIGIN:selected},argv:[]},URL});
  ok(new URL(result).origin===selected,name+': selected preview port is preserved');
}
for (const [name, variable] of [
  ['tools/qa_home_screen_apps.py','QA_ORIGIN'],
  ['qa-native-new-chat-keys.py','QA_ORIGIN'],
  ['tools/qa_background_audio.py','WOS_QA_DISCOVERY_ORIGIN'],
]) {
  const text=fs.readFileSync(path.join(__dirname,name),'utf8');
  ok(text.includes(variable+' is required'),name+': missing origin has an explicit error');
}
const parity=fs.readFileSync(path.join(__dirname,'tools/qa_native_parity.py'),'utf8');
ok(parity.includes('ping -c 1 -W 2 wizard.tailc0f369.ts.net'),'native parity reachability probe uses tailnet host');
console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
