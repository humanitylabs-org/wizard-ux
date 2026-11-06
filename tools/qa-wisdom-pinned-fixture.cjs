"use strict";
// Prepare synthetic content against pinned real app + shell Git trees; no service or owner data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
if(process.env.QA_ORIGIN&&process.env.QA_ORIGIN!=='https://wizard.test')throw Error('Owner/network origins refused');
const ROOT=process.env.QA_WISDOM_DIR,OUT=process.env.QA_OUT,SHELL=path.resolve(__dirname,'..');
if(!ROOT||!OUT)throw Error('Pinned QA_WISDOM_DIR and QA_OUT required');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=(r,...a)=>cp.execFileSync('git',['-C',r,...a],{encoding:'utf8'}).trim();
const files=r=>git(r,'ls-files').split('\n').filter(Boolean);
const appFiles=files(ROOT).filter(f=>f.startsWith('static/'));
const shellFiles=files(SHELL).filter(f=>f.startsWith('web/'));
const body=('# Synthetic reading\n\nThis attention belongs to a wholly synthetic chapter. Nothing here is owner history. A quiet attention can follow a thought without sending any message.\n\n').repeat(30);
const entry={id:'synthetic-chapter',thinker:'synthetic-thinker',title:'Synthetic attention',body,body_sha256:hash(body),kind:'chapter',part:1};
const fixture={entries:[entry],thinkers:[{id:'synthetic-thinker',name:'Synthetic Thinker',description:'Synthetic only'}],collections:[],highlights:[],glosses:[],orders:[],notices:[],requests:[],picks:[],day:'2026-11-04',timezone:'UTC'};
const manifest={revision:git(ROOT,'rev-parse','HEAD'),shell_revision:git(SHELL,'rev-parse','HEAD'),files:Object.fromEntries(appFiles.map(f=>[f,hash(fs.readFileSync(path.join(ROOT,f)))])),shell_files:Object.fromEntries(shellFiles.map(f=>[f,hash(fs.readFileSync(path.join(SHELL,f)))]))};
fs.mkdirSync(OUT,{recursive:true});
for(const[name,value]of Object.entries({'fixture.json':fixture,'source-manifest.json':manifest,'shell-allowlist.json':shellFiles.map(f=>'/wizard-os-home/'+f.slice(4))}))fs.writeFileSync(path.join(OUT,name),JSON.stringify(value));
const env={...process.env,QA_ORIGIN:'https://wizard.test',QA_SOURCE:ROOT,QA_SHELL:SHELL,QA_FIXTURE:path.join(OUT,'fixture.json'),QA_SOURCE_MANIFEST:path.join(OUT,'source-manifest.json'),QA_SHELL_ALLOWLIST:path.join(OUT,'shell-allowlist.json')};
const child=cp.spawnSync(process.execPath,[path.join(SHELL,'qa-wisdom-pinned-thread.cjs')],{env,stdio:'inherit'});process.exitCode=child.status??1;
