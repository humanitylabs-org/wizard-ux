// Explicit synthetic authority for older suites whose generic '{}' fallback predates model-route sealing.
// Preload AFTER qa-thales-loader.cjs. Never run against real APIs without QA_BLOCK_WRITES=1.
if(process.env.QA_BLOCK_WRITES!=='1')throw Error('Fixture preload requires write fence');
const {chromium}=require(process.env.PW),launch=chromium.launch.bind(chromium);
const fixture={provider:'openai-codex',model:'gpt-6-sol',providers:[{slug:'openai-codex',name:'Synthetic QA provider',authenticated:true,is_current:true,models:[{value:'gpt-6-sol',name:'Synthetic QA model'}]}]};
chromium.launch=async(...args)=>{const b=await launch(...args),create=b.newContext.bind(b);b.newContext=async(...a)=>{const c=await create(...a),route=c.route.bind(c);c.route=(pattern,handler,...rest)=>route(pattern,(r,q)=>new URL(r.request().url()).pathname==='/wizard/hermes/api/model/options'?r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}):handler(r,q),...rest);return c;};return b;};
