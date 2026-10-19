// Keep outbound QA defaults on the stock tailnet origin; the retired name appears only in negative checks.
const fs = require('fs'), path = require('path');
let pass=0,fail=0;
function ok(v,n) { console.log((v?'PASS ':'FAIL ')+n); v?pass++:fail++; }
const old='private.wizard001.com';
for (const name of fs.readdirSync(__dirname).filter(x=>/^qa.*\.cjs$/.test(x))) {
  if (name==='qa-relative-links.cjs' || name==='qa-tailnet-defaults.cjs') continue;
  const text=fs.readFileSync(path.join(__dirname,name),'utf8');
  const active=text.split('\n').filter(l=>!/^\s*\/\//.test(l));
  ok(!active.some(l=>l.includes('https://'+old) || l.includes(old.replaceAll('.', String.raw`\.`))),name+': no old-host outbound URL or host filter');
}
for (const name of ['qa_android_apps.py','qa_image_save_device.py','qa_silent_update.py']) {
  const text=fs.readFileSync(path.join(__dirname,'tools',name),'utf8');
  ok(!text.includes('https://'+old),name+': no old-host outbound URL');
}
const parity=fs.readFileSync(path.join(__dirname,'tools/qa_native_parity.py'),'utf8');
ok(parity.includes('ping -c 1 -W 2 wizard.tailc0f369.ts.net'),'native parity reachability probe uses new host');
console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
