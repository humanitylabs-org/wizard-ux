/* One local command grammar; explicit command misses NEVER fall through to an agent. */
(() => {
 'use strict';
 // Tap = message to the agent, never a command (James, 21 Oct 2026).
 // Typed command surfaces retain their existing grammar; long press = command.
 const isMessageTake = (kind, typed = false) => !typed && kind !== 'command';
 function create({ CHATS, APP, appByName, findApp, quickSearch, sendSnap }) {
 const norm = window.WizCore.norm;
 const { TODAY, YESTERDAY } = window.WosViews;
  function chatsVoice(t, snap, kind) {
    const v = snap?.view; if (!v || v.kind !== 'thread list') return null;
    const s = norm(window.WizConfig.stripAddress(t)).replace(/ please$/, '').trim();
    if (/^(clear|remove|reset|turn off|drop) (the |all )?(filters?|chips?)$|^(show )?(all|every) (chats|threads)$|^show everything$|^no filters?$/.test(s)) return { action: 'chats_filter', clear: true };
    let m = s.match(/^(?:filter|filtered) (?:by |to |for |on )?(.+)$/) || s.match(/^only (?:show )?(.+)$/) || s.match(/^show (?:me )?(?:only |just )?(?:the |my )?(.+?)(?: only| chats| threads)?$/);
    if (m) {
      const want = m[1].replace(/ (chats|threads|messages|ones)$/, '').trim();
      const f = CHATS.matchFilters(want, 1)[0];
      if (f) return { action: 'chats_filter', f };
      if (/^(?:filter|filtered)/.test(s)) return { action: 'chats_search', q: want };
      return null; // "show me …" with no filter match is not ours
    }
    // Only a held orb reaches voice command parsing; typed search keeps its grammar.
    m = s.match(kind === 'command' ? /^(?:search|find|look for)(?: (?:my |the )?(?:chats|threads|messages))?(?: for)? (.+)$/ : /^search(?: (?:my |the )?(?:chats|threads|messages))?(?: for)? (.+)$/);
    if (m) return { action: 'chats_search', q: m[1] };
    return null;
  }
  function localParse(t, snap, kind, typed = false) {
    if (isMessageTake(kind, typed)) return null;
    const explicit = norm(window.WizConfig.stripAddress(t)).replace(/ please$/, '');
    if (kind === 'command' || (snap || sendSnap()).view?.kind !== 'chat thread') {
    if (/^(help|show help|open help|gestures|keyboard shortcuts)$/.test(explicit)) return { action:'open_view', view:'help' };
    if (/^(settings|open settings|usage|show usage)$/.test(explicit)) return { action:'open_view', view:/usage/.test(explicit)?'usage':'settings' };
    let destination = explicit.match(/^(?:navigate|directions|drive)(?: to)? (.+)$/);
    if (destination) return {action:'navigate',destination:destination[1]};
    destination=explicit.match(/^(?:maps search|search maps for|find on maps) (.+)$/);
    if(destination)return {action:'maps_search',query:destination[1]};
    const feature=window.WosFeatures?.entries.find(f=>[f.id,norm(f.title||f.id)].includes(explicit.replace(/^(open|show) /,'')));
    if(feature)return {action:'open_view',view:feature.id};
    }
    // The music search spell ("music search Home Tides") wins everywhere, even over the Chats list's "search …".
    { const ms = window.WosMusic?.available() && window.WosMusic.parse(t, false, false); if (ms && ms.op === 'search') return { action: 'music', cmd: ms }; }
    // The strong quick-search spells ("ask AI …", "image search …", "find images of …") win everywhere too: on the
    // Chats list a held "find images of cats" used to filter the list instead of opening Search.
    { const q0 = quickSearch(t); if (q0?.strong) return { action: 'quick_search', query: q0.query, tab: q0.tab }; }
    { const cv = chatsVoice(t, snap || sendSnap(), kind); if (cv) return cv; }
    // Food spells (James, 12 Oct): "order food" / "order grab" / "order lunch" open Grab for a new order; "order kra pao"
    // or "order my usual kra pao" runs a saved one; "food" on its own opens the Food app. All on the phone, nothing to Wizard.
    const us = window.WosUsuals?.match(t); if (us) return { action: 'usual', id: us };
    if (window.WosUsuals?.available()) {
      const fs = window.WosUsuals.spell(t);
      if (fs === 'new') return { action: 'usual', id: '+new' };
      if (fs === 'open' && (kind === 'command' || (snap || sendSnap()).view?.kind !== 'chat thread')) return { action: 'open_app', app: (APP.usuals || {}).name || 'Food' };
    }
    // A bare app name opens that app, no "open" needed (James, 12 Oct: "If I say the name of an app, it should just
    // open that app"). Held: anywhere, even over Wizard Music or a thread. Taps never enter this grammar.
    // Exact names and aliases only (appByName), never a fuzzy guess.
    if (kind === 'command' || (snap || sendSnap()).view?.kind !== 'chat thread') { const an = appByName(t); if (an) return { action: 'open_app', app: an.name }; }
    // Music (play …, pause, next, louder, I like this): on-device, straight to Wizard Music. A held orb takes any
    // music phrase; typed surfaces retain their existing matching rules. Taps are messages.
    // In front of Wizard Music a held orb is always for the player ("Guy Barato Trap" = play it).
    if (window.WosMusic?.available()) {
      const front = (snap || sendSnap()).view?.appId === 'wizard-music';
      const inMusic = kind === 'command' && front;
      const mc = window.WosMusic.parse(t, inMusic, front);
      const v0 = (snap || sendSnap()).view;
      const typedOk = mc && (mc.strong || (mc.op === 'play' && v0?.kind !== 'chat thread' && norm(t).split(' ').length <= 8));
      if (mc && (kind === 'command' || typedOk)) return { action: 'music', cmd: mc };
    }
    // The quick-search spell ("image search …", "search …") opens the search sheet on-device, even over a thread.
    // A held orb is always a command, so there even the plain "search for …" form is the search app's.
    const qs = quickSearch(t);
    if (qs && (qs.strong || kind === 'command' || (snap || sendSnap()).view?.kind !== 'chat thread')) return { action: 'quick_search', query: qs.query, tab: qs.tab };
    const s = norm(window.WizConfig.stripAddress(t)).replace(/ please$/, '');
    if (/^(zoom|go|dive) (in|deeper|down)\b/.test(s)) return { action: 'zoom', dir: 'in' };
    if (/^(zoom|back|go|pull) (out|up|back)\b|^zoom out\b/.test(s)) {
      const lv = /month/.test(s) ? 'month' : /week/.test(s) ? 'week' : null;
      return lv ? { action: 'open_view', view: lv } : { action: 'zoom', dir: 'out' };
    }
    if (/^(next|right) desk|^desk (right|next)/.test(s)) return { action: 'desk', to: 'next' };
    if (/^(previous|prev|left|last) desk|^desk (left|back)/.test(s)) return { action: 'desk', to: 'prev' };
    if (/^(go )?home( screen| desk)?$/.test(s)) return { action: 'desk', to: 'home' };
    if (/^(clear|close) (this |the )?desk$/.test(s)) return { action: 'clear_desk' };
    if (/^(close|quit|kill) (this |the )?(window|app)$/.test(s)) return { action: 'close_window' };
    if (/^(go |make (it|this) )?full ?screen$|^(maximi[sz]e|expand)( (it|this))?$/.test(s)) return { action: 'fullscreen', on: true };
    if (/^(exit full ?screen|tile( it| this)?|un ?maximi[sz]e|shrink( it| this)?)$/.test(s)) return { action: 'fullscreen', on: false };
    let m = s.match(/^move (?:this|it|the window)(?: window| app)? (?:to )?(?:the )?(left|right|next|previous|prev)(?: desk)?$/);
    if (m) return { action: 'move_window', to: /left|prev/.test(m[1]) ? 'prev' : 'next' };
    if (/^(show |open )?(my )?(inbox|notifications)$/.test(s)) return { action: 'open_view', view: 'inbox' };
    if (/^((change|switch|pick|choose|open|show) )?(the |my |a )?(skins?|themes?)$|^change (the |my )?look$/.test(s)) return { action: 'open_view', view: 'skin' };
    if (/^(show |open )?(my )?(apps|app list|launcher|all apps)$/.test(s)) return { action: 'open_view', view: 'apps' };
    m = s.match(/^(?:open|launch|show|start|go to|switch to)\s+(?:me\s+)?(.+)$/);
    if (m) {
      const q = m[1];
      if (/^(yesterday|yesterdays review|yesterday s review)$/.test(q)) return { action: 'open_view', view: 'day', date: YESTERDAY };
      if (/^today$/.test(q)) return { action: 'open_view', view: 'day', date: TODAY };
      if (/^(the |this )?week( in review)?$/.test(q)) return { action: 'open_view', view: 'week' };
      if (/^(the |this )?month( in review)?$/.test(q)) return { action: 'open_view', view: 'month' };
      const a = findApp(q); if (a) return { action: 'open_app', app: a.name };
    }
    return null;
  }

 return {parse:localParse};
 }
 function execute(c, text, H) {
   const a = c.action;
   if (a === 'music') return window.WosMusic?.run(c.cmd, H.musicDone) || false;
   // Router vocabulary (server ROUTER_SYSTEM): play_music and search had no handler, so they silently failed.
   if (a === 'play_music') return window.WosMusic?.run({ op: 'play', said: 'play ' + String(c.query || '').trim() }, H.musicDone) || false;
   if (a === 'search' && c.query) return H.search(c.query, c.tab);
   if (a === 'usual') return window.WosUsuals?.run(c.id) || false;
   if (/direction|navigat|route/.test(a)) { H.maps('dir', c.destination || c.query || text); return true; }
   if (/maps_search|map/.test(a)) { H.maps('search', c.query || text); return true; }
   if (a === 'quick_search') return H.search(c.query, c.tab);
   if (a === 'chats_filter' || a === 'chats_search') {
     const w = H.focused(); if (w?.app !== 'chats') return false;
     if (c.clear) H.chats.clearAll(w); else if (c.f) H.chats.addFilter(w, c.f); else H.chats.setQuery(w, c.q); return true;
   }
   if (a === 'open_view' || a === 'view' || a === 'show') {
     const v = c.view;
     if (window.WosFeatures.open(v, {date:c.date})) return true;
     if (window.WosSettings.route(v, H.settings)) return true;
     if (/inbox|notif/.test(v)) { H.inbox(); return true; }
     if (/apps|launcher/.test(v)) { H.launcher(''); return true; }
     return false;
   }
   if (/open|launch|app/.test(a)) { const app = H.findApp(c.app || c.target); return app ? !!H.openApp(app) : false; }
   return H.layout(c, text);
 }
 // These handlers finish synchronous shell navigation before returning. Music,
 // purchases, searches and app voice handoffs may only acknowledge acceptance.
 function completedLocally(c, ok) {
   return !!ok && !c?.then_agent && ['open_app','open','launch','app','open_view','view','show',
     'chats_filter','chats_search','desk','clear_desk','close_window','fullscreen','move_window'].includes(c?.action);
 }
 window.WosCommands = { create, execute, completedLocally, isMessageTake };
})();
