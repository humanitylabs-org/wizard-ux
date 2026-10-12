// Run legacy shell suites on Thales with their original assertions and an outer no-write fence.
const fs=require('fs'),path=require('path'),Module=require('module');
const file=path.resolve(process.argv[2]),base=process.argv[3],web=process.argv[4];
process.env.QA_WEB_DIR=web;process.env.QA_RESOLVE='';process.env.QA_OUT=path.resolve(process.argv[5]||'../baseline-shots');fs.mkdirSync(process.env.QA_OUT,{recursive:true});
const real=require(process.env.PW);const chromium=Object.create(real.chromium);const launch=real.chromium.launch.bind(real.chromium);
chromium.launch=async(...a)=>{const b=await launch(...a),make=b.newContext.bind(b);b.newContext=async(...args)=>{const c=await make(...args);await c.route('**/*',r=>{if(!['GET','HEAD'].includes(r.request().method()))return r.fulfill({status:403,contentType:'application/json',body:'{"error":"QA refuses writes"}'});return r.continue()});return c};return b};
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));const req=m.require.bind(m);m.require=n=>n==='/home/telos/node_modules/playwright'?{...real,chromium}:req(n);
let code=fs.readFileSync(file,'utf8').replaceAll('return r.continue();','return r.fallback();').replaceAll('/home/telos/.hermes/cache/scratch',process.env.QA_OUT);process.argv=[process.argv[0],file,base];m._compile(code,file);
