// Frozen baseline: origin/main dafb1ad7, before slices 5+6. Do not regenerate from
// the candidate: that would make a deleted grammar pass its own comparison.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const baseline = p => read('tests/fixtures/voice-baseline/'+p+'.txt');
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9ก-๙ ]+/g,' ').replace(/\s+/g,' ').trim();
const catalog = [
  ['wizard-music','Wizard Music'], ['wizard-search','Search'], ['wisdom','Wisdom'],
  ['cinequeue','Movies'], ['iching','I Ching'], ['wizard-signal','Wizard Signal'],
  ['shopping','Shopping'], ['mizel','Recorder'], ['console','Console'],
  ['calendar','Calendar'], ['airlock','Airlock'],
].map(([id,name])=>({id,name,url:'/'+id+'/'}));
// Food is now an installed provider; its pinned test dependency is not shell UI.
catalog.push({id:'usuals',name:'Food',url:'/usuals/',voice_names:['Food','Usuals','usual','food app','my food','saved orders','eats','bites']});
async function fixture(old) {
  const listeners = {}, actions = [], patterns = new Set();
  const c = {console,URL,Map,Set,Date,Math,performance:{now:()=>0},setTimeout:()=>1,clearTimeout(){},setInterval(){},
    location:new URL('https://wizard.example/wizard-os-home/'),CustomEvent:class{},
    localStorage:{getItem:()=>null,setItem(){}},document:{addEventListener(){},querySelector:()=>null},
    fetch:async()=>({ok:true,json:async()=>({apps:catalog})}),
    addEventListener:(n,f)=>{(listeners[n] ||= []).push(f);},dispatchEvent(){},
    WizCore:{norm},WizConfig:{stripAddress:s=>String(s).replace(/^(?:hey |ok |okay )?(?:wizard|archimedes)\s*/i,''),endpoint:()=>'/apps'},
    WizardOSNative:{usuals:()=>'{"list":[]}',usualsRun:id=>{actions.push(['usual',id]);return '';},usualsMatch:t=>/^(order|order my usual) kra pao$/i.test(t)?'kra-pao':''},
    WosFeatures:{entries:[]},
  }; c.window=c;vm.createContext(c);
  // Capture dynamic RegExp tables as well as the regex literals extracted below.
  c.record = source => patterns.add(source);
  vm.runInContext(`const OriginalRegExp=RegExp; RegExp=class extends OriginalRegExp {constructor(s,f){super(s,f);record(this.source);}};`,c);
  if (!old) {
    // Apps now consumes the real shared launcher policy for native links (e.g. Settings).
    for (const file of ['launcher-defaults.js','launcher.js','voice-legacy.js','app-voice.js']) vm.runInContext(read('web/core/'+file),c);
  }
  else vm.runInContext(baseline('music-voice.js'),c);
  let handler = null, receipt = null;
  if (!old) {
    c.WizardApp={ready(){},back:{register(){}},
      device:{legacy:{available:method=>method==='usuals',call:(method,args)=>c.WizardOSNative[method](...args)}},
      voice:{stripAddress:c.WizConfig.stripAddress,commands:{register:h=>handler=h}},
      shell:{toast(){},focusApp:()=>{receipt={action:'open_app',app:'Food'};return true;}}};
    c.WizAppServices={voiceCommand(text,meta) {
      if(!handler?.claims(text,meta))return null;
      return {action:'app_voice',appId:'usuals',token:{text,meta}};
    }};
  }
  vm.runInContext(old?baseline('usuals.js'):read('tests/fixtures/food-app/usuals.js'),c);
  if (!old) vm.runInContext(read('tests/fixtures/food-app/app.js'),c);
  const canonical = command => {
    if(command?.action!=='app_voice')return command;
    receipt=null;const before=actions.length;handler.receive(command.token.text,command.token.meta);
    if(!receipt && actions.length>before)receipt={action:'usual',id:actions.at(-1)[1]};
    return receipt;
  };
  vm.runInContext(old?baseline('apps.js'):read('web/core/apps.js'),c);
  await c.WizCore.appsLoaded();
  const registry=c.WizCore.apps('mobile');
  c.WosMusic.install({app:()=>registry.APP['wizard-music'],findWin:()=> 'player',frameOf:()=>({contentWindow:{postMessage:m=>actions.push(['music',m.cmd])}}),toast(){}});
  vm.runInContext(old?baseline('commands.js'):read('web/core/commands.js'),c);
  const CHATS={matchFilters:s=>s==='ready'?[{kind:'status',value:'ready'}]:s==='private'?[{kind:'agent',value:'private'}]:[]};
  const parser=c.WosCommands.create({...registry,CHATS,sendSnap:()=>({view:{kind:'home'}})});
  return {c,parser,patterns,registry,actions,canonical};
}
// Enumerate every finite alternative in the actual baseline regex tables. Infinite
// query/name captures use Custody; arbitrary whitespace uses one space. This is a
// grammar-branch proof, not a claim to enumerate infinitely many possible titles.
function expand(source) {
  let i=0;
  const product=(a,b)=>a.flatMap(x=>b.map(y=>x+y));
  function choice(end) {
    let branches=[],seq=[''];
    while(i<source.length && source[i]!==end) {
      if(source[i]==='|'){branches.push(...seq);seq=[''];i++;continue;}
      let atom,variable=false,ch=source[i++];
      if(ch==='^'||ch==='$')atom=[''];
      else if(ch==='\\') {const n=source[i++];atom=n==='b'?['']:n==='s'?[' ']:n==='d'?Array.from({length:10},(_,j)=>String(j)):[n];}
      else if(ch==='(') {
        let assertion=false;
        if(source[i]==='?'){const tag=source.slice(i,i+2);assert(['?:','?!','?='].includes(tag),source);assertion=tag!=='?:';i+=2;}
        atom=choice(')');assert.equal(source[i++],')',source);if(assertion)atom=[''];
      } else if(ch==='[') {
        let body='';while(i<source.length && source[i]!==']')body+=source[i++];assert.equal(source[i++],']',source);
        if(body.startsWith('^'))atom=['Custody'];
        else {atom=[];for(let n=0;n<body.length;n++){if(body[n+1]==='-'){for(let k=body.charCodeAt(n);k<=body.charCodeAt(n+2);k++)atom.push(String.fromCharCode(k));n+=2;}else atom.push(body[n]);}}
      } else if(ch==='.') {atom=['Custody'];variable=true;}
      else atom=[ch];
      if(source[i]==='?'){atom=['',...atom];i++;}
      else if(source[i]==='*'||source[i]==='+'){const quant=source[i++];if(quant==='*')atom=['',...atom];if(source[i]==='?')i++;}
      else if(source[i]==='{') {
        const m=source.slice(i).match(/^\{(\d+)(?:,(\d+))?\}/);assert(m,source);i+=m[0].length;
        const repeated=[];for(let n=+m[1];n<=+(m[2]||m[1]);n++){let x=[''];for(let j=0;j<n;j++)x=product(x,atom);repeated.push(...x);}atom=repeated;
      }
      seq=product(seq,atom);assert(seq.length<500000,'Unbounded finite table: '+source);
    }
    return [...branches,...seq];
  }
  return [...new Set(choice(undefined))].filter(s=>new RegExp(source).test(s));
}
function literalPatterns(source) {
  const patterns=[];
  for(let start=source.indexOf('/^');start>=0;start=source.indexOf('/^',start+2)) {
    let end=start+2;
    while(end<source.length && source[end]!=='\n' && source[end]!=='/') {
      end += source[end]==='\\' ? 2 : 1;
    }
    if(source[end]==='/')patterns.push(source.slice(start+1,end));
  }
  return patterns;
}
test('every pre-refactor voice table alternative routes to the identical action',async t=>{
  const old=await fixture(true),current=await fixture(false);
  const seeds=['pause','resume','next song','previous song','turn it up','turn it down','mute','unmute','set volume 50','I like this','I hate this',"what's playing",'play Custody','music search Custody','open music and play Custody','order food','food','order kra pao','order my usual kra pao'];
  for(const text of seeds)old.parser.parse(text,{view:{kind:'home'}},'command');
  const sources=['commands.js','music-voice.js','usuals.js','apps.js'].flatMap(p=>literalPatterns(baseline(p)));
  const patterns=[...new Set([...sources,...old.patterns])].filter(s=>s.startsWith('^'));
  const phrases=new Set(seeds);
  for(const pattern of patterns)for(const phrase of expand(pattern))phrases.add(phrase);
  // Every baseline literal open alias, plus every installed app's name and all
  // navigation/open prefixes; dynamic queries get both one and multiword samples.
  const aliases=baseline('apps.js').match(/const alias = (\{[^\n]+\});/)[1];
  const names=[...Object.keys(vm.runInNewContext('('+aliases+')')),...catalog.map(a=>a.name),...old.registry.APPS.map(a=>a.name)];
  for(const name of names)for(const prefix of ['','open ','launch ','show ','start ','go to ','switch to ','open me ','my ','the '])phrases.add(prefix+name);
  for(const text of [...phrases]) if(text.includes('Custody')) {phrases.add(text.replaceAll('Custody','Home Tides'));phrases.add(text.replaceAll('Custody','Gui Boratto Trap'));}
  let comparisons=0,recognized=0;
  const contexts=[{kind:'home'},{kind:'thread list'},{kind:'chat thread'},{kind:'app',appId:'wizard-music'},{kind:'app',appId:'calendar'}];
  for(const text of phrases)for(const view of contexts)for(const [kind,typed] of [['command',false],['auto',true],['auto',false]]) {
    const a=old.parser.parse(text,{view},kind,typed),b=current.canonical(current.parser.parse(text,{view},kind,typed));
    assert.equal(JSON.stringify(b),JSON.stringify(a),JSON.stringify({text,view,kind,typed,a,b}));
    comparisons++;if(a)recognized++;
  }
  t.diagnostic(JSON.stringify({patterns:patterns.length,utterances:phrases.size,contexts:contexts.length,modes:3,comparisons,recognized}));
});
test('registry voice_names: first installed wins, duplicate is refused with one warning',async()=>{
  const f=await fixture(false),warnings=[];f.c.console={warn:(...x)=>warnings.push(x)};
  const first={id:'first',voice_names:['Same name']},second={id:'second',voice_names:['same name']};
  for(let i=0;i<2;i++)assert.equal(f.c.WosAppVoice.aliases([first,second],norm).get('same name'),first);
  assert.equal(warnings.length,1);assert.match(warnings[0].join(' '),/second.*first/);
  f.registry.APP.calendar.voice_names=['my planner'];
  assert.equal(f.registry.appByName('my planner').id,'calendar');
  assert.equal(f.registry.findApp('my planner').id,'calendar');
});
