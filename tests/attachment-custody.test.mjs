import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL('../web/' + path, import.meta.url), 'utf8')
const slice = (file, first, last) => { const s=source(file), start=s.indexOf(first), end=s.indexOf(last,start); assert(start>=0 && end>start, `production function bounds: ${first}`); return s.slice(start,end) }

test('actual enqueue cannot let model routing overwrite selected agent even with missing agent registry', async () => {
  const context={ window:{ WosModels:{ snapshot:()=>({model:'m',provider:'p',agent:'hermes'}),resolveRoute:async x=>x }, WizLive:{agentOf:()=>''} },
    load:async()=>{},items:new Map(),make:o=>({...o,state:'preparing'}),put:async()=>{},bounded:async fn=>fn(),pump(){},api:{} }
  vm.runInNewContext('var enqueue = ({'+slice('outbox.js','    async enqueue(o) {','    retry(id)')+'}).enqueue;',context)
  const item=await context.enqueue({kind:'new',agent:'private-agent',text:'private message'})
  assert.equal(item.agent,'private-agent');assert.equal(item.state,'failed');assert.match(item.error,/Selected route changed/)
})

test('real resumable client binds every create/status/PATCH/complete to captured agent', async () => {
  const calls=[]; let offset=0
  const context={ window:{ WizLive:{bootstrap:{capabilities:{resumable_uploads:{available:true,api_base:'/wizard/v1/uploads',chunk_bytes:3}}}}}, navigator:{onLine:true}, crypto:globalThis.crypto, AbortController, setTimeout, clearTimeout, addEventListener(){}, removeEventListener(){}, DOMException,
    fetch:async (url,opts={}) => { calls.push({url,opts}); let body={}; const headers={}
      if (url==='/wizard/v1/uploads') body={upload_id:'upl_fixture',agent:'private-agent',offset:0,chunk_bytes:3}
      else if (url.includes('/complete')) body={file:{id:'af_fixture',filename:'private.txt',mime:'text/plain',bytes:6}}
      else if(opts.method==='PATCH') { offset+=opts.body.size; headers['Upload-Offset']=String(offset) }
      else body={offset,agent:'private-agent'}
      return {ok:true,status:opts.method==='PATCH'?204:200,json:async()=>body,headers:{get:k=>headers[k]}}
    } }
  context.XMLHttpRequest = class {
    upload = {}; headers = {}; responseText = ''; status = 204;
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader(name, value) { this.headers[name] = value }
    getResponseHeader() { return String(offset) }
    send(body) { calls.push({url:this.url,opts:{method:this.method,body}});offset=Number(this.headers['Upload-Offset'])+body.size;this.onload() }
    abort() { this.onabort?.() }
  }
  vm.runInNewContext(source('core/uploads.js'),context)
  const file=new Blob(['s'.repeat(300000)],{type:'text/plain'}); file.name='private.txt'
  const result=await context.window.WizUploads.upload(file,{agent:'private-agent'})
  assert.equal(result.agent,'private-agent')
  assert.equal(JSON.parse(calls[0].opts.body).agent,'private-agent')
  assert(calls.slice(1).every(c=>c.url.endsWith('?agent=private-agent')))
  assert.equal(calls.filter(c=>c.opts.method==='PATCH').length,2)
})

test('private bytes never fall back to an older backend that cannot attest custody', async () => {
  let bytes = 0
  const context = {window:{},crypto:globalThis.crypto,setTimeout,clearTimeout,
    fetch:async()=>({status:201,json:async()=>({upload_id:'legacy-main-upload',offset:0})}),
    XMLHttpRequest:class {constructor(){bytes++;throw new Error('must not send bytes')}}}
  vm.runInNewContext(source('core/uploads.js'),context)
  await assert.rejects(context.window.WizUploads.upload(new Blob(['private']),{agent:'private-agent'}),/cannot confirm private attachment custody/)
  assert.equal(bytes,0)
  let fallback = false
  context.window.WizUploads={supported:()=>false,upload:async()=>{throw Object.assign(new Error('old backend'),{status:404})}}
  context.uploadFileOnce=()=>{fallback=true}
  vm.runInNewContext(slice('core/chats.js','  async function uploadFile(', '  async function uploadFileOnce('),context)
  await assert.rejects(context.uploadFile(new Blob(['private']),{agent:'private-agent'}),/old backend/)
  assert.equal(fallback,false)
})

test('actual paperclip addFiles captures agent before asynchronous upload and draft restoration', async () => {
  const state={files:[]}, W={w:{id:'w',thread:'__new__',agent:'private-agent'}}
  let resume, seen
  const context={ ch:()=>state,W,LIVE:{agentOf:()=>''},winAgent:w=>w.agent,MAX_FILES:8,toast(){},refreshCompose(){},paintUpload(){},saveDraft(){},UPLOAD_ABORT:new Map(),PREVIEW:{},URL,AbortController,performance,
    uploadFile:async (file,options)=> {seen=options.agent; await new Promise(r=>resume=r);return {id:'af_fixture',agent:options.agent}}, }
  vm.runInNewContext(slice('core/chats.js','  async function addFiles(', '  const UPLOAD_ABORT'),context)
  const promise=context.addFiles('w',[{name:'secret.txt',type:'text/plain',size:6}])
  assert.equal(seen,'private-agent');W.w.agent='hermes';resume();await promise
  assert.equal(state.files[0].agent,'private-agent')
})

test('actual outbox audio upload and send preserve staged agent and reject mixed-agent attachments', async () => {
  const calls=[]
  const context = {
    File, window:{WizUploads:{upload:async(file,options)=>{calls.push({file,options});return {id:'af_audio',agent:options.agent,name:file.name}}}},
    HttpError: class extends Error { constructor(status, message) { super(message); this.status = status } },
    call: async (url, opts) => { calls.push({url, opts}); return { json: async () => ({file: {id:'af_audio', filename:'voice.webm'}}) } },
  }
  vm.runInNewContext(slice('outbox.js','  async function uploadAudio(', '  async function keepAudio('),context)
  const file=await context.uploadAudio({id:'stable-outbox-id',createdAt:0,agent:'private-agent',audio:new Blob(['audio']),audioType:'audio/webm'})
  assert.equal(calls[0].options.agent,'private-agent');assert.equal(calls[0].options.clientUploadId,'audio-stable-outbox-id');assert.equal(file.agent,'private-agent')
  Object.assign(context,{put:async()=>{},keepAudio:async()=>{},transcribe:async()=>'',J:{},now:()=>0,sentHooks:[]})
  context.call=async(url,opts)=>{calls.push({url,opts});return {json:async()=>({run_id:'run_fixture'})}}
  vm.runInNewContext(slice('outbox.js','  async function deliver(', '  async function attempt('),context)
  const item={id:'outbox-fixture',sessionId:'private-thread',model:'fixture-model',provider:'tinfoil',agent:'private-agent',text:'read attachment',files:[file]}
  await context.deliver(item)
  assert.deepEqual(JSON.parse(item.body).wizard_file_ids,['af_audio'])
  assert.equal(calls.at(-1).url,'/wizard/hermes/v1/runs?agent=private-agent')
  await assert.rejects(context.deliver({...item,body:undefined,agent:'hermes',text:'wrong target',files:[file]}),/another agent/)
})
