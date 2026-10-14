/* Wizard UX core: linked desks for the Video Editor app.
 *
 * Opening a clip in the Video Editor opens that clip's Feedback view (the same app at ?pane=feedback)
 * right beside it. Phone: the order is Chats → Video → Feedback desks, swipe between them; Add note
 * brings Feedback forward. Desktop: Video and Feedback tile on one desktop with Feedback narrower
 * (W[id].share; Chats | Video | Feedback columns). Leaving the clip closes its Feedback view. Both views ask through postMessage; this
 * module checks the sender by its real frame and only accepts the two Video Editor windows.
 *
 * Messages from the app:  {type:'video-editor:desk', action:'context'|'open-video'|'time', hash, …}
 * Messages to the app:    {type:'video-editor:bound', hash, time, focusComposer}
 */
(() => {
  'use strict';
  const APP = 'video-editor', PEER = 'video-editor-feedback', SHARE = 0.26, VIDEO_SHARE = 0.46;
  let videoId = null, feedbackId = null, binding = null;
  const shell = () => window.__wos || window.__wux;
  const phone = () => !!window.__wos;
  const frame = id => document.querySelector(`.win[data-win="${id}"] iframe`);
  const deskOf = id => { const s = shell(); const list = phone() ? s.desks : s.ws; return list.findIndex(d => d.wins.includes(id)); };
  const HASH = /^#\/(?:project\/[a-z0-9-]+(?:\/clip\/[a-z0-9-]+(?:\/draft\/v\d+)?)?)?$/;
  function focus(id) { const s = shell(); if (!s?.wins[id]) return; if (phone()) s.goDesk(deskOf(id), true); s.focusWin(id); }
  function deliver(id, b, composer = false) {
    const f = frame(id); if (!f) return;
    const send = () => f.contentWindow?.postMessage({ type: 'video-editor:bound', hash: b.hash, time: b.time, focusComposer: composer }, location.origin);
    send();
    if (!f.__videoBound) { f.__videoBound = true; f.addEventListener('load', () => { if (binding && id === feedbackId) deliver(id, binding); }); }
  }
  function closePeer() { const s = shell(); if (videoId && s.wins[videoId]) delete s.wins[videoId].share; if (feedbackId && s.wins[feedbackId]) s.closeWin(feedbackId, true); feedbackId = null; binding = null; }
  function attach(b, source) {
    const s = shell(); if (!s) return;
    if (videoId && videoId !== source && feedbackId) closePeer();
    videoId = source;
    if (!b.clip) return closePeer();
    binding = b;
    if (!feedbackId || !s.wins[feedbackId]) {
      const url = '/video-editor/?pane=feedback' + b.hash, title = (b.title || 'Clip') + ' · Feedback';
      if (phone()) {
        const here = s.desks[s.idx]?.id, vi = deskOf(videoId), vid = s.desks[vi]?.id;
        s.goDesk(vi, true);
        const peer = s.openWin({ app: 'frame', appId: PEER, servicesAs: APP, url, title, videoOwner: videoId, from: { desk: vid, win: videoId, title: 'Video Editor' } }, { stay: true });
        if (!peer) return; feedbackId = peer.id;
        const chat = s.desks.find(d => d.wins.some(id => s.wins[id]?.app === 'chats'));
        const video = s.desks.find(d => d.wins.includes(videoId)), fb = s.desks.find(d => d.wins.includes(feedbackId));
        if (chat && video && fb && chat !== video && video !== fb) s.reorderDesks([chat.id, video.id, fb.id, ...s.desks.filter(d => !d.home && ![chat.id, video.id, fb.id].includes(d.id)).map(d => d.id)]);
        const back = s.desks.findIndex(d => d.id === here); if (back >= 0) s.goDesk(back, true);
      } else {
        const before = s.ws[s.cur]?.focus;
        // Chats | Video | Feedback as columns: video gets the most room, Feedback the narrowest column.
        if (s.wins[videoId]) s.wins[videoId].share = VIDEO_SHARE;
        const peer = s.newWin({ app: 'frame', appId: PEER, servicesAs: APP, url, title, videoOwner: videoId, share: SHARE }, { ws: deskOf(videoId) });
        if (!peer) return; feedbackId = peer.id;
        if (before && s.wins[before]) s.focusWin(before);
      }
    }
    deliver(feedbackId, b, !!b.focus);
    if (b.focus) { focus(feedbackId); setTimeout(() => deliver(feedbackId, b, true), 80); }
  }
  addEventListener('message', e => {
    if (e.origin !== location.origin || e.data?.type !== 'video-editor:desk') return;
    const s = shell(); if (!s) return;
    const f = [...document.querySelectorAll('.win iframe')].find(x => x.contentWindow === e.source);
    const id = f?.closest('.win')?.dataset.win, w = id && s.wins[id];
    if (!w || ![APP, PEER].includes(w.appId)) return;
    const d = e.data; if (typeof d.hash !== 'string' || !HASH.test(d.hash)) return;
    const time = Number.isFinite(d.time) ? Math.max(0, d.time) : 0;
    if (d.action === 'context' && w.appId === APP) {
      if (d.clip && (!/^[a-z0-9-]{1,80}$/.test(d.project) || !/^[a-z0-9-]{1,80}$/.test(d.clip) || !/^v\d{1,4}$/.test(d.draft))) return;
      attach({ project: d.project, clip: d.clip, draft: d.draft, title: String(d.title || '').slice(0, 80), hash: d.hash, time, focus: !!d.focus }, id);
    } else if (d.action === 'time' && w.appId === APP && binding && id === videoId) {
      binding.time = time;
    } else if (d.action === 'open-video' && w.appId === PEER) {
      if (videoId && s.wins[videoId]) { focus(videoId); deliver(videoId, { hash: d.hash, time }); }
      else s.closeWin(id, true);
    }
  });
  // Closing the video window takes its Feedback view with it.
  setInterval(() => { const s = shell(); if (!s || !feedbackId) return; if (!videoId || !s.wins[videoId]) closePeer(); }, 1500);
  window.WizVideoDesks = { get video() { return videoId; }, get feedback() { return feedbackId; }, get binding() { return binding; } };
})();
