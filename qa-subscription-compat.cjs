// Real loopback HTTP + shipped shared Home modules. Synthetic data only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'web/core');
const providers=['CODEX','CODEX-2','CODEX-3','claude'].map((id,i)=>({id,name:id,status:'ok',fetchedAt:new Date().toISOString(),limits:[{id:'week',label:'Weekly',usedPercent:[11,42,73,5][i]}]}));
const server=http.createServer((req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url==='/wizard/ai-usage')return res.end(JSON.stringify({providers}));
 if(req.url==='/api/system/load')return res.end(JSON.stringify({cpuLoad:1,percentUsedMemory:2,percentUsed:3}));
 if(req.url==='/api/system/devices')return res.end('{"devices":[]}');
 if(req.url==='/') {res.setHeader('Content-Type','text/html');return res.end('<html><body><main></main><script>window.__wos={idx:0,desks:[{wins:[]}]};</script><script src="/usage.js"></script><script src="/resources.js"></script><script>document.querySelector("main").innerHTML=WosResources.home();</script></body></html>');}
 const name=req.url.slice(1);if(!['usage.js','resources.js'].includes(name)){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,name)));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
 try {for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('[data-provider-count="chatgpt"] [data-res-account="CODEX-3"]').waitFor();
  assert.equal(await page.locator('.rs-provider').count(),2);
  assert.equal(await page.locator('[data-provider-count="chatgpt"] .rs-account').count(),3);
  assert.equal(await page.locator('[data-provider-count="chatgpt"] .rs-provider-h').innerText(),'ChatGPT 3');
  assert.deepEqual(await page.locator('[data-provider-count="chatgpt"] [role="meter"]').evaluateAll(xs=>xs.map(x=>x.getAttribute('aria-valuenow'))),['11','42','73']);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS Home shared modules at 390+1440: one ChatGPT column, three separate CODEX subscriptions and 11/42/73% meters; Claude separate; no JS errors');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
