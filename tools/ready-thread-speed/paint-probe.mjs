// Browser-side observer, shared verbatim with the bounded DOM regression test.
// A sentinel is a complete synthetic token, never a prefix of another revision.
export function installPaintProbe({wid,expected,staleMarker=''}) {
  window.__speed={start:0,expected,wid,first:null,stale:false,staleMarker};
  window.__speedObserver?.disconnect();cancelAnimationFrame(window.__speedFrame||0);
  const visible=(root,answer,marker)=>{
    if(!marker)return false;
    const clip=root.getBoundingClientRect(),walker=document.createTreeWalker(answer,NodeFilter.SHOW_TEXT);
    let node;
    while(node=walker.nextNode()){
      const text=node.textContent||'';
      for(let from=0,at;(at=text.indexOf(marker,from))>=0;from=at+marker.length){
        if(/[A-Za-z0-9_]/.test(text[at-1]||'')||/[A-Za-z0-9_]/.test(text[at+marker.length]||''))continue;
        let shown=true;
        for(let el=node.parentElement;el;el=el.parentElement){
          const style=getComputedStyle(el);
          if(style.visibility==='hidden'||style.visibility==='collapse'||style.display==='none'||Number(style.opacity)===0){shown=false;break;}
        }
        if(!shown)continue;
        const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+marker.length);
        for(const r of range.getClientRects()){
          const left=Math.max(0,clip.left,r.left),top=Math.max(0,clip.top,r.top);
          const right=Math.min(innerWidth,clip.right,r.right),bottom=Math.min(innerHeight,clip.bottom,r.bottom);
          if(right<=left||bottom<=top)continue;
          const hit=document.elementFromPoint((left+right)/2,(top+bottom)/2);
          if(node.parentElement.contains(hit))return true;
        }
      }
    }
    return false;
  };
  const check=()=>{
    const s=window.__speed;if(!s.start||s.first!==null)return;
    const root=document.querySelector(`[data-win="${s.wid}"] .ch-msgs`);
    const answer=root&&[...root.querySelectorAll('.msg.a')].at(-1);
    if(!answer){s.visibleFrame=false;return;}
    // Same owned, clipped, visible, unoccluded Range criterion for old and new.
    // Earlier assistant messages are legitimate history, not a current reply.
    if(visible(root,answer,s.staleMarker))s.stale=true;
    if(visible(root,answer,s.expected)){
      if(s.visibleFrame)s.first=performance.now()-s.start;
      else s.visibleFrame=true;
    }else s.visibleFrame=false;
  };
  const loop=()=>{check();if(window.__speed.first===null)window.__speedFrame=requestAnimationFrame(loop);};
  window.__speedFrame=requestAnimationFrame(loop);
}
