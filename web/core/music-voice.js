/* Music by voice (James, 10 Oct 2026: "I need to be able to voice command music with the long press").
 *
 * A held orb (and, for unmistakable phrases, a tap) drives Wizard Music: "play music guy barato trap",
 * "pause", "next song", "turn it up", "I like this", "what's playing". Parsing is on the phone, with no
 * router round trip; the Wizard Music window does the work (its hub fixes misheard names, so
 * "Guy Barato Trap" plays Gui Boratto's "Trap").
 *
 * Protocol with the framed app (same origin, src/music/voice.ts in ~/apps/wizard-music):
 *   shell → app  {type:'wizard-os:music', id, cmd}
 *   app → shell  {type:'wizard-os:music:ack', id}            on receipt (the shell resends until then)
 *   app → shell  {type:'wizard-os:music:done', id, ok, text} when it has acted ("Playing Trap · Gui Boratto")
 * The grammar here is the same as parseMusicCommand() in the app; keep the two in step. */
(() => {
  'use strict';
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9ก-๙ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const MUSIC = '(?: the)?(?: music| song| track| tune| playback| it| this)?';
  const MUSIC_WORD = /\b(music|song|songs|track|tune|tunes|playlist|radio|spotify)\b/;
  // Search shows the results list in Wizard Music; it never plays the first hit (James, 12 Oct 2026).
  // The spell, said anywhere: "music search Home Tides" (also "search music for …", "search … in music",
  // "open music and search for …"). Plain "search for X" is the player's only with Wizard Music in front.
  const FIND = '(?:search|find|look up|look for)(?: for)?(?: me)?';
  const SPELL = [
    new RegExp(`^(?:open )?(?:wizard )?music(?: and| then)? ${FIND} (.+)$`),
    new RegExp(`^(?:search|find|look up|look for) (?:wizard |my )?music(?: for)? (.+)$`),
    new RegExp(`^${FIND} (.+?) (?:in|on) (?:wizard |my )?music$`),
  ];
  const PLAIN_FIND = new RegExp(`^${FIND} (.+)$`);
  /** The words as said (case kept) for the query the normalised grammar found. */
  const asSaid = (text, found) => {
    const words = found.split(' ').filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const m = words.length ? String(text).match(new RegExp(words.join('[^a-z0-9ก-๙]+'), 'i')) : null;
    return m ? m[0] : found;
  };

  /** -> {op, ...} | null. `strong` marks a phrase that can only mean music (safe on a tap).
   * inMusic: a held take with Wizard Music in front (anything is for the player). front: Music is in front. */
  function parse(text, inMusic, front) {
    const s = norm(window.WizConfig.stripAddress(text)).replace(/ (?:please|for me|now)$/, '').replace(/^(?:(?:can|could|would|will) you |please |maybe |just |go ahead and )+/, '');
    if (!s) return null;
    for (const rx of SPELL) { const q = s.match(rx); if (q) return { op: 'search', query: asSaid(text, q[1]), strong: true }; }
    { const q = (inMusic || front) ? s.match(PLAIN_FIND) : null; if (q) return { op: 'search', query: asSaid(text, q[1]), strong: true }; }
    const strong = MUSIC_WORD.test(s);
    const c = cmd => ({ ...cmd, strong: strong || cmd.strong || false });
    if (new RegExp(`^(?:pause|stop|hold)${MUSIC}$|^(?:shut up|silence)$`).test(s)) return c({ op: 'pause' });
    if (new RegExp(`^(?:resume|unpause|continue|keep playing|play again)${MUSIC}$|^play$`).test(s)) return c({ op: 'resume' });
    if (/^(?:next|skip)(?: song| track| one| this(?: song| track| one)?| it| that)?$|^(?:play )?(?:the )?next (?:song|track|one)$/.test(s)) return c({ op: 'next' });
    if (/^(?:previous|last)(?: song| track| one)$|^previous$|^go back a (?:song|track)$|^play (?:the )?(?:previous|last) (?:song|track|one)$/.test(s)) return c({ op: 'previous' });
    if (/^(?:turn (?:it|this|the (?:music|volume|sound)) up|turn up(?: the (?:music|volume|sound))?|volume up|louder|(?:a bit |a little |make it |little )louder|crank it(?: up)?|raise the volume|more volume|pump it up)$/.test(s)) return c({ op: 'volume', dir: 'up' });
    if (/^(?:turn (?:it|this|the (?:music|volume|sound)) down|turn down(?: the (?:music|volume|sound))?|volume down|quieter|softer|(?:a bit |a little |make it |little )(?:quieter|softer)|lower the volume|less volume)$/.test(s)) return c({ op: 'volume', dir: 'down' });
    if (new RegExp(`^mute${MUSIC}$`).test(s)) return c({ op: 'volume', dir: 'mute' });
    if (new RegExp(`^unmute${MUSIC}$`).test(s)) return c({ op: 'volume', dir: 'unmute' });
    let m = s.match(/^(?:set )?(?:the )?volume (?:to |at )?(\d{1,3})(?: percent)?$/);
    if (m) return c({ op: 'volume', dir: 'set', level: Math.min(100, +m[1]) / 100, strong: true });
    if (/^(?:i (?:really )?(?:like|love) (?:this|it|that)(?: song| track| one)?|(?:like|love) (?:this|it)(?: song| track)?|thumbs up|save (?:this|it)(?: song| track)?|more like this)$/.test(s)) return c({ op: 'like' });
    if (/^(?:i (?:don t|do not|dont) (?:like|want) (?:this|it|that)(?: song| track| one)?|thumbs down|dislike(?: this| it)?(?: song| track)?|i hate (?:this|it)(?: song| track)?|not this(?: song| one)?|no more of this|less like this)$/.test(s)) return c({ op: 'dislike' });
    if (/^(?:what s|what is|whats) (?:this|playing|this song|the song|this track)$|^what song is (?:this|playing)$|^who (?:is|s) (?:this|singing|playing)$/.test(s)) return c({ op: 'what' });
    m = s.match(/^(?:play|put on|throw on|queue up|shuffle|blast|spin|listen to|i want to (?:hear|listen to)|i wanna (?:hear|listen to)|let s (?:hear|listen to))\b\s*(.*)$/);
    if (m) return c({ op: 'play', said: String(text).trim() });
    if (inMusic) return c({ op: 'play', said: String(text).trim() });
    return null;
  }

  let host = null; // { findWin, openMusic, toast, frameOf }
  let seq = 0;
  const pending = new Map(); // id -> { win, cmd, timer, acked, t0 }
  const log = e => { window.__musicLog = (window.__musicLog || []).concat(e).slice(-40); };

  function post(id) {
    const p = pending.get(id); if (!p || p.acked) return;
    const f = host.frameOf(p.win);
    try { if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'wizard-os:music', id, cmd: p.cmd }, location.origin); } catch (e) {}
    if (performance.now() - p.t0 > 20000) { pending.delete(id); log('timeout:' + p.cmd.op); host.toast('♫', 'Wizard Music didn’t answer · open it and try again', 3200); return; }
    p.timer = setTimeout(() => post(id), 400);
  }
  function send(win, cmd) {
    const id = 'm' + Date.now().toString(36) + (++seq);
    const clean = { ...cmd }; delete clean.strong;
    pending.set(id, { win, cmd: clean, acked: false, t0: performance.now(), timer: 0 });
    log('send:' + clean.op);
    post(id);
    return id;
  }
  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d || typeof d !== 'object' || ev.origin !== location.origin || typeof d.type !== 'string' || !d.type.startsWith('wizard-os:music:')) return;
    const p = d.id ? pending.get(d.id) : null;
    if (d.type === 'wizard-os:music:ack' && p) { p.acked = true; clearTimeout(p.timer); log('ack:' + p.cmd.op); return; }
    if (d.type === 'wizard-os:music:done') {
      if (p) { clearTimeout(p.timer); pending.delete(d.id); }
      log((d.ok ? 'done:' : 'fail:') + (d.text || ''));
      if (d.text) host.toast(d.ok ? '♫' : '♪', String(d.text).replace(/[<>&]/g, ''), d.ok ? 2400 : 3400);
    }
  });

  /** Run a parsed command. True when it was taken (the outcome arrives as a toast). */
  function run(cmd) {
    if (!host) return false;
    let win = host.findWin();
    if (!win) {
      // Nothing to control without the player; "play …", "music search …" (and resume) open Wizard Music on this desk.
      if (cmd.op !== 'play' && cmd.op !== 'resume' && cmd.op !== 'search') { host.toast('♪', 'Nothing is playing · say “play …” to start', 2600); return true; }
      win = host.openMusic();
      if (!win) return false;
    }
    if (cmd.op === 'search') host.toast('♫', `Searching music for “${String(cmd.query).replace(/[<>&]/g, '')}”…`, 4000);
    if (cmd.op === 'play') {
      const what = String(cmd.said || '').replace(/^\s*(?:play|put on)\s+/i, '').replace(/[.!?]+$/, '');
      host.toast('♫', what && !/^(?:some |the )?music$/i.test(what) ? `Finding “${what.replace(/[<>&]/g, '')}”…` : 'Starting your music…', 4000);
    }
    send(win, cmd);
    return true;
  }

  window.WosMusic = {
    parse, run,
    install(h) { host = h; },
    available: () => !!(host && host.app()),
    pending: () => pending.size,
  };
})();
