'use strict';
// Established synthetic owner only; no real service, provider or personal data.
function ownerRead(path) {
  if (path === '/wizard/v1/setup') return { first_run: false };
  if (path === '/wizard/hermes/api/model/options') return { model: 'qa-model', provider: 'qa-provider', providers: [{ slug: 'qa-provider', authenticated: true, models: ['qa-model'] }] };
  return null;
}
function seedOwner() {
  if (window !== window.top) return;
  for (const [k, v] of Object.entries({ 'wux.desk.homeOpen': 'true', 'wos.coached': 'true', 'wos.tour.done': '1', 'wos.tour.v1': 'true', 'wos.skin': 'nebula', 'wos.welcome.v1': 'done' })) {
    if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  }
  navigator.sendBeacon = () => false;
}
module.exports = { ownerRead, seedOwner };
