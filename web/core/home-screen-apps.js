/* Existing Apps surface + a bounded long-press action, not a new launcher. */
(() => {
  'use strict';
  let overlay = null, active = null, pending = false, requestSerial = 0;
  const responses = new Map();
  const port = () => window.wizardHomeScreenPort;
  function request(op, app, extra = {}) {
    if (!port()) return Promise.resolve({ status:'unsupported' });
    const requestId = String(++requestSerial);
    return new Promise(resolve => {
      const timer = setTimeout(() => { responses.delete(requestId); resolve({ status:'error' }); }, 8000);
      responses.set(requestId, value => { clearTimeout(timer); resolve(value); });
      try { port().postMessage(JSON.stringify({ op, requestId, appId:app.id, ...extra })); }
      catch (_) { clearTimeout(timer); responses.delete(requestId); resolve({ status:'error' }); }
    });
  }
  function bindPort() {
    if (!port()) return;
    port().onmessage = e => { try { const d = JSON.parse(e.data); const fn = responses.get(d.requestId); responses.delete(d.requestId); fn?.(d); } catch (_) {} };
  }
  bindPort();
  function close() { overlay?.remove(); overlay = null; active = null; pending = false; }
  function paint(status) {
    if (!overlay) return;
    const button = overlay.querySelector('button');
    const text = { ready:'Add to home screen', pending:'Adding…', pinned:'Already on home screen', confirmed:'Added to home screen', unsupported:"Can't add on this device", error:"Couldn't add. Try again" };
    button.textContent = text[status] || text.error; button.disabled = !['ready','error'].includes(status);
  }
  async function iconPNG(a, header) {
    const c = document.createElement('canvas'); c.width = c.height = 192;
    const ctx = c.getContext('2d'), sigil = window.WizSigil.of(a.sigil || a);
    ctx.fillStyle = '#110d1b'; ctx.fillRect(0,0,192,192);
    const glyph = header.querySelector('.sgi');
    const mask = glyph && getComputedStyle(glyph).getPropertyValue('--sg').trim();
    const match = mask?.match(/^url\(["']?(data:image\/svg\+xml[^"')]+)["']?\)$/);
    if (match) {
      const image = new Image(); image.src = match[1]; await image.decode();
      const tmp = document.createElement('canvas'); tmp.width = tmp.height = 192;
      const t = tmp.getContext('2d'); t.drawImage(image,32,32,128,128); t.globalCompositeOperation = 'source-in'; t.fillStyle = sigil.color; t.fillRect(0,0,192,192); ctx.drawImage(tmp,0,0);
    } else { ctx.fillStyle = sigil.color; ctx.font = 'bold 100px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(sigil.letter || a.name[0],96,100); }
    return c.toDataURL('image/png');
  }
  async function show(a) {
    close(); bindPort(); active = a;
    const name = window.WizHomeScreenPolicy.displayName(a);
    overlay = document.createElement('div'); overlay.className = 'home-pin-backdrop';
    const sheet = document.createElement('section'); sheet.className = 'home-pin-sheet'; sheet.setAttribute('role','dialog'); sheet.setAttribute('aria-label', name + ' home screen');
    const header = document.createElement('header'); header.innerHTML = window.WizSigil.box('span','',a);
    const title = document.createElement('span'); title.textContent = name; header.append(title);
    const button = document.createElement('button'); button.type = 'button'; button.disabled = true; button.textContent = 'Add to home screen';
    sheet.append(header, button); overlay.append(sheet); document.body.append(overlay);
    let freshPress = false, png = '';
    overlay.addEventListener('pointerdown', e => { freshPress = e.isTrusted; e.stopPropagation(); });
    overlay.addEventListener('pointercancel', () => { freshPress = false; });
    // Opening gesture's release/click can never activate the newly mounted action.
    overlay.addEventListener('click', e => {
      if (!freshPress && e.detail !== 0) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      freshPress = false;
      if (e.target === overlay && !pending) close();
    }, true);
    try { png = await iconPNG(a, header); } catch (_) { if (active === a) paint('error'); return; }
    if (active !== a) return;
    const response = await request('status', a);
    if (active !== a) return; paint(response.status);
    button.onclick = e => {
      if (!e.isTrusted || !navigator.userActivation?.isActive || pending || !png) return;
      pending = true; paint('pending');
      // No async work before postMessage: retain the tap's native user activation.
      request('pin',a,{ name, icon:png }).then(r => {
        if (active !== a) return;
        if (r.status !== 'pending') { pending = false; paint(r.status); }
      });
    };
  }
  function attach(menu, appFor) {
    let hold = null, timer = null, blockedUntil = 0;
    function cancel() { clearTimeout(timer); timer = null; hold = null; }
    const block = () => { blockedUntil = performance.now() + 700; };
    menu.addEventListener('pointerdown', e => {
      if (hold) { cancel(); block(); return; }
      if (!port()) return; // inert until the installed Android app provides the pin bridge (older APKs, browsers, desktop)
      const row = e.target.closest('[data-app]'), a = row && appFor(row.dataset.app);
      if (!e.isTrusted || !e.isPrimary || e.button !== 0 || !a || a.kind !== 'wizard' || !a.url || !window.WizHomeScreenPolicy.validId(a.id) || window.WizHomeScreenPolicy.isShell(a.url) || !window.WizHomeScreenPolicy.within(a.url,a.url)) return;
      hold = { id:e.pointerId, x:e.clientX, y:e.clientY, a };
      timer = setTimeout(() => { if (!hold || !row.isConnected || !menu.classList.contains('open')) { cancel(); return; } block(); try { navigator.vibrate?.(12); } catch (_) {} show(a); },450);
    }, true);
    document.addEventListener('pointerdown', e => { if (hold && e.pointerId !== hold.id) { cancel(); block(); } },true);
    menu.addEventListener('pointermove', e => { if (hold && e.pointerId === hold.id && Math.hypot(e.clientX-hold.x,e.clientY-hold.y) > 8) { cancel(); block(); } },true);
    menu.addEventListener('scroll', () => { if (hold) { cancel(); block(); } },true);
    document.addEventListener('pointerup', e => { if (hold && e.pointerId === hold.id) { if (overlay) { block(); e.preventDefault(); } cancel(); } },true);
    document.addEventListener('pointercancel', () => { if (hold) block(); cancel(); },true);
    menu.addEventListener('contextmenu', e => { if (overlay || hold) e.preventDefault(); },true);
    menu.addEventListener('click', e => { if (overlay || performance.now() < blockedUntil) { e.preventDefault(); e.stopImmediatePropagation(); } },true);
    document.addEventListener('visibilitychange', () => { if (hold) block(); cancel(); });
  }
  addEventListener('wos-native-resume', async () => {
    if (!pending || !active) return;
    const a = active, r = await request('status',a);
    if (active !== a) return;
    pending = false;
    if (r.status === 'pinned') { paint('confirmed'); setTimeout(() => { if (active === a) close(); },1200); }
    else close(); // OS cancellation is silent; dispatch isn't success.
  });
  window.WizHomeScreenApps = Object.freeze({ attach, back() { if (!overlay) return false; if (!pending) close(); return true; }, get state() { return { open:!!overlay, appId:active?.id || '', pending }; } });
})();
