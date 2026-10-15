import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL('../web/' + path, import.meta.url), 'utf8')
const slice = (file, first, last) => { const s=source(file); return s.slice(s.indexOf(first),s.indexOf(last,s.indexOf(first))) }

test('real resumable client binds every create/status/PATCH/complete to captured agent', async () => {
  const calls=[]; let offset=0
  const context={ window:{ WizLive:{bootstrap:{capabilities:{resumable_uploads:{available:true,api_base:'/wizard/v1/uploads',chunk_bytes:3}}}}}, navigator:{onLine:true}, crypto:globalThis.crypto, AbortController, setTimeout, clearTimeout, addEventListener(){}, removeEventListener(){}, DOMException,
    fetch:async (url,opts={}) => { calls.push({url,opts}); let body={}; const headers={}
      if (url==='/wizard/v1/uploads') body={upload_id:'upl_fixture',offset:0,chunk_bytes:3}
      else if (url.includes('/complete')) body={file:{id:'af_fixture',filename:'private.txt',mime:'text/plain',bytes:6}}
      else if(opts.method==='PATCH') { offset+=opts.body.size; headers['Upload-Offset']=String(offset) }
      else body={offset}
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
    HttpError: class extends Error { constructor(status, message) { super(message); this.status = status } },
    call: async (url, opts) => { calls.push({url, opts}); return { json: async () => ({file: {id:'af_audio', filename:'voice.webm'}}) } },
  }
  vm.runInNewContext(slice('outbox.js','  async function uploadAudio(', '  async function keepAudio('),context)
  const file=await context.uploadAudio({createdAt:0,agent:'private-agent',audio:new Blob(['audio']),audioType:'audio/webm'})
  assert.equal(calls[0].url,'/wizard/files/upload?agent=private-agent');assert.equal(file.agent,'private-agent')
  Object.assign(context,{put:async()=>{},keepAudio:async()=>{},transcribe:async()=>'',J:{},now:()=>0,sentHooks:[]})
  context.call=async(url,opts)=>{calls.push({url,opts});return {json:async()=>({run_id:'run_fixture'})}}
  vm.runInNewContext(slice('outbox.js','  async function deliver(', '  async function attempt('),context)
  const item={id:'outbox-fixture',sessionId:'private-thread',model:'fixture-model',provider:'tinfoil',agent:'private-agent',text:'read attachment',files:[file]}
  await context.deliver(item)
  assert.deepEqual(JSON.parse(item.body).wizard_file_ids,['af_audio'])
  assert.equal(calls.at(-1).url,'/wizard/hermes/v1/runs?agent=private-agent')
  await assert.rejects(context.deliver({...item,body:undefined,agent:'hermes',text:'wrong target',files:[file]}),/another agent/)
})
