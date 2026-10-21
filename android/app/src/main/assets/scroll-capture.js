/* Native-only helper. Origin-scoped metrics port; no network, storage or idle polling. */
(() => {
  if (window.__wosScrollCapture) return;
  let selected = null, active = null;
  // The chat window's own floating controls (new chat, send status, jump to latest). Like a
  // native list's sibling overlays they are not part of the scrolled content: they may cover
  // the scroller and are hidden while pixels are acquired so they are never stamped into tiles.
  const DOCK = '.ch-fab,.ch-pill,.ch-latest';
  const SHELL_DOCK = '#generalVoice.general-voice';
  const controls = e => [...(e.closest('[data-chats]')?.querySelectorAll(DOCK) || []),
    ...(e.closest('.device')?.querySelectorAll(SHELL_DOCK) || [])].filter(d=>!d.contains(e));
  const docked = (hit, e) => {
    const d = hit?.closest?.(DOCK + ',' + SHELL_DOCK);
    return !!d && controls(e).includes(d);
  };
  function bounds(e, reject=()=>null, allowHidden=false) {
    if (!e?.isConnected) return reject('detached');
    // PixelCopy needs a live page. The scroll proxy does not: an OEM screenshot toolbar
    // may pause the still-visible Activity, which marks the WebView page hidden.
    if (document.hidden && !allowHidden) return reject('document-hidden');
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    // PixelCopy uses window coordinates; scrollTop/client sizes are CSS layout units.
    // Translation is safe. Scaling, rotation, skew, perspective and browser zoom are not.
    if (window.visualViewport && Math.abs(visualViewport.scale - 1) > .001) return reject('viewport-zoom');
    for (let node = e; node; node = node.parentElement) {
      const st = getComputedStyle(node);
      if ((st.zoom && Number(st.zoom) !== 1) || (st.scale && st.scale !== 'none') ||
          (st.rotate && st.rotate !== 'none') || st.perspective !== 'none') return reject('ancestor-scale-rotate-perspective');
      if (st.transform !== 'none') {
        const m = new DOMMatrixReadOnly(st.transform);
        if (!m.is2D || Math.abs(m.a - 1) > .001 || Math.abs(m.d - 1) > .001 ||
            Math.abs(m.b) > .001 || Math.abs(m.c) > .001) return reject('ancestor-transform');
      }
    }
    if (r.width < 80 || r.height < 80) return reject('too-small');
    if (r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) return reject('outside-viewport');
    if (s.visibility !== 'visible' || s.display === 'none') return reject('hidden');
    if (!['auto','scroll'].includes(s.overflowY)) return reject('not-scroll-container');
    if (e.scrollHeight <= e.clientHeight + 2) return reject('not-overflowing');
    // Exclude covered/background desks and overlays, not merely display:none nodes.
    // A paused (hidden) page has no fresh hit-test frame; keep only the scroller that
    // was already confirmed uncovered while the window was live.
    if (document.hidden && allowHidden) {
      if (e !== proxyNode) return reject('hidden-unconfirmed');
    } else for (const x of [.1,.5,.9]) for (const y of [.1,.5,.9]) {
      const hit = document.elementFromPoint(r.left + r.width*x, r.top + r.height*y);
      if (!hit || !(e.contains(hit) || docked(hit, e))) return reject('occluded');
    }
    return {x:r.left + e.clientLeft,y:r.top + e.clientTop,w:e.clientWidth,h:e.clientHeight,
      vw:innerWidth,dpr:devicePixelRatio,top:e.scrollTop,height:e.scrollHeight};
  }
  function end(id) {
    const a = active; if (!a || a.id !== id) return false;
    active = null; clearTimeout(a.timer); a.observer.disconnect();
    // Only touch the exact original element. Never a selector into a new thread.
    if (a.url === location.href && a.owner?.dataset.draftFor === a.thread) a.e.scrollTop = a.top;
    for (const [k,v,p] of a.styles) v ? a.e.style.setProperty(k,v,p) : a.e.style.removeProperty(k);
    for (const [d,v,p] of a.dock) v ? d.style.setProperty('visibility',v,p) : d.style.removeProperty('visibility');
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
  let searchReason='no-chat-scrollers';
  function candidate(allowHidden=false) {
    const reasons=[],reject=reason=>{if(!reasons.includes(reason))reasons.push(reason);return null;};
    const found=[...document.querySelectorAll('[data-chats] .ch-msgs,[data-chats] .ch-scroll')]
      .map(e=>({e,b:bounds(e,reject,allowHidden)})).filter(x=>x.b).sort((a,b)=>b.b.w*b.b.h-a.b.w*a.b.h)[0] || null;
    searchReason=found?'ok':reasons.join('|') || 'no-chat-scrollers';return found;
  }
  // Samsung Smart Capture sees a View, not overflow divs. Publish only changed,
  // numeric geometry from the exact same candidate as AOSP; never touch input.
  const documentKey='sc-'+Math.random().toString(36).slice(2)+'-';
  let proxyNode=null, proxyIdentity='', proxyKey='', serial=0, last='', timer=0, frame=0, sentAt=0;
  let resize=null;
  const port=window.wizardScrollPort;
  function proxyCandidate() {
    const c=active?null:candidate(true);
    const identity=c ? location.href+'\n'+(c.e.closest('[data-chats]')?.dataset.draftFor || '') : '';
    if(c?.e!==proxyNode || identity!==proxyIdentity) {
      proxyNode=c?.e || null;proxyIdentity=identity;proxyKey=c?documentKey+(++serial):'';
      resize?.disconnect();
      if(proxyNode && resize) {
        resize.observe(proxyNode);
        for(const child of proxyNode.children)resize.observe(child);
      }
    }
    return c;
  }
  function pushProxy() {
    timer=0;frame=0;sentAt=performance.now();
    const c=proxyCandidate(), b=c?.b;
    const value=JSON.stringify(b ? {v:1,key:proxyKey,height:b.height,top:b.top,extent:b.h,dpr:b.dpr,vw:b.vw,reason:'ok'} : {v:1,reason:active?'capture-active':searchReason});
    if(value!==last) { last=value;try {port?.postMessage(value);}catch(_){} }
  }
  function refreshProxy() {
    if(!port || timer || frame)return;
    // Hidden pages get no animation frames; push from the timer instead.
    timer=setTimeout(()=>{timer=0;if(document.hidden)pushProxy();else frame=requestAnimationFrame(pushProxy);},Math.max(0,100-(performance.now()-sentAt)));
  }
  function proxyScroll(key,method,y) {
    const c=proxyCandidate();
    if(!c || key!==proxyKey || !Number.isFinite(y) || !['by','to'].includes(method))return false;
    // Absolute/relative commands are executed serially in JS (no lost deltas),
    // even when the native metrics acknowledgement is still throttled.
    const e=c.e,old=e.style.getPropertyValue('scroll-behavior'),priority=e.style.getPropertyPriority('scroll-behavior');
    e.style.setProperty('scroll-behavior','auto','important');
    e.scrollTop=method==='by'?e.scrollTop+y:y;
    old?e.style.setProperty('scroll-behavior',old,priority):e.style.removeProperty('scroll-behavior');
    refreshProxy();return true;
  }
  if(port) {
    resize=new ResizeObserver(refreshProxy);
    const changes=new MutationObserver(records=>{
      if(records.some(r=>r.type==='childList') && proxyNode) {
        resize.disconnect();resize.observe(proxyNode);
        for(const child of proxyNode.children)resize.observe(child);
      }
      refreshProxy();
    });
    changes.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,
      attributeFilter:['class','style','hidden','data-draft-for']});
    document.addEventListener('scroll',refreshProxy,{capture:true,passive:true});
    // Current WebViews expose Navigation API; MainActivity's visited-history
    // callback refreshes older WebViews without patching history/Back semantics.
    window.navigation?.addEventListener('currententrychange',refreshProxy);
    window.visualViewport?.addEventListener('resize',refreshProxy,{passive:true});
    window.visualViewport?.addEventListener('scroll',refreshProxy,{passive:true});
    for(const event of ['resize','popstate','hashchange','pageshow'])addEventListener(event,refreshProxy,{passive:true});
    for(const event of ['transitionend','animationend','visibilitychange','wos-scroll-capture-end'])document.addEventListener(event,refreshProxy,{passive:true});
    addEventListener('pagehide',()=>{clearTimeout(timer);cancelAnimationFrame(frame);timer=frame=0;last='';try{port.postMessage('{"v":1}');}catch(_){};});
    refreshProxy();
  }
  window.__wosScrollCapture = {
    refreshProxy, proxyScroll,
    searchReason:()=>searchReason,
    resumeProxy() { last='';refreshProxy(); },
    search() {
      if (active) return null;
      const c=candidate();selected=c?.e || null;return c?.b || null;
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
      a.dock=controls(e)
        .map(d=>[d,d.style.getPropertyValue('visibility'),d.style.getPropertyPriority('visibility')]);
      for (const [d] of a.dock) d.style.setProperty('visibility','hidden','important');
      e.dataset.wosScrollCapture=id;
      a.scroll=ev=>{if(ev.target===e) ev.stopImmediatePropagation();};
      document.addEventListener('scroll',a.scroll,true);
      a.observer=new MutationObserver(records=>{
        if(records.some(r=>e.contains(r.target))) end(id); else valid(id);
      });
      a.observer.observe(document.body,{childList:true,characterData:true,subtree:true});
      refreshProxy();
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
