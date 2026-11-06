/* Wizard Motion Kit demo wiring (external: the private gateway CSP forbids inline scripts). */
  const M = WizardMotion, $ = s => document.querySelector(s);
  const orbEl = $('#orb'), orbXY = () => { const r = orbEl.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const words = M.words($('#words'), { anchor: orbXY }), orb = M.orb(orbEl), card = M.card($('#card'), $('#layer'));
  const moons = M.moons(orbEl), hint = M.hint($('#hint'));
  let list = [], live = true, zoom = 0;
  orb.set('live'); hint.show('tap a button · spread two fingers for the list');
  const sign = M.signRing($('#print'), $('#ring'), { enabled: () => card.open, onSign: via => {
    M.chime('sent'); card.send(); list.unshift({ id: Date.now(), title: 'Sent', state: 'working' }); moons.set(list); hint.show(`signed by ${via} · it became a moon`, 'sent', 2500, true);
  } });
  const W = ['…the sigils…', '…pinch to zoom…', '…desk dots…', '…meet you wherever you are…'];
  setInterval(() => live && words.add(W[Math.floor(Math.random() * W.length)]), 2300);
  const act = {
    word: () => words.add(W[Math.floor(Math.random() * W.length)]),
    notice: () => { words.hot('…send Miguel the sigil board…'); setTimeout(() => { words.gather(); orb.notice(); }, 1400);
      setTimeout(() => { sign.reset(); card.rise(); M.chime('notice'); M.haptic('notice'); hint.show('touch the print to send', 'card', 0, true); }, 2400); },
    moon: () => { list.unshift({ id: Date.now(), state: ['working', 'needs', 'failed'][list.length % 3] }); moons.set(list); },
    done: () => { list = list.map(m => ({ ...m, state: 'done' })); moons.set(list); },
    zoom: () => { zoom = zoom ? 0 : 1; $('#zoom').classList.toggle('on', !!zoom); $('#zoom').classList.remove('deep'); },
    live: () => { live = !live; orb.set(live ? 'live' : ''); $('#pill').classList.toggle('paused', !live); },
  };
  document.querySelector('.controls').addEventListener('click', e => { const a = e.target.dataset.a; if (a) { M.haptic('tick'); act[a](); } });
  $('#dismiss').addEventListener('click', () => { card.sink(); hint.clear(); });
  M.spread(window, { onOut: () => { zoom = Math.min(2, zoom + 1); $('#zoom').classList.add('on'); $('#zoom').classList.toggle('deep', zoom > 1); M.chime('open'); },
    onIn: () => { zoom = Math.max(0, zoom - 1); $('#zoom').classList.toggle('on', zoom > 0); $('#zoom').classList.toggle('deep', zoom > 1); } });
  window.__demo = { words, card, moons, sign, get zoom() { return zoom; }, list: () => list };
