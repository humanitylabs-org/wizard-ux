// Phone tab ordering: actual touch input, isolated workspace, no agent writes.
// QA_PW=<playwright> QA_WEB_DIR=<repo> node qa-tab-order.cjs
// QA_LIVE=1 uses served shell assets, with app bodies/API isolated.
const { chromium } = require(process.env.QA_PW || 'playwright');
const fs = require('fs'), path = require('path');
const root = process.env.QA_WEB_DIR || __dirname;
const origin = process.env.QA_ORIGIN || 'http://127.0.0.1:9371';
const out = process.env.QA_OUT || path.join(__dirname, 'qa-tab-order');
fs.mkdirSync(out, { recursive: true });
let passed = 0, failed = 0;
const ok = (value, name) => { console.log(value ? 'PASS' : 'FAIL', name); value ? passed++ : failed++; };
(async () => {
  const browser = await chromium.launch();
  for (const width of [393, 360]) {
    const ctx = await browser.newContext({ viewport: { width, height: 852 }, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
    let writes = 0;
    await ctx.route('**/*', r => {
      const q = r.request(), u = new URL(q.url());
      if (!['GET', 'HEAD'].includes(q.method())) { if (/\/runs$|\/sessions$|\/steer/.test(u.pathname)) writes++; return r.fulfill({ status: 403, body: '{}' }); }
      if (u.pathname.startsWith('/wizard-os-home/')) {
        if (process.env.QA_LIVE) return r.continue();
        const rel = u.pathname.slice('/wizard-os-home/'.length) || 'index.html';
        const file = path.join(root, 'web', rel);
        const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json' }[path.extname(file)] || 'text/plain';
        return r.fulfill({ status: 200, contentType: mime, body: fs.existsSync(file) ? fs.readFileSync(file) : '' });
      }
      if (q.isNavigationRequest()) return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Isolated app fixture</title><p>Shell ordering test</p>' });
      if (u.pathname === '/wizard/v1/apps') return r.fulfill({ json: { apps: [{id:'wizard-music',name:'Wizard Music',url:'/wizard-music/'},{id:'calendar',name:'Calendar',url:'/calendar/'}] } });
      if (u.pathname.endsWith('/api/sessions')) return r.fulfill({ json: { data: [], has_more: false } });
      return r.fulfill({ json: {} });
    });
    await ctx.addInitScript(() => {
      if (localStorage.getItem('qa.tabOrderSeed')) return;
      localStorage.setItem('qa.tabOrderSeed','1');
      localStorage.setItem('wux.apps.v1',JSON.stringify([{id:'wizard-music',name:'Wizard Music',url:'/wizard-music/'},{id:'calendar',name:'Calendar',url:'/calendar/'}]));
      const wins = { chat:{id:'chat',app:'chats',thread:null}, music:{id:'music',app:'frame',appId:'wizard-music',url:'/wizard-music/'}, cal:{id:'cal',app:'frame',appId:'calendar',url:'/calendar/'} };
      const strip = [{id:'home',home:true,wins:[],focus:null,full:false}, ...['chat','music','cal'].map(id => ({id:id+'-desk',wins:[id],focus:id,full:false}))];
      for (const [key,value] of Object.entries({wins4:wins,strip,idx4:2,stripSeeded:true,coached:true,rvCoached:true})) localStorage.setItem('wos.'+key,JSON.stringify(value));
    });
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => errors.push(String(e)));
    await p.goto(origin+'/wizard-os-home/'); await p.waitForFunction(() => window.__wos); await p.waitForTimeout(900);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, points=[]) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y])=>({x,y,id:0}))});
    const order = () => p.evaluate(() => __wos.desks.map(d=>d.id).join(','));
    const reset = async () => { await p.evaluate(() => { __wos.reorderDesks(['home','chat-desk','music-desk','cal-desk']); __wos.goDesk(2,true); __wos.openOverview(); document.querySelector('#overview').scrollTop=0; }); await p.waitForTimeout(450); };
    const drag = async (from,to) => {
      const a = await p.locator('.ov-grid [data-ov="'+from+'"]').boundingBox();
      const b = await p.locator('.ov-grid [data-ov="'+to+'"]').boundingBox();
      await touch('touchStart',[[a.x+a.width/2,a.y+a.height/2]]); await p.waitForTimeout(480);
      await touch('touchMove',[[b.x+b.width/2,b.y+b.height/2]]); await p.waitForTimeout(100);
      await touch('touchEnd'); await p.waitForTimeout(450);
    };
    await reset(); await drag('music-desk','chat-desk');
    ok(await order()==='home,music-desk,chat-desk,cal-desk',width+': Music can replace Chats in second position');
    await reset();
    await p.evaluate(() => { window.__qaMusicFrame = document.querySelector('.win[data-win="music"] iframe'); });
    await drag('music-desk','home');
    ok(await order()==='home,music-desk,chat-desk,cal-desk',width+': dropping Music at the left edge places it immediately after Home');
    ok(await p.evaluate(() => !!window.__qaMusicFrame && window.__qaMusicFrame === document.querySelector('.win[data-win="music"] iframe')),width+': reordering preserves the Music iframe');
    ok(await p.evaluate(()=>__wos.desks[__wos.idx].id==='music-desk'),width+': active Music tab follows its new position');
    await p.screenshot({path:path.join(out,width+'-reordered.png')});
    await p.reload(); await p.waitForFunction(()=>window.__wos); await p.waitForTimeout(600);
    ok(await order()==='home,music-desk,chat-desk,cal-desk',width+': chosen order survives reload');
    await reset(); await drag('cal-desk','home');
    ok(await order()==='home,cal-desk,chat-desk,music-desk',width+': another app can also move before Chats');
    await reset(); await drag('chat-desk','cal-desk');
    ok(await order()==='home,music-desk,cal-desk,chat-desk',width+': Chats itself can move to the right');
    ok(await p.evaluate(()=>__wos.desks[0].home),width+': Home remains first');
    await p.evaluate(()=>window.__wosNativeBack());
    ok(await p.evaluate(()=>!document.querySelector('.ov.open') && !!window.__wos),width+': Back closes overview and keeps Wizard open');
    ok(!writes,width+': zero backend writes');
    ok(!errors.length,width+': no page errors '+errors.join('; '));
    await ctx.close();
  }
  await browser.close(); console.log(JSON.stringify({passed,failed})); process.exit(failed?1:0);
})().catch(e=>{console.error(e);process.exit(2)});
