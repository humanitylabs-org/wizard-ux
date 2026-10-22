const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs');
const BASE = 'https://wizard.tailc0f369.ts.net';
const OUT = process.env.QA_OUT || __dirname + '/streaming-out';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [], sessions = [];
  try {
    for (const [agent, skin] of (process.env.QA_MAIN_ONLY ? [['','nebula']] : [['philosopher','nebula'], ['philosopher','grove'], ['', 'nebula']])) {
      const context = await browser.newContext({ viewport: { width:390, height:844 }, deviceScaleFactor:1, isMobile:true, hasTouch:true, ignoreHTTPSErrors:true });
      await context.addInitScript(skin => { localStorage.setItem('wos.coached','true'); localStorage.setItem('wos.voiceTipSeen','true'); localStorage.setItem('wos.skin',skin); }, skin);
      const page = await context.newPage(); const errors = [], network = [];
      await page.addInitScript(() => {
        window.__sseLog = [];
        const Native = window.EventSource;
        window.EventSource = function(url,options) {
          const source = new Native(url,options);
          window.__sseLog.push({kind:'create',url,at:performance.now()});
          for(const type of ['open','message','error'])source.addEventListener(type,e=>window.__sseLog.push({kind:type,url,at:performance.now(),data:e.data}));
          return source;
        };
        window.EventSource.prototype = Native.prototype;
      });
      page.on('response', async r => { if(r.url().includes('/events'))network.push({url:r.url(),status:r.status()}); });
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(BASE + '/wizard-os-home/', { waitUntil: 'load' });
      await page.waitForFunction(() => window.__wos?.live?.ok && window.WosAgents?.get('philosopher'), null, {timeout:60000});
      const sid = await page.evaluate(async ({agent,skin}) => {
        const q = agent ? '?agent='+agent : '';
        async function req(path, method, data) { const r=await fetch('/wizard/hermes'+path+q,{method,headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});if(!r.ok)throw new Error(await r.text());return r.json(); }
        const created=await req('/api/sessions','POST',{title:'Internal phone streaming '+skin+' '+Date.now(),source:'wizard-mobile'});
        const sid=created.session.id;
        await req('/api/sessions/'+sid,'PATCH',{hidden:true});
        const verified=await req('/api/sessions/'+sid,'GET');if(verified.session.hidden!==true)throw new Error('Session not hidden');
        window.__wos.live.pinAgent(sid,agent);
        await window.__wos.live.sessionInfo(sid);
        window.__wos.openWizardThread(sid,{agent});
        return sid;
      },{agent,skin});
      sessions.push({agent:agent||'main',sid}); fs.writeFileSync(OUT+'/sessions.json',JSON.stringify(sessions,null,2));
      const ta = page.locator('[data-chats] textarea:visible').last();
      await ta.waitFor({timeout:30000});
      await ta.fill('In about 180 words, explain why a question can be more useful than an answer. No tools; answer directly.');
      await page.evaluate(() => {
        window.__streamMeasure={samples:[]};
        document.addEventListener('click',function start(e){if(e.target.closest('.ch-send')){window.__streamMeasure.start=performance.now();document.removeEventListener('click',start,true);}},true);
        const observe=()=>{const m=window.__streamMeasure;if(!m.start)return;const el=[...document.querySelectorAll('[data-streaming]')].find(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&r.bottom>0&&r.top<844});const txt=el?.querySelector('.bub')?.innerText||'';if(txt&&m.samples.at(-1)?.text!==txt){m.samples.push({ms:performance.now()-m.start,text:txt});if(!m.first)m.first=performance.now()-m.start;}};
        new MutationObserver(observe).observe(document.body,{subtree:true,childList:true,characterData:true});
      });
      await page.locator('[data-chats] .ch-send:visible').last().click();
      // Phone Send returns to Chats by design. Reopen the SAME hidden thread immediately,
      // not after a fixed wait. Timing remains anchored to the actual Send click.
      await page.evaluate(({sid,agent})=>window.__wos.openWizardThread(sid,{agent}),{sid,agent});
      try { await page.waitForFunction(() => window.__streamMeasure.first, null, {timeout:45000}); }
      catch(e) {
        fs.writeFileSync(OUT+'/sse-failure.json',JSON.stringify({network,events:await page.evaluate(()=>window.__sseLog)},null,2));
        await page.screenshot({path:OUT+'/failure.png'});
        fs.writeFileSync(OUT+'/failure.json',JSON.stringify(await page.evaluate(()=>({measure:window.__streamMeasure,body:document.body.innerText,wins:window.__wos.wins,ch:Object.fromEntries(Object.keys(window.__wos.wins).map(id=>{const c=window.__wos.chatState(id);return[id,{loadedFor:c.loadedFor,turns:c.turns,stream:c.stream&&{sid:c.stream.sid,rid:c.stream.rid,text:c.stream.text,terminal:c.stream.terminal,landed:c.stream.landed},err:c.err}]})),outbox:[...window.__wos.outbox._items.values()]})),null,2));throw e;
      }
      const first = await page.evaluate(() => ({firstMs:window.__streamMeasure.first, firstText:window.__streamMeasure.samples[0].text}));
      const shot=OUT+'/philosopher-streaming-'+skin+(agent?'':'-main')+'.png';
      await page.screenshot({path:shot});
      await page.waitForFunction(() => {
        const w=Object.values(window.__wos.wins).find(w=>w.app==='chats'&&w.thread&&document.querySelector(`[data-chats="${w.id}"]`));
        const c=w&&window.__wos.chatState(w.id);
        const root=w&&document.querySelector(`[data-chats="${w.id}"]`);
        return window.__streamMeasure.first && c?.stream?.landed && !root?.querySelector('[data-streaming]') && root?.querySelector('.msg.a .bub')?.innerText;
      },null,{timeout:90000});
      const end=await page.evaluate(()=>{
        const m=window.__streamMeasure;const w=Object.values(window.__wos.wins).find(w=>w.app==='chats'&&w.thread&&document.querySelector(`[data-chats="${w.id}"]`));const root=document.querySelector(`[data-chats="${w.id}"]`);
        return {finalMs:performance.now()-m.start,samples:m.samples.length,assistantCount:root.querySelectorAll('.msg.a').length,finalText:root.querySelector('.msg.a .bub').innerText,skin:document.documentElement.dataset.skin,overflow:document.documentElement.scrollWidth>390};
      });
      if(end.assistantCount!==1)throw new Error('Duplicate assistant message '+JSON.stringify(end));
      const result={agent:agent||'main',skin,sid,...first,...end,shot,errors};results.push(result);fs.writeFileSync(OUT+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(result));
      // Nested Back returns to Chats, not out of Wizard.
      await page.locator('[data-chback]:visible').last().click();
      if(!page.url().startsWith(BASE+'/wizard-os-home/'))throw new Error('Back left Wizard');
      await context.close();
    }
  } catch(e) { console.error(e); fs.writeFileSync(OUT+'/error.txt',String(e)); process.exitCode=1; }
  finally { await browser.close(); }
})();
