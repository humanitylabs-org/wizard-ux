import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Run the whole serving client, including normalize, refresh, PEND and sessionInfo.
// Only expose existing closures; no copied lifecycle implementation in the fixture.
export function helperWorkingHarness({ source, row, detail, agent = '' }) {
  let now = Date.now(), current = structuredClone(row), detailValue = structuredClone(detail), detailWait = null, more = false;
  const storage = new Map(), calls = [], timers = [];
  const context = {
    console, AbortSignal, URL, URLSearchParams,
    Date: class extends Date { static now() { return now; } },
    document: { documentElement: { dataset: {} }, readyState: 'loading', hidden: false, addEventListener() {} },
    navigator: {}, crypto: { randomUUID: () => 'test-send' },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    setInterval() {}, setTimeout(fn, ms) { timers.push({fn,ms}); }, addEventListener() {},
    WizConfig: { dayStart: n => n - n % 864e5 },
    WosAgents: { isOther: id => !!id && id !== 'hermes', others: () => [], get: id => ({id, privacy:'standard'}) },
    async fetch(url, init = {}) {
      calls.push({url, method: init.method || 'GET'});
      const u = new URL(url, 'https://test.invalid');
      let value = {};
      if (u.pathname === '/wizard/hermes/api/sessions') value = {data:[structuredClone(current)],list_version:1,window:'archive-50',has_more:more};
      else if (u.pathname === `/wizard/hermes/api/sessions/${row.id}`) { const captured=structuredClone(detailValue); if(detailWait) await detailWait; value=captured; }
      else if (u.pathname === '/wizard/thread-seen') value = {state:{initializedAt:now,threads:{}}};
      return {ok:true,json:async()=>value};
    }
  };
  context.window=context;
  vm.runInNewContext(source.replace('window.__wizLiveInternals = {', 'window.__wizLiveInternals = { syncPending, applyLocal,'), context);
  const L=context.WizLive, api=context.__wizLiveInternals;
  if(agent) L.pinAgent(row.id,agent);
  const rows=()=>agent ? L.agentSessions[agent] : L.sessions;
  const put=value=>{ if(agent) L.agentSessions[agent]=[value]; else L.sessions=[value]; };
  const poll=async()=>{ if(!agent) await L.refresh(); else {put(api.normalize(structuredClone(current)));api.applyLocal(rows()[0]);} };
  const outbox={_items:new Map()};
  return {L,api,context,calls,timers,outbox,rows,poll,put,
    sync:()=>api.syncPending(outbox), advance:ms=>{now+=ms;},
    setRow:(value, hasMore=false)=>{current=structuredClone(value);more=hasMore;}, setDetail:value=>{detailValue=structuredClone(value);},
    deferDetail:()=>{let release;detailWait=new Promise(r=>{release=r;});return()=>{detailWait=null;release();};},
    send:()=>{const item={id:'test-send',kind:'reply',sessionId:row.id,text:'Test only',createdAt:now,state:'sent',sentAt:now,runId:'test-run',agent};outbox._items.set(item.id,item);api.syncPending(outbox);return item;},
  };
}
export const liveSource = () => readFileSync(process.env.WIZARD_LIVE_SOURCE || new URL('../../web/live.js',import.meta.url),'utf8');
