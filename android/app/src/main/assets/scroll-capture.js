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
  // Sanitised element label for diagnostics: tag#id.class only, never text or URLs.
  const label = n => !n?.tagName ? '' : (n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') +
    (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).slice(0,3).join('.') : ''))
    .replace(/[^a-z0-9#._-]/gi,'').slice(0,80);
  let searchDetail = null;
  // Geometry the capture can safely map to window pixels. No hit testing here.
  function geometry(e, reject=()=>null, allowHidden=false) {
    if (!e?.isConnected) return reject('detached');
    // An OS-owned capture session may pause the Activity (page hidden) while the
    // window is still on screen. Only discovery requires a live page.
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
    if (s.visibility !== 'visible' || s.display === 'none') return reject('hidden');
    if (!['auto','scroll'].includes(s.overflowY)) return reject('not-scroll-container');
    if (e.scrollHeight <= e.clientHeight + 2) return reject('not-overflowing');
    // The scrollport (inside borders, excluding scrollbars), clipped to the window.
    const top = r.top + e.clientTop, left = r.left + e.clientLeft;
    const y0 = Math.max(0, top), y1 = Math.min(innerHeight, top + e.clientHeight);
    if (left < -1 || left + e.clientWidth > innerWidth + 1 || r.width < 80) return reject('outside-viewport');
    if (y1 - y0 < 80) return reject('outside-viewport');
    return {x:left, w:e.clientWidth, top0:top, y0, y1, scrollHeight:e.scrollHeight};
  }
  // The longest vertical band of the scrollport that the user actually sees. Window chrome
  // (an agent header, the composer, a voice bar) may overlap the scroller's ends: those
  // rows are excluded rather than rejecting the whole thread. Small floating controls
  // inside the band are hidden while capturing so they are never stamped into tiles.
  function band(e, g, reject=()=>null) {
    const xs = [.15,.5,.85].map(f => g.x + g.w*f), rows = [], floaters = new Set(), blockers = new Map();
    const step = 8;
    for (let y = g.y0 + 2; y < g.y1 - 1; y += step) {
      let clear = true;
      for (const x of xs) {
        const hit = document.elementFromPoint(x, y);
        if (hit && (e.contains(hit) || docked(hit, e))) continue;
        // A small control floating over the list (narrower than 60% of it) is not chrome.
        let top = hit; while (top?.parentElement && !top.parentElement.contains(e) &&
          getComputedStyle(top.parentElement).position !== 'static') top = top.parentElement;
        const tr = top?.getBoundingClientRect?.();
        if (top && !top.contains(e) && tr && tr.width < g.w*.6 && tr.height < (g.y1-g.y0)*.35) { floaters.add(top); continue; }
        clear = false; if (hit && blockers.size < 4) blockers.set(label(hit), hit);
      }
      rows.push(clear);
    }
    let best = [0,0], run = 0;
    rows.forEach((c,i) => { run = c ? run + 1 : 0; if (run > best[1]) best = [i - run + 1, run]; });
    const detail = {scroller:label(e), port:[g.x,g.y0,g.w,g.y1-g.y0].map(Math.round), vh:innerHeight, vw:innerWidth,
      vv:window.visualViewport ? [visualViewport.offsetTop, visualViewport.height].map(Math.round) : null,
      blockers:[...blockers.entries()].map(([k,n]) => { const r=n.getBoundingClientRect(), s=getComputedStyle(n);
        return {el:k, rect:[r.left,r.top,r.width,r.height].map(Math.round), pos:s.position, z:s.zIndex, pe:s.pointerEvents,
          up:label(n.parentElement)+'<'+label(n.parentElement?.parentElement)}; }),
      floaters:[...floaters].map(label).slice(0,4)};
    // Stay inside the sampled clear rows, never halfway into an unsampled blocker.
    const b0 = best[1] ? Math.ceil(best[0] === 0 ? g.y0 : g.y0 + 2 + best[0]*step) : 0;
    const b1 = best[1] ? Math.floor(best[0] + best[1] >= rows.length ? g.y1 : g.y0 + 2 + (best[0]+best[1]-1)*step) : 0;
    detail.band = [b0, b1 - b0];
    searchDetail = detail;
    if (!best[1] || b1 - b0 < Math.max(120, (g.y1 - g.y0)*.35)) return reject('occluded');
    return {y:b0, h:b1 - b0, floaters:[...floaters]};
  }
  function bounds(e, reject=()=>null, allowHidden=false) {
    const g = geometry(e, reject, allowHidden); if (!g) return null;
    // A paused (hidden) page has no fresh hit-test frame; keep only the scroller that
    // was already confirmed uncovered while the window was live.
    if (document.hidden && allowHidden) {
      if (e !== proxyNode) return reject('hidden-unconfirmed');
      return {x:g.x,y:g.y0,w:g.w,h:g.y1-g.y0,vw:innerWidth,dpr:devicePixelRatio,top:e.scrollTop,height:e.scrollHeight};
    }
    const v = band(e, g, reject); if (!v) return null;
    return {x:g.x,y:v.y,w:g.w,h:v.h,vw:innerWidth,dpr:devicePixelRatio,top:e.scrollTop,height:e.scrollHeight,
      clipTop:v.y - g.top0, clipBottom:Math.max(0, g.top0 + e.clientHeight - (v.y + v.h)), floaters:v.floaters};
  }
  const pub = b => b && {x:b.x,y:b.y,w:b.w,h:b.h,vw:b.vw,dpr:b.dpr,top:b.top,height:b.height};
  function end(id) {
    const a = active; if (!a || a.id !== id) return false;
    active = null; clearTimeout(a.timer); a.observer.disconnect();
    // Only touch the exact original element. Never a selector into a new thread.
    for (const [k,v,p] of a.styles) v ? a.e.style.setProperty(k,v,p) : a.e.style.removeProperty(k);
    if (a.url === location.href && a.owner?.dataset.draftFor === a.thread) a.e.scrollTop = a.top;
    for (const [d,v,p] of a.dock) v ? d.style.setProperty('visibility',v,p) : d.style.removeProperty('visibility');
    delete a.e.dataset.wosScrollCapture;
    document.removeEventListener('scroll', a.scroll, true);
    document.dispatchEvent(new Event('wos-scroll-capture-end'));
    return true;
  }
  // During a session the band is frozen: only the scroller's own geometry and content
  // height are re-checked (overlays were hidden or excluded when the session started).
  function valid(id) {
    const a = active; if (!a || a.id !== id) return null;
    const g = geometry(a.e, () => null, true);
    if (!g || a.url !== location.href || a.owner?.dataset.draftFor !== a.thread ||
        g.scrollHeight !== a.height || g.x !== a.x || g.w !== a.w || g.top0 !== a.top0 || g.y0 !== a.y0 || g.y1 !== a.y1) {
      end(id); return null;
    }
    return {x:a.x,y:a.y,w:a.w,h:a.h,vw:innerWidth,dpr:devicePixelRatio,top:a.e.scrollTop,height:a.height};
  }
  let searchReason='no-chat-scrollers';
  function candidate(allowHidden=false) {
    searchDetail = null;
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
  const port=null; // Proxy retired: One UI uses the AOSP ScrollCaptureCallback only (0.9.39 device recording).
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
    if (!port) return false;
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
    searchDetail:()=>searchDetail,
    search() {
      if (active) return null;
      const c=candidate();selected=c?.e || null;return pub(c?.b) || null;
    },
    start(id) {
      if (active) end(active.id);
      const e=selected, b=bounds(e); selected=null; if (!b) return null;
      const owner=e.closest('[data-chats]');
      const a={...b,id,e,owner,thread:owner?.dataset.draftFor,key:e.matches('.ch-msgs')?owner?.dataset.draftFor:null,url:location.href,
        top0:e.getBoundingClientRect().top + e.clientTop,
        y0:Math.max(0,e.getBoundingClientRect().top + e.clientTop),
        y1:Math.min(innerHeight,e.getBoundingClientRect().top + e.clientTop + e.clientHeight),
        styles:['scroll-behavior','overflow-anchor','scroll-snap-type','padding-top','padding-bottom'].map(k=>[k,e.style.getPropertyValue(k),e.style.getPropertyPriority(k)])};
      e.style.setProperty('scroll-behavior','auto','important');
      e.style.setProperty('overflow-anchor','none','important');
      e.style.setProperty('scroll-snap-type','none','important');
      // Rows hidden under chrome at either end would never pass through the band at the
      // scroll limits. Pad by the clipped amount so the first and last messages are captured.
      const cs=getComputedStyle(e);
      if (b.clipTop > 0) { e.style.setProperty('padding-top',(parseFloat(cs.paddingTop)+b.clipTop)+'px','important'); e.scrollTop=b.top+b.clipTop; }
      if (b.clipBottom > 0) e.style.setProperty('padding-bottom',(parseFloat(cs.paddingBottom)+b.clipBottom)+'px','important');
      a.top=b.top; a.height=e.scrollHeight;
      a.dock=[...new Set([...controls(e),...(b.floaters||[])])]
        .map(d=>[d,d.style.getPropertyValue('visibility'),d.style.getPropertyPriority('visibility')]);
      for (const [d] of a.dock) d.style.setProperty('visibility','hidden','important');
      e.dataset.wosScrollCapture=id;
      a.scroll=ev=>{if(ev.target===e) ev.stopImmediatePropagation();};
      document.addEventListener('scroll',a.scroll,true);
      active=a;
      a.observer=new MutationObserver(()=>valid(id));
      a.observer.observe(document.body,{childList:true,characterData:true,subtree:true});
      refreshProxy();
      a.timer=setTimeout(()=>end(id),30000);
      return valid(id);
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
  // Visibility alone never ends an OS-owned session: the system cancels it, or the 30 s watchdog does.
})();
