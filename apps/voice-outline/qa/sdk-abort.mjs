// Run with the real SDK used by the attested provider; no provider/network calls.
import http from 'node:http';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {OutlineRealtime} from '../realtime.mjs';
const sdk=process.env.OPENAI_SDK_DIR;if(!sdk)throw Error('Set OPENAI_SDK_DIR to the provider installed openai package');
const {OpenAI}=await import(pathToFileURL(sdk+'/index.mjs'));const {OpenAIRealtimeWS}=await import(pathToFileURL(sdk+'/realtime/ws.mjs'));
const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const client=new OpenAI({apiKey:'non-secret-fixture',baseURL:`http://127.0.0.1:${server.address().port}/v1`});
try{for(const action of ['abort','handshake-timeout']){let finish;const session=new OutlineRealtime({realtime:()=>new Promise(r=>finish=r)},{},{handshakeMs:15,retries:0});const opening=session.open();if(action==='abort')session.abort();else await new Promise(r=>setTimeout(r,25));const rt=new OpenAIRealtimeWS({model:'voxtral-mini-4b-realtime'},client);assert.equal(rt.socket.readyState,0);finish(rt);await opening;await new Promise(r=>setTimeout(r,30));assert.equal(rt.socket.readyState,3);assert.equal(session.terminal,true);console.log(JSON.stringify({ok:true,action,realSdk:true,closed:true}));}}finally{await new Promise(r=>server.close(r));}
