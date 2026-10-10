/* Wizard ID in the Wizard OS shell (spec: wizard-os/spec/WIZARD_ID.md).
 *
 * The key lives in the Android app (window.wizardIdentityPort, shell main frame only). This module only asks:
 *   WosIdentity.status()            → {exists, npub, name, backedUp, …} | null without the native app
 *   WosIdentity.setup()             → opens create / bring / manage; publishes the new profile when there is one
 *   WosIdentity.sign(event)         → {event: signed} after the owner approves on the sheet; rejects 'denied' etc.
 *   WosIdentity.settingsHtml()      → the Settings row (state painted from the last status)
 * There is no way to read the private key from here.
 */
(() => {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pending = new Map();
  let seq = 0, listening = false, last = null;
  const subs = new Set();

  const port = () => window.wizardIdentityPort && typeof window.wizardIdentityPort.postMessage === 'function' ? window.wizardIdentityPort : null;

  function onNative(ev) {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m) return;
    if (m.type === 'changed') { status().then(() => subs.forEach(f => { try { f(last); } catch (e) {} })); return; }
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id);
    m.ok ? p.resolve(m.result) : p.reject(Object.assign(new Error(m.error || 'failed'), { code: m.error || 'failed' }));
  }

  function call(method, params) {
    const pt = port();
    if (!pt) return Promise.reject(Object.assign(new Error('no-bridge'), { code: 'no-bridge' }));
    if (!listening) { listening = true; if (typeof pt.addEventListener === 'function') pt.addEventListener('message', onNative); else pt.onmessage = onNative; }
    const id = 'i' + (++seq);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      pt.postMessage(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  async function status() {
    if (!port()) { last = null; return null; }
    try { last = await call('status'); } catch (e) { last = null; }
    return last;
  }

  async function publish(event) {
    const r = await fetch('api/identity/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'publish failed');
    return j;
  }

  async function setup() {
    const r = await call('setup');
    last = r && typeof r.exists === 'boolean' ? r : await status();
    // A new Wizard ID comes back with its first profile already signed: put the name out where people look.
    for (const ev of (r && r.signed) || []) { try { await publish(ev); } catch (e) { console.warn('[wizard-id] profile publish', e); } }
    subs.forEach(f => { try { f(last); } catch (e) {} });
    return last;
  }

  const sign = event => call('sign', { event });

  function settingsHtml() {
    if (!port()) return '';
    const s = last;
    const title = s?.exists ? (s.name || 'Wizard ID') : 'Wizard ID';
    const sub = !s ? 'Checking…' : !s.exists ? 'Create your identity · sign apps and posts as you'
      : `${s.npub.slice(0, 10)}…${s.npub.slice(-6)} · ${s.backedUp ? 'Backed up' : 'Not backed up'}`;
    return `<button class="st-row${s?.exists && !s.backedUp ? ' st-warn' : ''}" data-st="wizard-id"><span class="st-ic">✶</span><span class="st-tx"><b>${esc(title)}</b><small>${esc(sub)}</small></span><span class="st-go">›</span></button>`;
  }

  window.WosIdentity = { status, setup, sign, publish, settingsHtml, onChange: f => subs.add(f), get last() { return last; }, available: () => !!port() };
  status();
})();
