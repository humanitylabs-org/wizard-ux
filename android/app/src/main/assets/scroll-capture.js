/* Native-only helper. No bridge, network, persistent state or idle polling. */
(() => {
  if (window.__wosScrollCapture) return;
  let selected = null, active = null;
  function bounds(e) {
    if (!e?.isConnected || document.hidden) return null;
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    // PixelCopy uses window coordinates; scrollTop/client sizes are CSS layout units.
    // Translation is safe. Scaling, rotation, skew, perspective and browser zoom are not.
    if (window.visualViewport && Math.abs(visualViewport.scale - 1) > .001) return null;
    for (let node = e; node; node = node.parentElement) {
      const st = getComputedStyle(node);
      if ((st.zoom && Number(st.zoom) !== 1) || (st.scale && st.scale !== 'none') ||
          (st.rotate && st.rotate !== 'none') || st.perspective !== 'none') return null;
      if (st.transform !== 'none') {
        const m = new DOMMatrixReadOnly(st.transform);
        if (!m.is2D || Math.abs(m.a - 1) > .001 || Math.abs(m.d - 1) > .001 ||
            Math.abs(m.b) > .001 || Math.abs(m.c) > .001) return null;
      }
    }
    if (r.width < 80 || r.height < 80 || r.left < 0 || r.top < 0 ||
        r.right > innerWidth + 1 || r.bottom > innerHeight + 1 ||
        s.visibility !== 'visible' || s.display === 'none' ||
        !['auto','scroll'].includes(s.overflowY) || e.scrollHeight <= e.clientHeight + 2) return null;
    // Exclude covered/background desks and overlays, not merely display:none nodes.
    for (const x of [.1,.5,.9]) for (const y of [.1,.5,.9]) {
      const hit = document.elementFromPoint(r.left + r.width*x, r.top + r.height*y);
      if (!hit || !e.contains(hit)) return null;
    }
    return {x:r.left + e.clientLeft,y:r.top + e.clientTop,w:e.clientWidth,h:e.clientHeight,
      vw:innerWidth,top:e.scrollTop,height:e.scrollHeight};
  }
  function end(id) {
    const a = active; if (!a || a.id !== id) return false;
    active = null; clearTimeout(a.timer); a.observer.disconnect();
    // Only touch the exact original element. Never a selector into a new thread.
    if (a.url === location.href && a.owner?.dataset.draftFor === a.thread) a.e.scrollTop = a.top;
    for (const [k,v,p] of a.styles) v ? a.e.style.setProperty(k,v,p) : a.e.style.removeProperty(k);
    delete a.e.dataset.wosScrollCapture;
    document.removeEventListener('scroll', a.scroll, true);
    document.dispatchEvent(new Event('wos-scroll-capture-end'));
    return true;
  }
  function valid(id) {
    const a = active; if (!a || a.id !== id) return null;
    const b = bounds(a.e);
    if (!b || a.url !== location.href || a.owner?.dataset.draftFor !== a.thread ||
        b.height !== a.height || b.w !== a.w || b.h !== a.h || b.x !== a.x || b.y !== a.y) {
      end(id); return null;
    }
    return b;
  }
  window.__wosScrollCapture = {
    search() {
      if (active) return null;
      const candidates = [...document.querySelectorAll('[data-chats] .ch-msgs,[data-chats] .ch-scroll')]
        .map(e=>({e,b:bounds(e)})).filter(x=>x.b).sort((a,b)=>b.b.w*b.b.h-a.b.w*a.b.h);
      selected = candidates[0]?.e || null; return candidates[0]?.b || null;
    },
    start(id) {
      if (active) end(active.id);
      const e=selected, b=bounds(e); selected=null; if (!b) return null;
      const owner=e.closest('[data-chats]');
      const a=active={...b,id,e,owner,thread:owner?.dataset.draftFor,key:e.matches('.ch-msgs')?owner?.dataset.draftFor:null,url:location.href,
        styles:['scroll-behavior','overflow-anchor','scroll-snap-type'].map(k=>[k,e.style.getPropertyValue(k),e.style.getPropertyPriority(k)])};
      e.style.setProperty('scroll-behavior','auto','important');
      e.style.setProperty('overflow-anchor','none','important');
      e.style.setProperty('scroll-snap-type','none','important');
      e.dataset.wosScrollCapture=id;
      a.scroll=ev=>{if(ev.target===e) ev.stopImmediatePropagation();};
      document.addEventListener('scroll',a.scroll,true);
      a.observer=new MutationObserver(records=>{
        if(records.some(r=>e.contains(r.target))) end(id); else valid(id);
      });
      a.observer.observe(document.body,{childList:true,characterData:true,subtree:true});
      a.timer=setTimeout(()=>end(id),30000);
      return b;
    },
    move(id,top) { if(!valid(id))return null; active.e.scrollTop=top; return valid(id); },
    // Updated shells defer same-thread paints while pixels are being acquired. Navigation
    // restores synchronously before the renderer reads scrollTop; old shells safely abort.
    hold(owner,key) {
      const a=active;if(!a || a.owner!==owner)return false;
      if(a.key===key && valid(a.id))return true;
      end(a.id);return false;
    },
    check:valid, end
  };
  addEventListener('pagehide',()=>{if(active)end(active.id);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)end(active.id);});
})();
