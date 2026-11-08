'use strict';
// Synthetic established-owner fixture. Never reads a live endpoint or installs a key dispatcher.
const MODEL_OPTIONS = Object.freeze({ provider: 'openai-codex', model: 'synthetic-hotkeys', providers: [{ slug: 'openai-codex', name: 'Synthetic QA provider', authenticated: true, auth_type: 'oauth', models: [{ id: 'synthetic-hotkeys', name: 'Synthetic QA model' }] }] });
function ownerRead(pathname) {
  if (pathname === '/wizard/hermes/api/model/options') return MODEL_OPTIONS;
  if (pathname === '/wizard/v1/setup') return { first_run: false, seen: true };
  if (pathname === '/wizard/hermes/api/sessions') return { object: 'list', data: [], has_more: false, limit: 100, offset: 0, snapshot: 'hotkeys-static' };
  if (pathname === '/wizard/thread-seen') return { state: { initializedAt: 1, threads: {} } };
  if (pathname === '/wizard/v1/boomerangs') return { reminders: [] };
  return {};
}
function seedOwner({ phone }) {
  if (window !== window.top) return;
  for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  // Init scripts also run on reload. Never overwrite the shell's saved workspace/skin.
  if (!phone && localStorage.getItem('wux.desk.ws') === null) {
    const ws = [], wins = {};
    for (let i = 0; i < 3; i++) { const id = 'fixture' + i; wins[id] = { id, app: 'frame', url: '/qa-desktop-frame/', title: 'Synthetic app ' + i }; ws.push({ id: 'desk' + i, wins: [id], focus: id, mono: false }); }
    for (const [k, v] of Object.entries({ wins, ws, cur: 0, homeOpen: false })) localStorage.setItem('wux.desk.' + k, JSON.stringify(v));
  }
}
function appScript(instrument) {
  window.fixtureLoadId = Math.random().toString(36).slice(2);
  window.fixtureEvents = [];
  window.fixtureBridge = { registrations: [], calls: [] };
  // Observe only shell-owned adapter registrations on this synthetic app's own
  // Window/Document. Original callbacks receive the identical trusted event and
  // this value. No nested-document scan, synthetic dispatch or shell mutation.
  if (instrument) for (const [target, label] of [[window, 'window'], [document, 'document']]) {
    const add = target.addEventListener;
    target.addEventListener = function(type, listener, options) {
      const source = typeof listener === 'function' ? Function.prototype.toString.call(listener) : '';
      const adapter = /onKey\(e, true\)|keyHints\.(up|hide)\(/.test(source);
      if (!adapter || !['keydown', 'keyup', 'blur'].includes(type)) return Reflect.apply(add, this, [type, listener, options]);
      const row = { target: label, type, capture: options === true || !!options?.capture };
      fixtureBridge.registrations.push(row);
      return Reflect.apply(add, this, [type, function(e) {
        fixtureBridge.calls.push({ ...row, key: e.key, code: e.code, trusted: e.isTrusted, defaultPrevented: e.defaultPrevented });
        return Reflect.apply(listener, this, [e]);
      }, options]);
    };
  }
  for (const type of ['keydown', 'keyup']) window.addEventListener(type, e => {
    fixtureEvents.push({ type, key: e.key, code: e.code, repeat: e.repeat, trusted: e.isTrusted });
    if (window.fixturePolicy === 'immediate') { e.stopImmediatePropagation(); return; }
    e.stopPropagation();
  }, true);
}
module.exports = { MODEL_OPTIONS, ownerRead, seedOwner, appScript };
