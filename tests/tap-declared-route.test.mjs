import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert';
const win={WizCore:{norm:s=>String(s).toLowerCase().replace(/[^a-z0-9 ]/g,'').trim()},WizConfig:{stripAddress:t=>t}};
const ctx={window:win,location:{origin:'https://w.ts.net'},URL,console}; ctx.globalThis=ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../web/core/commands.js', import.meta.url),'utf8'),ctx);
const APP={m:{id:'wizard-music',url:'/wizard-music/',voice_routes:[{words:['music','shazam'],open:'?view=identify&listen=1',rest_param:'q'}]}};
const c=win.WosCommands.create({CHATS:{},APP,appByName:()=>null,findApp:()=>null,quickSearch:()=>null,sendSnap:()=>({view:{kind:'thread list'}})});
assert.deepEqual(c.declaredRoute('Music.'),{action:'open_app_route',app:'wizard-music',url:'/wizard-music/?view=identify&listen=1'});
assert.equal(c.declaredRoute('Shazam').url,'/wizard-music/?view=identify&listen=1');
assert.match(c.declaredRoute('music play jazz').url,/q=play\+jazz/);
assert.equal(c.declaredRoute('play some music'),null);
assert.equal(c.parse('Music','', 'auto'),null); // tap takes never go through parse
assert.equal(c.parse('music',{view:{kind:'thread list'}},'command').action,'open_app_route');
console.log('declared-route checks: 6/6 pass');
