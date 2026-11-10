/* Apps → Sources → Sign in to GitHub. A friend who was invited to a private repository signs in with GitHub's device
 * flow so its apps show under Beta. The App Manager (wam github_signin.py) runs the flow and keeps the credential; this
 * module only reads its status, asks it to start or end the sign-in, and draws the sheet. No token, device code or
 * client id ever reaches the browser: a status carries the GitHub username and, while pending, the short user code.
 * Server contract: GET store-install/_github, POST _github/start, POST _github/signout. */
import {ownerRequest} from './store-install.js';
const STATES = ['signed_out', 'pending', 'signed_in', 'expired', 'denied', 'error', 'not_configured', 'switched_off'];
const DEVICE_PAGE = 'https://github.com/login/device';
const UPDATE = 'This Wizard’s App Manager needs updating before GitHub sign-in is available.';
const fail = (message, status = 0) => Object.assign(new Error(message), {status});
const json = r => r.json().catch(() => ({}));

// Every field is rebuilt from a validated scalar: the response is not trusted to be well formed.
export function normalizeStatus(j) {
  const o = j && typeof j === 'object' ? j : {};
  const state = STATES.includes(o.state) ? o.state : 'error';
  const login = state === 'signed_in' && typeof o.login === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(o.login) ? o.login : '';
  const code = state === 'pending' && typeof o.user_code === 'string' && /^[A-Z0-9][A-Z0-9-]{2,15}$/.test(o.user_code) ? o.user_code : '';
  const secs = Number.isFinite(o.expires_in) ? Math.max(0, Math.min(3600, Math.floor(o.expires_in))) : 0;
  return {state: state === 'pending' && !code ? 'error' : state, login, source: o.source === 'env' ? 'env' : 'file', user_code: code,
    // Only GitHub's own device page is ever linked; anything else the server says falls back to it.
    verification_uri: DEVICE_PAGE, expires_in: state === 'pending' ? secs : 0};
}

async function status(res) {
  const j = await json(res);
  if (res.status === 404 && !j.state) throw fail(UPDATE, 404);
  if (res.status === 409 && (j.state === 'not_configured' || j.state === 'switched_off')) return normalizeStatus(j);
  if (!res.ok) throw fail(typeof j.error === 'string' && j.error.length < 200 ? j.error : `GitHub sign-in isn’t available (${res.status}).`, res.status);
  return normalizeStatus(j);
}
const call = (path, opts) => ownerRequest('store-install/_github' + path, opts);
export const githubStatus = opts => call('', opts).then(status);
export const githubStart = opts => call('/start', {...opts, method: 'POST', body: {}}).then(status);
export const githubSignOut = opts => call('/signout', {...opts, method: 'POST', body: {}}).then(status);

// Does the status call for the sign-in poll? Only a live flow on a visible page.
export const shouldPoll = (st, hidden) => st?.state === 'pending' && !hidden;

const msg = {
  expired: 'The code expired before it was approved.',
  denied: 'GitHub sign-in was cancelled.',
  error: 'Wizard couldn’t reach GitHub.',
};
// model: {status, loading, busy: ''|'start'|'signout', error, copied}; esc escapes HTML.
export function githubSheet(model, {esc}) {
  const st = model.status || {state: 'unknown'}, busy = model.busy;
  const head = `<div class="list-head"><button class="back" data-back aria-label="Back">‹</button><div><h2>Sources</h2><p>Where your apps come from</p></div></div>`;
  const err = model.error ? `<div class="link-error" role="alert">${esc(model.error)}</div>` : '';
  const spin = text => `<p class="gh-wait" role="status"><span class="gh-spin" aria-hidden="true"></span>${esc(text)}</p>`;
  const go = (label, attr) => `<button type="button" class="get big gh-go" ${attr}${busy ? ' disabled' : ''}>${esc(label)}</button>`;
  const explain = `<p class="d-sum">Beta apps are shared with you privately on GitHub. Sign in and they appear in Apps under Beta, ready to install.</p>
    <p class="d-note">GitHub only offers all-or-nothing access to private repositories, so Wizard asks for that permission. It stays on this Wizard, is only used to read and install the apps shared with you, and you can sign out whenever you like.</p>`;
  let body;
  if (model.loading && st.state === 'unknown') body = spin('Checking GitHub sign-in…');
  else if (busy === 'start') body = `${explain}<button type="button" class="get big gh-go" disabled aria-busy="true">Sign in to GitHub</button>${spin('Getting your code…')}`;
  else if (st.state === 'pending') {
    const mins = Math.max(1, Math.round(st.expires_in / 60));
    body = `<p class="d-sum">Enter this code on GitHub to finish signing in.</p>
      <div class="gh-code" data-gh-code aria-label="Your GitHub code">${esc(st.user_code)}</div>
      <div class="gh-acts"><a class="get big gh-go" href="${esc(st.verification_uri)}" target="_blank" rel="noopener noreferrer" data-gh-open>Open github.com/login/device ↗</a>
        <button type="button" class="gh-btn" data-gh-copy>${model.copied ? 'Copied' : 'Copy code'}</button></div>
      ${spin('Waiting for you to approve on GitHub…')}
      <p class="d-note">${st.expires_in ? `The code works for about ${mins} minute${mins === 1 ? '' : 's'}.` : ''} You can leave this screen; Wizard keeps waiting.</p>`;
  } else if (st.state === 'signed_in') {
    body = `<p class="d-sum" data-gh-who>${st.login ? `Signed in as <b>${esc(st.login)}</b>` : 'Signed in to GitHub'}</p>
      <p class="d-note">Apps shared with you privately on GitHub appear in Apps under Beta. To use a different GitHub account, sign out and sign in again.</p>
      ${st.source === 'env' ? '<p class="d-note" role="status">This sign-in comes from this Wizard’s settings, so it can’t be removed here.</p>'
        : `<div class="gh-acts"><button type="button" class="gh-btn" data-gh-out${busy ? ' disabled aria-busy="true"' : ''}>${busy === 'signout' ? 'Signing out…' : 'Sign out'}</button></div>`}`;
  } else if (st.state === 'not_configured') {
    body = '<p class="d-sum" role="status">GitHub sign-in isn’t set up on this WizardOS yet.</p><p class="d-note">Public apps still work. Ask whoever runs this Wizard to finish the setup.</p>';
  } else if (st.state === 'switched_off') {
    body = '<p class="d-sum" role="status">GitHub sign-in is switched off on this Wizard.</p><p class="d-note">It is a tester feature. Turn on <b>GitHub sign-in</b> in Settings › Try new features, then come back here. Public apps still work.</p>';
  } else if (['expired', 'denied', 'error'].includes(st.state) || model.unreachable) {
    body = `<p class="d-sum" role="status">${esc(model.unreachable ? 'Wizard couldn’t check GitHub sign-in.' : msg[st.state])}</p>${go('Try again', model.unreachable ? 'data-gh-retry' : 'data-gh-start')}`;
  } else body = `${explain}${go('Sign in to GitHub', 'data-gh-start')}`;
  return `${head}<section class="gh-panel" aria-label="GitHub sign-in"><h3>GitHub</h3>${err}${body}</section>`;
}
