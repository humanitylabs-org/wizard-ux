// Lightweight pure projection tests; browser acceptance runs on Thales.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const window={WizCore:{},WizSigil:{of:a=>({color:a.color||'#abc'}),html:a=>`<i class="sgi sg-${a.id}"></i>`}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'web/core/workspace-navigation.js'),'utf8'),{window});
const n=window.WizCore.workspaceNav;let count=0;
const check=(v,message)=>{assert.ok(v,message);count++};
for(let size=0;size<13;size++)for(let digit=1;digit<=9;digit++){
 const x=n.digitTarget(digit,size),index=digit-2;
 check(digit===1?x.kind==='home':index<size?x.kind==='desktop'&&x.index===index:index===size?x.kind==='new'&&x.index===index:x===null,`slot ${digit}, ${size} desktops`);
}
for(const digit of [0,10,-1,1.5,NaN,'1',null])check(n.digitTarget(digit,3)===null,'invalid key is inert');
check(n.slot(0)===2&&n.slot(7)===9&&n.slot(0,true)===1,'Home-first slot numbers');
const wins={one:{id:'one',app:{id:'music'}},two:{id:'two',app:{id:'private',sgc:'#00aa00',sgh:'<i class="sgi sg-hat-private"></i>'}}};
const app=w=>w.app;
check(n.icon({home:true},wins,app).includes('sg-home'),'Home uses house');
check(n.icon({wins:[]},wins,app).includes('dsg empty'),'empty desk uses ring');
check(n.icon({wins:['one'],focus:'missing'},wins,app).includes('sg-music'),'missing focus falls back to first window');
const multi=n.icon({wins:['one','two'],focus:'two'},wins,app);
check(multi.includes('sg-hat-private')&&multi.includes('--c:#00aa00')&&multi.includes('class="dn">2'),'private focused app colour, glyph and count preserved');
check(!n.icon({wins:['one'],focus:'one'},wins,app).includes('class="dn"'),'single window has no numeric desktop label');
for(const f of ['index.html','desktop.html'])check(fs.readFileSync(path.join(__dirname,'web',f),'utf8').includes('core/workspace-navigation.js'),'both shells load shared projection');
check(fs.readFileSync(path.join(__dirname,'web/app.js'),'utf8').includes('window.WizCore.workspaceNav.icon(desks[i], W, winApp)'),'phone delegates workspace icon rendering');
check(fs.readFileSync(path.join(__dirname,'web/desktop/desktop.js'),'utf8').includes('C.workspaceNav.icon(d, W, appOf)'),'desktop delegates workspace icon rendering');
console.log(`${count} passed, 0 failed`);
