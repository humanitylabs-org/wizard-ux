/* Shell-side appearance adapter. Theme content only; no data or agent privileges. */
(() => {
  'use strict';
  const known = new WeakMap(); let scheduled=false,revision=0,comparison='unified';
  const color = (s,k,f) => s.getPropertyValue('--'+k).trim() || f;
  function snapshot(frame) {
    const s=getComputedStyle(document.documentElement), light=(window.WosSkin?.current||document.documentElement.dataset.skin)==='paper';
    const bg=color(s,'bg','#05030c'), ink=color(s,'ink','#f3efff'), accent=color(s,'violet-2','#b99bff');
    return {version:1,revision,skin:window.WosSkin?.current||document.documentElement.dataset.skin||'nebula',comparison,colorScheme:light?'light':'dark',presentation:frame.closest('.win.full')?'immersive':'window',tokens:{
      canvas:bg,surface:color(s,'glass','rgba(18,12,38,.58)'),
      'surface-raised':light?'#fffdf8':`color-mix(in srgb, ${bg} 88%, ${ink} 12%)`,text:ink,
      'text-secondary':color(s,'ink-2','#b9b0d8'),
      'text-muted':`color-mix(in srgb, ${ink} 65%, ${bg} 35%)`,border:color(s,'line-2','rgba(205,190,255,.24)'),accent,
      'accent-soft':`color-mix(in srgb, ${accent} 16%, transparent)`,
      'on-accent':light?'#fffdf8':bg,
      'reader-surface':light?'#fffdf8':`color-mix(in srgb, ${bg} 94%, ${ink} 6%)`
    }};
  }
  function send(frame, force=false) {
    if (!frame.contentWindow || !frame.matches('iframe.appframe')) return;
    let origin; try { origin=new URL(frame.src,location.href).origin; } catch{return}
    // This isolated fixture host accepts same-origin registered demo app documents only.
    if (origin!==location.origin || !new URL(frame.src,location.href).pathname.startsWith('/wizard-os-home/demo/apps/')) return;
    const appearance=snapshot(frame),sig=JSON.stringify({...appearance,revision:0});
    if(!force&&known.get(frame)?.signature===sig)return;
    known.set(frame,{signature:sig,appearance,ack:false});
    frame.contentWindow.postMessage({type:'wizard:appearance',appearance},origin);
  }
  function sync(force=false){revision++;document.querySelectorAll('iframe.appframe').forEach(f=>send(f,force));}
  function queue(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;sync()});}
  addEventListener('message',e=>{
    if(e.origin!==location.origin)return;
    const frame=[...document.querySelectorAll('iframe.appframe')].find(f=>f.contentWindow===e.source);
    if(!frame)return;
    if(e.data?.type==='wizard:appearance:ready'&&e.data.version===1){revision++;send(frame,true);}
    if(e.data?.type==='wizard:appearance:ack'&&e.data.version===1){const state=known.get(frame);if(state&&e.data.revision===state.appearance.revision)state.ack=true;}
  });
  function mount(){
    const root=document.documentElement;
    new MutationObserver(queue).observe(root,{attributes:true,attributeFilter:['style','data-skin']});
    const track=document.getElementById('track')||document.body;
    new MutationObserver(queue).observe(track,{childList:true,subtree:true,attributes:true,attributeFilter:['class','src']});
    track.addEventListener('load',e=>{if(e.target.matches?.('iframe.appframe')){revision++;send(e.target,true)}},true);
    sync(true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
  window.WizardAppearance={version:1,sync,setComparison(value){comparison=value==='original'?'original':'unified';sync(true)},get comparison(){return comparison},inspect(){return [...document.querySelectorAll('iframe.appframe')].map(f=>({src:f.src,...known.get(f)}))}};
})();
