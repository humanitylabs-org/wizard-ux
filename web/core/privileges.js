/* App Manager privilege notices. Display only: the manager's own page owns every decision. */
(() => {
  'use strict';
  const ROOT = '/wizard-os-home/store-install/_approve/';
  const DEVELOPER = ROOT + 'developer';
  const STATUS = '/wizard-os-home/store-data/wizard/v1/privilege-status';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state = null, stale = false, busy = null, timer;
  // Never turn untrusted tool output into an arbitrary navigation or an approval POST.
  function approval(value) {
    if (!value || value.error !== 'needs_owner_approval' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.app || '') || !Array.isArray(value.risks) || value.risks.length > 100 || !value.risks.every(r => typeof r === 'string' && r.length <= 4096)) return null;
    if (typeof value.approve_url !== 'string' || !new RegExp('^' + ROOT + value.app + '/[a-f0-9]{64}$').test(value.approve_url)) return null;
    return {error:value.error, app:value.app, risks:value.risks.slice(0, 100), approve_url:value.approve_url};
  }
  function from(value, depth = 0) {
    if (depth > 8 || value == null) return null;
    const hit = approval(value); if (hit) return hit;
    if (typeof value === 'string' && value.length <= 262144) {
      try { const hit = from(JSON.parse(value), depth + 1); if (hit) return hit; } catch (_) {}
      // wam prints one JSON object on stderr; terminal wrappers may add lines around it.
      for (const line of value.split('\n')) { if (!line.trim().startsWith('{')) continue; try { const hit = from(JSON.parse(line), depth + 1); if (hit) return hit; } catch (_) {} }
    } else if (Array.isArray(value)) {
      for (const row of value.slice(0, 100)) { const hit = from(row, depth + 1); if (hit) return hit; }
    } else if (typeof value === 'object') {
      for (const key of ['content','text','output','stderr','result','data']) { const hit = from(value[key], depth + 1); if (hit) return hit; }
    }
    return null;
  }
  function riskSentence(risk) {
    if (/privileged|runtime socket/.test(risk)) return 'Take full control of this server, including reading and changing files anywhere on it.';
    if (/mounts host path/.test(risk)) return /read-only/.test(risk) ? 'Read files on this server outside the app’s own storage and your shared files.' : 'Read and change files on this server outside the app’s own storage and your shared files.';
    if (/host file|env_file|build context|Dockerfile|build\.secrets|build\.ssh/.test(risk)) return 'Read server files or saved sign-in details while building or running the app.';
    if (/network_mode|host network|^network /.test(risk)) return 'Use the server’s network directly or join a shared network.';
    if (/devices|device access/.test(risk)) return 'Use devices connected to this server.';
    if (/pid:|ipc:|userns_mode|uts:/.test(risk)) return 'Share parts of the server that normally keep apps apart.';
    if (/cap_add|security_opt|sysctls/.test(risk)) return 'Change protections that normally limit what the app can do on this server.';
    if (/external\/custom host storage/.test(risk)) return 'Use storage outside the app’s own files.';
    return 'Use extra server permissions. Review the exact request in the App Manager before approving.';
  }
  const ownerLink = (url, label) => `<a class="wz-privilege-action" data-owner-page href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  function approvalHtml(value, name) {
    const a = approval(value); if (!a) return '';
    const sentences = [...new Set(a.risks.map(riskSentence))];
    if (!sentences.length) sentences.push('Use extra server permissions. Review the request in the App Manager.');
    return `<section class="wz-owner-approval" role="group" aria-label="App needs your approval"><b>${esc(name || a.app)} needs your approval</b><p>This app wants to:</p><ul>${sentences.map(s => `<li>${esc(s)}</li>`).join('')}</ul><p>Approve on the separate owner approval page that opens, then retry the install, update or restore. Nothing has been approved here.</p>${ownerLink(a.approve_url, 'Approve')}</section>`;
  }
  function bannerHtml(doc = state) {
    if (doc?.enabled !== true) return '';
    return `<aside class="wz-developer-banner" role="status" aria-label="Personal builds"><b>This box runs personal builds</b><span>Automatic updates are paused.</span>${ownerLink(DEVELOPER, 'Return to release')}${stale ? '<small>Can’t check the latest setting. Showing the last reading.</small>' : ''}</aside>`;
  }
  function accessText(doc = state) {
    const a = doc?.server_access; if (a?.active !== true) return '';
    const date = new Date(typeof a.expires_at === 'string' ? a.expires_at : NaN);
    return 'Your agent has full server access' + (Number.isFinite(date.getTime()) ? ' until ' + date.toLocaleString(undefined, {dateStyle:'medium',timeStyle:'short'}) : '. The end time is unavailable.');
  }
  function accessHtml(doc = state) {
    if (doc?.server_access?.active !== true) return '';
    const a = doc.server_access;
    return `<section class="wz-server-access" data-server-access="active" role="status"><b>${esc(accessText(doc))}</b><p>It can read and change anything on this server.</p>${a.drift?.length ? '<p class="wz-access-drift">Server protections changed after access was given. Review them in the App Manager.</p>' : ''}${stale ? '<p>Can’t check the latest access setting. Showing the last reading.</p>' : ''}${ownerLink(DEVELOPER, 'Turn off server access')}</section>`;
  }
  function paint() {
    let host = document.getElementById('wz-privilege-banner');
    if (!host) { host = document.createElement('div'); host.id = 'wz-privilege-banner'; (document.querySelector('.device') || document.body).append(host); }
    const html = bannerHtml(); if (host.innerHTML !== html) host.innerHTML = html;
    host.hidden = !html;
    document.documentElement.style.setProperty('--wz-privilege-banner-height', html ? host.getBoundingClientRect().height + 'px' : '0px');
    window.WosSettings?.refresh?.();
    window.dispatchEvent(new Event('wos:privileges'));
  }
  function load() {
    if (busy || document.hidden) return busy;
    busy = (async () => {
      const before = JSON.stringify([state, stale]);
      try {
        const r = await fetch(STATUS, {credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});
        if (!r.ok) throw Error('unavailable');
        const j = await r.json();
        if (typeof j.enabled !== 'boolean' || typeof j.server_access?.active !== 'boolean') throw Error('invalid');
        stale = j.server_access.available === false;
        state = stale && state?.server_access?.active ? {...j, server_access:state.server_access} : j;
      } catch (_) { stale = !!state; }
      if (before !== JSON.stringify([state, stale])) paint();
    })().finally(() => { busy = null; clearTimeout(timer); if (!document.hidden) timer = setTimeout(load, 30000); });
    return busy;
  }
  window.WosPrivileges = {approval, from, approvalHtml, riskSentence, bannerHtml, accessHtml, accessText, load, get state() { return state; }};
  // App pages use this same renderer without starting a second box-status poller.
  if (!document.currentScript?.hasAttribute('data-privilege-notices-only')) {
    window.WosSettings?.register({id:'server-access',aliases:['server-access'],page:'usage',html:() => accessHtml() || (state?.server_access?.available === false ? '<p>Can’t check whether your agent has full server access. Check the App Manager.</p>' : '')});
    document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden) load(); });
    window.addEventListener('focus', load);
    window.addEventListener('resize', () => { const h = document.getElementById('wz-privilege-banner'); if (h) document.documentElement.style.setProperty('--wz-privilege-banner-height', h.hidden ? '0px' : h.getBoundingClientRect().height + 'px'); });
    load();
  }
})();
