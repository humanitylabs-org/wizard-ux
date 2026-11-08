'use strict';
// Exercise the owner's actual failed-Start controller against a synthetic permission rejection.
// Only environment/DOM/upload dependencies are mocked; never reimplement the production hold logic.
const assert=require('node:assert/strict');
function controller(source) {
 const slice=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert(i>=0&&j>i,'Recorder source marker missing: '+a);return source.slice(i,j)};
 return slice('class SharedMeeting {','// Decode backend WAV')+
   slice(source.includes('async function clearEmptyFailedStart(')?'async function clearEmptyFailedStart(':'async function beginRecording(', '// A recording left paused')+
   slice('function endRecSession()', 'const BAR_SHAPE =');
}
function fixture(source) {
 const production=controller(source);
 const script=`(async()=>{
 const WizardApp={...window.WizardApp,capture:{...window.WizardApp.capture,start:async()=>{throw new DOMException('Synthetic permission rejection','NotAllowedError')}}};
 const state={current:{id:'synthetic-meeting',title:'Synthetic',status:'recording'},rec:null};
 const deletingMeetings=new Set(),prefs={},els={notepad:{hidden:true},docPane:{dataset:{}}},mobileMQ={matches:false},$=()=>null;
 const live={start(){},stop(){}},captureCaps=()=>({}),isImported=()=>false;
 const Uploader=class{constructor(){this.q=[]}get pending(){return this.q.length}};
 const discardWarm=w=>w?.release?.(),navigate=()=>{},setCurrent=m=>state.current=m;
 const renderDoc=()=>{},renderRecBanner=()=>{},renderPill=()=>{},renderHeader=()=>{},renderAskBar=()=>{},schedulePoll=()=>{},notifyNative=()=>{},showParticipantsHint=()=>{},updateLevel=()=>{},renderPillQueue=()=>{},onNativeState=()=>{};
 ${production}
 window.fixtureState=state;await beginRecording();window.fixtureReady=true;
 })().catch(e=>{window.fixtureError=String(e.stack);window.fixtureReady=true});`;
 // Compile the assembled source without starting a browser or executing capture.
 new Function(script);
 return '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/wizard-os-home/kit/wizard-ui.css"><script src="/wizard-os-home/core/app-client.js"></script><p>Synthetic Recorder failed-Start controller. No private data.</p><script>'+script.replaceAll('</script','<\\/script')+'</script>';
}
module.exports={controller,fixture};
