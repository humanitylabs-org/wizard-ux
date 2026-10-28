/* "Your phone isn't on your Wizard's private network": the guide the connect screen shows when a Wizard on a Tailscale
 * address doesn't answer. Pure rendering, no bridge calls (index.html wires it up; tests/connect-tailscale-guide.test.mjs
 * runs it). The Android app shows the same steps and words (android/.../TailscaleGuide.java); keep them in step.
 *
 *   WizardTailscaleGuide.html({ host, on, missing, installed, platform })
 *     host       the Wizard's host, e.g. wizard.tail1234.ts.net (its tailnet name is shown when it has one)
 *     on         Tailscale is running on this phone (true/false); false when unknown
 *     missing    with Tailscale on: true when the Wizard's name doesn't exist from this phone (another Tailscale
 *                account, or removed from the network); false when it exists but nothing answers (the Wizard's
 *                computer is off or asleep: Tailscale still knows an offline Wizard's name); null before the first check
 *     installed  true/false on Android; null on iPhone, which can't tell (the App Store page shows Get or Open)
 *   WizardTailscaleGuide.applies(host)   only Tailscale addresses (*.ts.net) get the guide
 *   WizardTailscaleGuide.tailnet(host)   'tail1234.ts.net' from 'wizard.tail1234.ts.net', else '' */
(() => {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bare = host => String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const applies = host => /^[a-z0-9-]+(\.[a-z0-9-]+)+\.ts\.net$/.test(bare(host));
  const tailnet = host => { const h = bare(host); return applies(h) ? h.slice(h.indexOf('.') + 1) : ''; };

  const T = {
    eyebrow: 'Can’t reach your Wizard',
    title: 'Your phone isn’t on your Wizard’s private network', titleAway: 'Your Wizard isn’t answering', titleChecking: 'Connecting to your Wizard',
    off: 'Tailscale isn’t running on this phone yet.',
    wrong: 'Tailscale is on, but this phone isn’t on your Wizard’s network.',
    quiet: 'Tailscale is on, but your Wizard isn’t answering this phone.',
    unsure: 'Tailscale is on. Checking that this phone is on your Wizard’s network…',
    wake: 'Check your Wizard is on', wakeBody: 'Make sure the computer running your Wizard is on and awake, with Wizard open. This phone connects by itself.',
    lead: 'Your Wizard is private. Only your own devices can reach it, through <b>Tailscale</b>, a free app that links them securely.',
    get: 'Get Tailscale', signin: 'Sign in with your Wizard’s account', back: 'Come back here',
    free: 'Free, from Tailscale Inc.', installed: 'Installed.',
    same: 'Use the same Tailscale account as on your computer.', network: 'Your Wizard is on this network:',
    stuck: 'Open Tailscale and check it’s connected with that account. If this phone was removed from Tailscale, or it looks stuck, turn Tailscale off and on again and log in if it asks.',
    removed: 'This phone is on a different Tailscale network, or it was removed from yours. In Tailscale, switch account or sign in again.',
    vpnIos: 'The first time, iPhone asks to <b>Add VPN Configurations</b>. Tap <b>Allow</b>.',
    vpnAndroid: 'The first time, Android asks to set up a VPN connection. Tap <b>OK</b>.',
    auto: 'Wizard connects by itself.', checking: 'Checking…',
    about: 'What is Tailscale?',
    about1: '<b>Tailscale</b> is a free app that links your own devices into a private network, wherever they are: at home, at work, on mobile data.',
    about2: 'Your Wizard joined that network when you set up your phone on your computer. Only devices signed in to <b>your</b> Tailscale account can reach it; nothing is opened to the internet, and Wizard still asks who you are.',
    about3: 'It runs in the background as a VPN. You can leave it on.',
    other: 'Use a different Wizard',
  };
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" class="tsmark"><circle cx="5" cy="5" r="2.2"/><circle cx="12" cy="5" r="2.2" opacity=".4"/><circle cx="19" cy="5" r="2.2" opacity=".4"/><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/><circle cx="5" cy="19" r="2.2" opacity=".4"/><circle cx="12" cy="19" r="2.2"/><circle cx="19" cy="19" r="2.2" opacity=".4"/></svg>';

  /** Steps 1–3 complete in order: a step is done only when every step before it is. 'done' | 'checking' (the app is
   * verifying it now: its own spinner) | 'now' (the owner's turn) | 'todo'. 1 Get Tailscale (done once it's running,
   * or installed on Android), 2 sign in with the Wizard's account (and allow the VPN), 3 come back / is the Wizard on. */
  function steps({ on, missing = null, installed }) {
    // The name resolves but nothing answers: the Wizard's computer is off, or Tailscale on this phone is stale (a phone
    // removed from Tailscale keeps its old network list until Tailscale reconnects). The phone can't tell which, so
    // step 2 isn't ticked: it asks to check Tailscale, while step 3 keeps checking for the Wizard.
    if (on && missing === false) return ['done', 'now', 'checking'];
    if (on && missing === true) return ['done', 'now', 'todo'];       // signed in to another network
    if (on) return ['done', 'checking', 'todo'];                      // checking the phone's network
    if (installed === true) return ['done', 'now', 'todo'];           // installed (Android knows): open it
    return ['now', 'todo', 'todo'];
  }

  function html({ host = '', on = false, missing = null, installed = null, platform = 'ios' } = {}) {
    const android = platform === 'android', net = tailnet(host), st = steps({ on, missing, installed });
    const away = on && missing === false; // the phone is fine; the Wizard isn't answering
    const open = on || installed === true;
    const hint = android ? (open ? '' : 'Opens Google Play.')
      : open ? 'Opens its App Store page; tap <b>Open</b> there.' : 'Opens the App Store. Already have it? The page shows <b>Open</b>.';
    const button = `<button type="button" class="btn primary" data-guide="tailscale">${ICON}${open ? 'Open Tailscale' : esc(T.get)}</button>${hint ? `<p class="hint">${hint}</p>` : ''}`;
    const step = (n, title, body) => {
      const s = st[n - 1];
      const glyph = s === 'done' ? '✓' : s === 'checking' ? `<i aria-label="${esc(T.checking)}"></i>` : n;
      return `<div class="step ${s}" data-gstep="${n}" data-state="${s}"><span class="gl">${glyph}</span><div><h2>${esc(title)}</h2>${body}</div></div>`;
    };
    const chip = net ? `<p>${T.same} ${T.network}</p><div class="chip">${esc(net)}</div>` : `<p>${T.same}</p>`;
    return `<p class="eyebrow">${esc(T.eyebrow)}</p>
      <h1>${esc(on && missing === false ? T.titleAway : on && missing !== true ? T.titleChecking : T.title)}</h1>
      <div class="pill" role="status"><span class="dot" aria-hidden="true"></span><span data-guide-status>${esc(!on ? T.off : missing === true ? T.wrong : missing === false ? T.quiet : T.unsure)}</span></div>
      <p class="lead">${T.lead}</p>
      <div class="steps">
        ${step(1, T.get, st[0] === 'done' ? `<p>${T.installed}</p>` : `<p>${T.free}</p>${button}`)}
        ${step(2, T.signin, chip + (away ? `<p>${T.stuck}</p>` : st[1] !== 'done' ? `<p>${android ? T.vpnAndroid : T.vpnIos}</p>` : '')
          + (on && missing === true ? `<p class="warn">${T.removed}</p>` : '') + (st[1] === 'now' ? button : ''))}
        ${away ? step(3, T.wake, `<p>${T.wakeBody}</p>`) : step(3, T.back, `<p>${T.auto}</p>`)}
      </div>
      <details><summary>${esc(T.about)}</summary><p>${T.about1}</p><p>${T.about2}</p><p>${T.about3}</p></details>
      <div class="foot"><button type="button" class="link" data-guide="other">${esc(T.other)}</button><span class="addr">${esc(host)}</span></div>`;
  }

  window.WizardTailscaleGuide = { html, steps, applies, tailnet, text: T };
})();
