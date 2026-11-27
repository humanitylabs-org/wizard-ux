/* Wizard UX skin host › where the view's orb goes, the inset sync and the shell API a layout receives. Moved verbatim out of core/skin-host.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The skin host (core/skin-host.js) calls
 * this once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names skin-host.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values skin-host.js changes over time (its reassigned lets, like the
 * layout record and the shell) stay in skin-host.js; this code reads and writes them as skinHostVars.<name>, its
 * get/set accessors on the same variables, so every read and write is live. Loaded just before core/skin-host.js.
 * The body below keeps skin-host.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.skinHostParts = window.WizCore.skinHostParts || {};
window.WizCore.skinHostParts.shellapi = function ({ appLogo, chatArchiveOrders, chatListOwners, chatsClaimed, emptyHomes, escapeSurfaces, frameSpots, guard, insetFrame, insetHolders, insetOrbs, insetPlaces, isDoc, openRoutes, panelSync, skinHostVars, storeApps }) {
  let activityRows, commandUis, homeScreenApp, inboxAct, keyGuides, keyHandlers, NOTE_ACTS, NOTE_ID, NOTE_ID_OPEN, noteAct, orbSwipeHolders, orbSwipeMap, orbTaps, overlays, panelHolders, readReadyOrder, readWorkingOrder, READY_ORDER_KEY, SESSION_ACTS, withNoteRows; // late-bound: skin-host.js declares these after the call, see bindLate
  /* Where the view's orb goes (round 6): the spot the app in front gave it (the end of its bottom row), else its own
   * fixed spot (null). The app in front = the widest app frame that is on screen (a desk still sliding in is not yet). */
  let placed = null;
  function placeSync() {
    if (!isDoc || !insetPlaces.size) return;
    let best = null, bw = 0;
    const vw = globalThis.innerWidth || 0;
    if (skinHostVars.frameInset) for (const f of document.querySelectorAll('.win iframe')) {
      const r = f.getBoundingClientRect(), w = f.closest('.win');
      if (!r.width || r.left < -8 || r.right > vw + 8 || !w || w.classList.contains('gone') || getComputedStyle(w).visibility === 'hidden') continue;
      if (r.width > bw) { best = f; bw = r.width; }
    }
    const fs = best ? frameSpots.get(best) || null : null, br = fs ? best.getBoundingClientRect() : null;
    const spot = fs ? { x: Math.round(br.left + fs.fx), y: Math.round(br.top + fs.fy), d: fs.d } : null;
    if (spot === placed || (spot && placed && spot.x === placed.x && spot.y === placed.y && spot.d === placed.d)) return; placed = spot;
    for (const fn of [...insetPlaces.values()]) { try { fn(spot); } catch (_) {} }
  }
  function insetSync() {
    skinHostVars.frameInset = Math.max(0, ...insetHolders.values());
    skinHostVars.frameOrb = [...insetOrbs.values()].pop() || null;
    if (isDoc) for (const f of document.querySelectorAll('.win iframe')) insetFrame(f);
    placeSync();
  }
  // an app fills its page after it loads: look again a little later (once its list is there)
  if (isDoc) document.addEventListener?.('load', e => { if (!skinHostVars.frameInset || e.target?.tagName !== 'IFRAME') return; const f = e.target; insetFrame(f); for (const ms of [1500, 5000]) setTimeout(() => { if (skinHostVars.frameInset) insetFrame(f); }, ms); }, true);
  // a turn of the phone moves the orb: lay the bars out around it again
  let insetResize = 0;
  if (isDoc) globalThis.addEventListener?.('resize', () => { if (!skinHostVars.frameInset || insetResize) return; insetResize = setTimeout(() => { insetResize = 0; if (skinHostVars.frameInset) insetSync(); }, 250); });
  function shellApi(a, base) {
    const live = () => !a.dead && !!skinHostVars.shell;
    return {
      // The orb's recorder plus a local command take (the held orb / ⌥C); call command() again to finish it.
      voice: Object.freeze({ ...base.voice, command: () => live() ? skinHostVars.shell.command?.() : undefined,
        // Layout-only: a layout-docked composer owns its mic even while a companion app has keyboard focus.
        reply: (wid, sid) => live() && typeof wid === 'string' && typeof sid === 'string' && sid && sid !== '__new__'
          ? skinHostVars.shell.recordReply?.(wid, sid) : false,
        /* Layout-only: the orb's own tap, for the shell's other orb triggers (Wizard for Mac's orb and Right ⌘, sent as
         * wizard:orb): the take goes where the layout's orb would send it, e.g. the thread whose message box holds it,
         * not the window with keyboard focus (wizard-ux issue 1547). fn() returns the shell's answer; undefined = not mine. */
        onTap(fn) {
          if (!live() || typeof fn !== 'function') return () => {};
          const g = guard(a, 'voice.onTap', fn); orbTaps.add(g);
          const off = () => { orbTaps.delete(g); a.offs.delete(off); }; a.offs.add(off); return off;
        },
        /* The layout draws the command take itself (its own orb state and caption): while held, a command take's
         * result comes to fn({ result: 'done' | 'miss' | 'silent' | 'kept', text, action, app, music }) instead of the
         * shell's toast, and the desktop's voice pill steps aside (html.voice-cmd). Released on teardown. */
        onCommand(fn) {
          if (!live() || typeof fn !== 'function') return () => {};
          const g = guard(a, 'voice.onCommand', fn); commandUis.add(g);
          const off = () => { commandUis.delete(g); a.offs.delete(off); }; a.offs.add(off); return off;
        },
        // Words sent on to the agent as a new chat (the launcher's own ask path), e.g. a command with no match.
        ask: text => live() && typeof text === 'string' && text.trim() ? !!skinHostVars.shell.askAgent?.(text.trim().slice(0, 4000)) : false,
      }),
      /* Keys: down(e) sees every key the desktop gets (app frames included) before its own bindings and returns true
       * when it used it; up(e) sees releases. hold: true = the layout draws its own hold-⌥ overlay (the shell's hold
       * chips stay off; ⌥/ still pins the guide). guide(fn, { only }): fn() → [{ el, key, word, at, frame?, app?, name?, free? }] chips the hold-⌥ guide adds (frame: el
       * sits in that same-origin app frame; app: the app's own ⌥ key (data-wz-key), named by the app; free: a spot the layout knows is
       * empty, drawn without the hit test). */
      keys: Object.freeze({
        on({ down, up, hold = false } = {}) {
          if (!live()) return () => {};
          const h = { a, hold: !!hold, down: typeof down === 'function' ? guard(a, 'keys.down', down) : null, up: typeof up === 'function' ? guard(a, 'keys.up', up) : null };
          keyHandlers.add(h); const off = () => { keyHandlers.delete(h); a.offs.delete(off); }; a.offs.add(off); return off;
        },
        // only: true = the hold-⌥ guide shows just this layout's chips (none of the desktop's own, no footer line)
        guide(fn, { only = false } = {}) {
          if (!live() || typeof fn !== 'function') return () => {};
          const g = guard(a, 'keys.guide', fn); g.only = only === true; keyGuides.add(g);
          const off = () => { keyGuides.delete(g); a.offs.delete(off); }; a.offs.add(off); return off;
        },
      }),
      sessions: Object.freeze({
        ownList() {
          if (!live() || !skinHostVars.shell.ownsChatList) return () => {};
          chatListOwners.add(a); skinHostVars.shell.ownsChatList(true);
          const off = () => { chatListOwners.delete(a); a.offs.delete(off); skinHostVars.shell.ownsChatList(chatsClaimed()); };
          a.offs.add(off); return off;
        },
        // Archive alone advances within the section the layout actually drew. Return its ordered
        // chat IDs for this row (empty = no neighbour), not a separately sorted session list.
        archiveOrder(fn) {
          if (!live() || typeof fn !== 'function') return () => {};
          chatArchiveOrders.set(a, guard(a, 'sessions.archiveOrder', fn));
          const off = () => { chatArchiveOrders.delete(a); a.offs.delete(off); };
          a.offs.add(off); return off;
        },
        // Ready also holds the notifications Chats shows (round 5, Miguel: the unified inbox's items, an app set to Chats
        // in Settings › Notifications included), as rows of their own (id 'notif:<id>', note: true) in Chats' own order:
        // the new ones among the chats by time, the snoozed ones (read) at the end; acted on through the inbox's handler.
        // (a focused agent's list carries no inbox notifications: they belong to All, as in Chats)
        // { activity: true } (Channels on, wizard-ux issue 1336): every agent's chats as Working, Ready, Recent (+ older:
        // how many more Show older adds; { older: true } lists them), Snoozed and Archive, in the one Activity sort;
        // unread notifications wait in Ready, read ones sit in Recent.
        list: opts => { if (opts?.activity === true && live() && skinHostVars.shell.activityList) return activityRows(skinHostVars.shell.activityList({ order: readReadyOrder(), older: opts.older === true }));
          const l = live() ? (opts?.focused === true && skinHostVars.shell.sessionListFocused ? skinHostVars.shell.sessionListFocused() : skinHostVars.shell.sessionList?.()) : null; if (!l) return null; const o = structuredClone(l); o.ready = opts?.focused === true && skinHostVars.shell.agentFocus?.().id ? (o.ready || []) : withNoteRows(o.ready || []); o.working = window.WizChatsListModel.workingSort(o.working, readWorkingOrder()); return o; },
        open: id => { if (!live() || typeof id !== 'string' || !id) return; if (id.startsWith(NOTE_ID)) inboxAct(NOTE_ID_OPEN, id.slice(NOTE_ID.length)); else skinHostVars.shell.openThread(id); },
        // The thread's own actions, through Chats' own paths (the same as its row sheet): Snooze, Done (archive), Mark
        // unread, Restore, Pin (the Pins toggle) and Rename (Chats' rename sheet). list() rows say which apply.
        act: (id, action) => !live() || typeof id !== 'string' || !id ? false
          : id.startsWith(NOTE_ID) ? NOTE_ACTS.includes(action) && noteAct(id, action)
          : SESSION_ACTS.includes(action) ? !!skinHostVars.shell.sessionAct?.(id, action) : false,
        openList: kind => { if (live() && (kind === 'working' || kind === 'ready')) skinHostVars.shell.openSessions?.(kind); },
        // Ready's order (the AI apps view, round 18): the stock Chats Filter's own saved choice (wos.chats.readyOrder.v1,
        // shared across devices through the box preferences, like Chats' own buttons), so both views always agree.
        workingOrder: () => readWorkingOrder(),
        setWorkingOrder: o => {
          return live() ? !!window.WizLive?.setWorkingOrder?.(o) : false;
        },
        order: () => readReadyOrder(),
        setOrder: o => {
          if (!live() || !['newest', 'oldest', 'priority'].includes(o)) return false;
          try { localStorage.setItem(READY_ORDER_KEY, o); } catch (_) {}
          try { window.WizLive?.putPrefs?.({ readyOrder: o }); } catch (_) {}
          window.dispatchEvent?.(new Event('wos:prefs')); return true;
        },
        // The Chats window as it is (its thread kept), and a New chat in it: the AI apps view's main screen.
        chats: () => live() ? !!skinHostVars.shell.showChats?.() : false,
        newChat: () => live() ? !!skinHostVars.shell.newChat?.() : false,
        /* Channels (wizard-ux issue 1256): Chats' own Channels pane for the main Chats window,
         * painted into node (one of this layout's mounted nodes): the Activity / Channels tabs, the channel list, a
         * channel's feed and its message box. Call it again to repaint; true while it shows anything (switch on). */
        channels: node => live() && node?.nodeType === 1 && [...a.mounts].some(m => m.contains(node)) ? !!skinHostVars.shell.chatChannels?.(node) : false,
        // Back from a channel's feed to the Channels list (thread → channel → list); false when no feed is open.
        channelBack: () => live() ? !!skinHostVars.shell.chatChannelBack?.() : false,
        /* A channel's feed in the layout's main chat column (wizard-ux issue 1256, James 11 Nov 2026: the channel list stays
         * in the sidebar): its header, filters, posts and message box painted into node (one of this layout's mounted
         * nodes). Returns the open channel ({ id, name }), or null with none open (the node is emptied). */
        channelFeed: node => live() && node?.nodeType === 1 && [...a.mounts].some(m => m.contains(node)) ? skinHostVars.shell.chatFeed?.(node) || null : null,
        // The channel whose feed is open in the main column ({ id, name }), or null.
        channelFeedOpen: () => live() ? skinHostVars.shell.chatFeedOpen?.() || null : null,
        // New chat with a channel's feed in front (wizard-ux issue 1291): its own box takes the post (true), never General.
        channelPost: () => live() ? !!skinHostVars.shell.chatChannelPost?.() : false,
        /* Kept for layouts built against it: always false now. + / ⌥N on the Channels list start a new chat; only the list's
         * own + New channel row makes a channel (wizard-ux issue 1489, which reverses the + part of issue 1308). */
        channelNew: () => false,
        // The Chats list's tab: 'activity' or 'channels' ('' with the switch off). It decides what + does (issue 1310).
        channelView: () => live() ? skinHostVars.shell.chatChannelView?.() || '' : '',
        /* The owner's Default Chats look (Settings › Chats, wizard-ux issue 1443): that
         * installed provider's list painted into node (one of this layout's mounted nodes), its taps opening threads in
         * the main chat. True while it owns the node; false (node emptied) for built-in Chats or a
         * failed provider, and the layout draws its own rows. 'wos:chats-view' asks for a repaint. */
        chatsView: node => live() && node?.nodeType === 1 && [...a.mounts].some(m => m.contains(node)) ? !!skinHostVars.shell.chatsView?.(node) : false,
      }),
      /* Workspaces: this Wizard first (the one on this screen), then the Wizards the owner manages (the devices registry,
       * the same list as the network map's switcher; not connected yet). refresh() reads the registry again. */
      workspaces: Object.freeze({
        list: () => {
          if (!live() || !isDoc) return [];
          const d = window.WosResources?.state?.devices || {}, txt = (v, n) => String(v || '').slice(0, n);
          const own = txt(d.this?.wizard, 60) || (window.WizConfig?.agent?.() || 'Wizard');
          return [Object.freeze({ id: 'this', name: own, org: '', current: true, owner: txt(window.WizConfig?.owner?.(), 60) }),
            ...(Array.isArray(d.managed) ? d.managed : []).filter(m => m && m.id).map(m => Object.freeze({ id: txt(m.id, 64), name: txt(m.name, 60) || txt(m.id, 60), org: txt(m.org, 60), ...(/^https?:\/\//i.test(m.url || '') ? { url: txt(m.url, 2048) } : {}), current: false }))];
        },
        refresh: () => { if (live()) try { window.WosResources?.sync?.(); } catch (_) {} },
      }),
      /* AI usage (read only): the feed's accounts as Settings › AI shows them, the default model's provider, and live(el)
       * to keep the feed polling while el is on screen (the AI apps view's fuel gauge, 4 Nov 2026). */
      aiUsage: Object.freeze({
        state: () => { if (!live()) return {}; const r = window.WosResources?.state || {}; return structuredClone({ ai: r.ai || null, aiError: r.aiError || '' }); },
        provider: () => live() ? String(window.WosModels?.defaultOption?.()?.provider || '') : '',
        live: el => { if (live() && el?.nodeType === 1) try { window.WosResources?.watch?.(el); } catch (_) {} },
      }),
      apps: Object.freeze({
        back: id => live() && typeof id === 'string' ? !!skinHostVars.shell.appBack?.(id) : false,
        list: () => { const l = live() ? skinHostVars.shell.apps?.() : null; return Array.isArray(l) ? structuredClone(l) : []; },
        open: id => live() && typeof id === 'string' && id ? !!skinHostVars.shell.openApp?.(id) : false,
        // Open it on a desk of its own (the Apps and Orb views' + sheet: one app per desk). The phone already gives a
        // new app its own desk; the desktop adapter starts a fresh desk for it (openAppDesk).
        // An installed app with no page yet (an app tile in kinds without a window, ux#1505) shows its settings sheet.
        openDesk: (id, place = null) => live() && typeof id === 'string' && id ? !!(skinHostVars.shell.openAppDesk ? skinHostVars.shell.openAppDesk(id, typeof place === 'function' ? place : null) : skinHostVars.shell.openApp?.(id))
          || !!skinHostVars.shell.openAnyApp?.(id, () => false) : false,
        // Add to home screen: the Desks' own hold on an app tile (core/home-screen-apps.js, its sheet and its checks), for a
        // layout's own app icons (the AI apps view's Home, round 7). can(id) says whether that app may be offered.
        homeScreen: Object.freeze({
          can: id => live() && !!homeScreenApp(id),
          offer: id => { const x = live() ? homeScreenApp(id) : null; return x ? !!window.WizHomeScreenApps.offer(x) : false; },
        }),
        // Close the app everywhere it is open (its desk goes; the Orb panel quits it). Chats always stays.
        close: id => live() && typeof id === 'string' && id && id !== 'wizard' ? !!skinHostVars.shell.closeApp?.(id) : false,
        /* Not installed yet: the App Store's Apps this Wizard lacks ([{ id, name, summary }], a Promise), and get(id),
         * which opens that app's page in the App Store window (its own Get; once installed it opens right away). */
        store: () => live() ? storeApps(skinHostVars.shell.apps?.()?.map(x => x.id) || []) : Promise.resolve([]),
        get: id => live() && typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ? !!skinHostVars.shell.openStore?.(id) : false,
        /* Room the layout's floating orb takes at the bottom of app windows (px); released on teardown. orb(), when given,
         * says where that orb is ({ x, y, d }: its centre and size, viewport px): an app's own bottom tab bar is then
         * laid out around it (the orb bar: tabs split left and right of the orb, on its row), else lifted above it. */
        /* place(spot), when given (round 6), is told where the app in front wants the orb: { x, y, d } (the end of its
         * bottom row of controls, viewport px, the orb's size there), or null = the orb's own fixed spot. */
        inset(px, orb = null, place = null) {
          if (!live()) return () => {};
          insetHolders.set(a, Math.max(0, Math.min(240, +px || 0)));
          if (typeof orb === 'function') insetOrbs.set(a, () => { const o = orb(); return o && [o.x, o.y, o.d].every(Number.isFinite) ? { x: +o.x, y: +o.y, d: +o.d } : null; }); else insetOrbs.delete(a);
          if (typeof place === 'function') { insetPlaces.set(a, guard(a, 'apps.inset place', place)); placed = undefined; } else insetPlaces.delete(a);
          insetSync();
          const off = () => { insetHolders.delete(a); insetOrbs.delete(a); insetPlaces.delete(a); a.offs.delete(off); insetSync(); }; a.offs.add(off); return off;
        },
        all: () => { if (live()) skinHostVars.shell.openPicker?.(); },
        /* One place for every open the shell starts by itself (the AI apps view, round 21: apps and links on the right,
         * chats an app starts on the left). While held, open(kind, detail, go) is asked first and returns true when it
         * placed it: 'app' { id, path } (a notification's Open, a launcher, a command, a chat's app button), 'link'
         * { url, title, app } (a link tapped in a reply; app = the installed app that owns it, else ''), 'draft'
         * { from } (an app's Reply on an item), 'thread' { sid, from } (an app opening a chat) and 'beside' { url } (the
         * view a reply binds beside its thread; true = none). go() runs the shell's own way for it; drafts and threads go
         * to the main Chats wherever it is. shows(desk) says whether the layout shows that desk's app on screen (an app's
         * Reply is admitted there). Released on teardown; nobody holding it = stock, byte for byte. */
        routeOpens({ open, shows } = {}) {
          if (!live() || typeof open !== 'function') return () => {};
          const h = { a, open: guard(a, 'apps.routeOpens', open), shows: typeof shows === 'function' ? guard(a, 'apps.routeOpens shows', shows) : null };
          openRoutes.add(h); const off = () => { openRoutes.delete(h); a.offs.delete(off); }; a.offs.add(off); return off;
        },
        // Take the open window of an installed app to one of its own pages (same origin, a path that app owns); false when
        // it has no window. And one link page (no app owns it) on a desk of its own, reused: the view's right panel.
        path: (id, path) => live() && typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && typeof path === 'string' && path ? !!skinHostVars.shell.showAppPath?.(id, path) : false,
        openLink: (url, title = '') => live() && typeof url === 'string' && url ? !!skinHostVars.shell.openLinkDesk?.(url, String(title || '').slice(0, 80)) : false,
        /* Every app by kind, as the launcher groups them (core/app-kinds.js): { apps, wiz (agent apps), agents, conns
         * (connectors), dev } of { id, name, icon, system }; null on a shell without kinds. openAny(id) opens any of them
         * like openDesk (an agent app with no screen shows its settings sheet). */
        kinds: () => { const k = live() ? skinHostVars.shell.appKinds?.() : null; return k ? structuredClone(k) : null; },
        openAny: id => live() && typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && skinHostVars.shell.openAnyApp
          ? !!skinHostVars.shell.openAnyApp(id, x => !!(skinHostVars.shell.openAppDesk ? skinHostVars.shell.openAppDesk(x) : skinHostVars.shell.openApp?.(x))) : false,
        // The shell's own search & launch (⌥Space / ⌘K), never a second search box.
        search: () => { if (live()) skinHostVars.shell.openPalette?.(); },
        // The app's own logo (the Store's read-only logo route), as a local URL; null when it has none.
        logo: id => live() ? appLogo(id) : Promise.resolve(null),
        /* The apps' count badges: the same counts the shell puts on desk marks and the dock (WizCore.workspaceNav:
         * Chats' unread threads, Notifications, and what each running app reports through WizardApp badge). Read-only
         * { id: n } (n > 0 only); watch(fn) is called again whenever one changes and is released on teardown. */
        // The badge text as the shell shows it ('50+' for an app that lists only its newest items); '' when none.
        badgeText: id => live() && isDoc ? String(window.WizCore?.workspaceNav?.label?.(String(id)) || '') : '',
        badges(watch) {
          const read = () => { const c = isDoc ? window.WizCore?.workspaceNav?.counts : null, o = {}; if (c) for (const [k, v] of Object.entries(c)) if (v > 0) o[k] = v | 0; return Object.freeze(o); };
          if (live() && typeof watch === 'function' && isDoc) {
            const g = guard(a, 'badges', watch), h = () => { if (live()) g(read()); };
            window.addEventListener('wizard:app-counts', h);
            const off = () => { window.removeEventListener('wizard:app-counts', h); a.offs.delete(off); }; a.offs.add(off);
          }
          return live() ? read() : Object.freeze({});
        },
      }),
      desk: Object.freeze({
        home: () => { if (live()) skinHostVars.shell.home?.(); },
        look: () => { if (live()) skinHostVars.shell.openSettings?.('look'); },
        // Settings (a page id such as 'network', or its first page).
        settings: page => { if (live()) skinHostVars.shell.openSettings?.(typeof page === 'string' && /^[a-z-]{1,24}$/.test(page) ? page : undefined); },
        /* What the Settings cog carries (WosBell.attention, the same count as the phone's gear and the desktop's cog):
         * read-only { n, label } or null; watch(fn) is called again when it changes and is released on teardown. */
        attention(watch) {
          const read = () => { const at = isDoc ? window.WosBell?.attention?.() : null, n = Math.max(0, Math.min(999, Number(at?.n) | 0)); return n ? Object.freeze({ n, label: String(at.label || '') }) : null; };
          if (live() && typeof watch === 'function' && isDoc) {
            const g = guard(a, 'attention', watch), h = () => { if (live()) g(read()); };
            window.addEventListener('wizard:notify-attention', h);
            const off = () => { window.removeEventListener('wizard:notify-attention', h); a.offs.delete(off); }; a.offs.add(off);
          }
          return live() ? read() : null;
        },
        /* Back to the Desks view for this device: switches off the tweak wearing this layout, the same way as its
         * Settings › Look switch (WosExperience mix, no reload), so the layout itself always offers a way back. */
        classic: () => { if (live() && skinHostVars.layoutHolder && skinHostVars.layoutRec === a) return Promise.resolve(window.WosExperience?.toggle?.(skinHostVars.layoutHolder)).then(() => true, () => false); return Promise.resolve(false); },
        // Closing the last window of a desk goes Home instead of to another desk (desks are out of sight). Released on teardown.
        emptyHome() { if (!live()) return () => {}; emptyHomes.add(a); const off = () => { emptyHomes.delete(a); a.offs.delete(off); }; a.offs.add(off); return off; },
        /* The layout's own group in Settings › Chats & app screens (the AI apps view's order inside each group, round
         * 19): a live node of its own, put back after every Settings render, released on teardown. */
        setting(id, node) {
          if (!live() || !isDoc || typeof id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(id) || !node || typeof node.append !== 'function') return () => {};
          const W = window.WosSettings; if (!W?.register) return () => {};
          let off0 = () => {};
          try { off0 = W.register({ id: 'layout-' + id, page: 'chats', html: () => '<div class="st-tweak" data-st-tweak></div>',
            painted: (ctx, box) => { const slot = box?.firstElementChild; if (slot && node.parentNode !== slot) slot.append(node); },
            deferRefresh: () => !!node.contains?.(document.activeElement) }); } catch (_) { return () => {}; }
          let done = false; const off = () => { if (done) return; done = true; off0(); node.remove?.(); a.offs.delete(off); }; a.offs.add(off); return off;
        },
      }),
      /* No desks: while a layout holds the panel, whatever opens shows in a panel over Home instead of on a desk
       * (desktop.js, outside the desks: never tiled, never synced): a Chats window in the chat panel, anything else in
       * the app panel on the right; each holds one thing at a time (back() reopens the one before) and both can be open.
       * The desks underneath stay exactly as they were, and release (or teardown) gives them back. state() → { kind,
       * title, width, back, list: { width }, chat: { kind, left, right }, app: { id, title, left, right } } or null.
       * dock(true) keeps the stock Chats list docked in its own panel on the LEFT for good; a thread picked in it opens
       * in a column beside it, which closes when the thread is finished. dock(false) folds the list away. */
      panel: Object.freeze({
        claim() {
          if (!live()) return () => {};
          panelHolders.add(a); panelSync();
          const off = () => { panelHolders.delete(a); a.offs.delete(off); panelSync(); }; a.offs.add(off); return off;
        },
        // close() the panel in front; close('chat') the chat column; close('app') the app panel (hidden if parked).
        close: kind => !live() ? false : kind === 'chat' || kind === 'app' ? !!skinHostVars.shell.panelCloseKind?.(kind) : !!skinHostVars.shell.panelClose?.(),
        /* park(true): an app's panel only hides when closed (its frame stays alive, e.g. music keeps playing) and
         * opening that app again brings it back as it was; quit(id) really closes it; running() → [{ id, open,
         * playing }] (the app shown and the ones kept out of sight). */
        park: on => live() && panelHolders.has(a) ? !!skinHostVars.shell.panelPark?.(!!on) : false,
        quit: id => live() && typeof id === 'string' && id ? !!skinHostVars.shell.panelQuit?.(id) : false,
        running: () => { const l = live() ? skinHostVars.shell.panelRunning?.() : null; return Array.isArray(l) ? l.map(r => Object.freeze({ id: String(r.id), open: !!r.open, playing: !!r.playing })) : []; },
        dock: on => live() && panelHolders.has(a) ? !!skinHostVars.shell.panelDock?.(!!on) : false,
        back: () => live() ? !!skinHostVars.shell.panelBack?.() : false,
        state: () => { const s = live() ? skinHostVars.shell.panelState?.() : null; if (!s) return null; const o = { ...s }; for (const k of ['list', 'chat', 'app']) if (o[k]) o[k] = Object.freeze({ ...o[k] }); return Object.freeze(o); },
      }),
      /* Phone only (null elsewhere): the Home desk's section, where a layout's Home scene goes (it slides with the
       * desks), and the dock orb's box, where a layout drawing the dock orb puts its canvas (the stock gestures stay on
       * it: a layout may hand it a press with dispatchEvent). The layout removes what it put there on teardown. */
      phone: Object.freeze({
        home: () => live() ? skinHostVars.shell.homeHost?.() || null : null,
        orb: () => live() ? skinHostVars.shell.orbHost?.() || null : null,
        // The shared Chats surfaces of the phone's Chats windows (WizChatsHost: composer, notification, parts), so a
        // layout reaches them without the shell's window markup.
        chats: () => { const l = live() ? skinHostVars.shell.chatsSurfaces?.() : null; return Object.freeze(Array.isArray(l) ? l.filter(Boolean) : []); },
        // The desks in order, one app each: [{ desk, id, name }] (Home and empty desks left out). nav.goDesk(desk) opens one.
        desks: () => { const l = live() ? skinHostVars.shell.phoneDesks?.() : null; return Array.isArray(l) ? l.map(d => Object.freeze({ desk: d.desk | 0, id: String(d.id || ''), name: String(d.name || '') })) : []; },
        // An app's mark as the dock draws it (logo or sigil, colour; 'wizard' = Chats), as a fresh element the layout
        // may place; null when the app is unknown.
        mark: id => {
          const h = live() && typeof id === 'string' && id ? skinHostVars.shell.phoneMark?.(id) : '';
          if (!h || !isDoc) return null;
          const t = document.createElement('template'); t.innerHTML = h; return t.content.firstElementChild || null;
        },
        /* The dock orb's swipes while this layout is worn: { up, side, down }, each 'stock' (or left out) = the dock's
         * own, null = nothing; up may be 'home' (go Home) or 'new' (a New chat, typing). Tap and hold are always the stock ones. Desks (no layout)
         * declares nothing, so every stock swipe stays. Released on teardown. */
        swipes(map) {
          if (!live() || !map || typeof map !== 'object') return () => {};
          const m = orbSwipeMap(map); orbSwipeHolders.set(a, m);
          const off = () => { if (orbSwipeHolders.get(a) === m) orbSwipeHolders.delete(a); a.offs.delete(off); }; a.offs.add(off); return off;
        },
      }),
      /* The desks in order, one app each, on either shell: [{ desk, id, name }] (Home and empty desks left out; a Chats
       * desk is id 'wizard'). nav.goDesk(desk) opens one. The Apps view's grid (phone: phoneDesks, desktop: deskApps). */
      desks: Object.freeze({
        list: () => { const l = live() ? (skinHostVars.shell.deskApps || skinHostVars.shell.phoneDesks)?.() : null; return Array.isArray(l) ? l.map(d => Object.freeze({ desk: d.desk | 0, id: String(d.id || ''), name: String(d.name || '') })) : []; },
        // close one desk as the stock ✕ does (the AI apps view's tab ✕; desktop only)
        close: desk => live() && Number.isInteger(desk) && desk >= 0 ? !!skinHostVars.shell.closeDesk?.(desk) : false,
        // move one desk as the stock arrange does (take out at from, put in at to; the AI apps view's drag; desktop only)
        move: (from, to) => live() && Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= 0 ? !!skinHostVars.shell.moveDesk?.(from, to) : false,
      }),
      // The layout's own overlay (e.g. a popover) joins the shell's Back order (desktop Esc), newest first.
      back: Object.freeze({
        surface(back) {
          if (!live() || typeof back !== 'function') return () => {};
          const h = { a, back: guard(a, 'escape.surface', back) }; escapeSurfaces.add(h);
          const off = () => { escapeSurfaces.delete(h); a.offs.delete(off); }; a.offs.add(off); return off;
        },
        push(close) {
        if (a.dead || typeof close !== 'function') return () => {};
        const done = guard(a, 'back', close);
        const entry = { a, close: () => { off(); return done(); } }; overlays.push(entry);
        const offEscape = skinHostVars.shell?.escapeOverlay?.(entry.close);
        const off = () => { offEscape?.(); const i = overlays.indexOf(entry); if (i >= 0) overlays.splice(i, 1); a.offs.delete(off); };
        a.offs.add(off); return off;
      } }),
    };
  }
  return { insetSync, placeSync, shellApi, bindLate: v => { if ('activityRows' in v) activityRows = v.activityRows; if ('commandUis' in v) commandUis = v.commandUis; if ('homeScreenApp' in v) homeScreenApp = v.homeScreenApp; if ('inboxAct' in v) inboxAct = v.inboxAct; if ('keyGuides' in v) keyGuides = v.keyGuides; if ('keyHandlers' in v) keyHandlers = v.keyHandlers; if ('NOTE_ACTS' in v) NOTE_ACTS = v.NOTE_ACTS; if ('NOTE_ID' in v) NOTE_ID = v.NOTE_ID; if ('NOTE_ID_OPEN' in v) NOTE_ID_OPEN = v.NOTE_ID_OPEN; if ('noteAct' in v) noteAct = v.noteAct; if ('orbSwipeHolders' in v) orbSwipeHolders = v.orbSwipeHolders; if ('orbSwipeMap' in v) orbSwipeMap = v.orbSwipeMap; if ('orbTaps' in v) orbTaps = v.orbTaps; if ('overlays' in v) overlays = v.overlays; if ('panelHolders' in v) panelHolders = v.panelHolders; if ('readReadyOrder' in v) readReadyOrder = v.readReadyOrder; if ('readWorkingOrder' in v) readWorkingOrder = v.readWorkingOrder; if ('READY_ORDER_KEY' in v) READY_ORDER_KEY = v.READY_ORDER_KEY; if ('SESSION_ACTS' in v) SESSION_ACTS = v.SESSION_ACTS; if ('withNoteRows' in v) withNoteRows = v.withNoteRows; } };
};
