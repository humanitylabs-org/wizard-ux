/* "Your phone isn't on your Wizard's private network": the guide the connect screen shows when a Wizard on a Tailscale
 * address doesn't answer. Pure rendering, no bridge calls (index.html wires it up; tests/connect-tailscale-guide.test.mjs
 * runs it). The Android app shows the same steps and words (android/.../TailscaleGuide.java); keep them in step.
 *
 *   WizardTailscaleGuide.html({ host, on, installed, platform })
 *     host       the Wizard's host, e.g. wizard.tail1234.ts.net (its tailnet name is shown when it has one)
 *     on         Tailscale is running on this phone (true/false); false when unknown
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
    title: 'Your phone isn’t on your Wizard’s private network',
    off: 'Tailscale isn’t running on this phone yet.',
    wrong: 'Tailscale is on, but this phone isn’t on your Wizard’s network, or your Wizard is turned off.',
    lead: 'Your Wizard is private. Only your own devices can reach it, through <b>Tailscale</b>, a free app that links them securely.',
    get: 'Get Tailscale', signin: 'Sign in with your Wizard’s account', turnOn: 'Turn it on', back: 'Come back here',
    free: 'Free, from Tailscale Inc.', installed: 'Installed and on.', isOn: 'Tailscale is on.',
    same: 'Use the same Tailscale account as on your computer.', network: 'Your Wizard is on this network:',
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

  /** Which step needs the owner now: the first that isn't done. 'done' | 'now' | 'todo' for steps 1–4. */
  function steps({ on, installed }) {
    if (on) return ['done', 'now', 'done', 'todo'];
    if (installed === true) return ['done', 'todo', 'now', 'todo'];
    return ['now', 'todo', 'todo', 'todo'];
  }

  function html({ host = '', on = false, installed = null, platform = 'ios' } = {}) {
    const android = platform === 'android', net = tailnet(host), st = steps({ on, installed });
    const open = on || installed === true;
    const hint = android ? (open ? '' : 'Opens Google Play.')
      : open ? 'Opens its App Store page; tap <b>Open</b> there.' : 'Opens the App Store. Already have it? The page shows <b>Open</b>.';
    const button = `<button type="button" class="btn primary" data-guide="tailscale">${ICON}${open ? 'Open Tailscale' : esc(T.get)}</button>${hint ? `<p class="hint">${hint}</p>` : ''}`;
    const step = (n, title, body) => {
      const s = st[n - 1];
      return `<div class="step ${s}" data-gstep="${n}" data-state="${s}"><span class="gl">${s === 'done' ? '✓' : n}</span><div><h2>${esc(title)}</h2>${body}</div></div>`;
    };
    const chip = net ? `<p>${T.same} ${T.network}</p><div class="chip">${esc(net)}</div>` : `<p>${T.same}</p>`;
    return `<p class="eyebrow">${esc(T.eyebrow)}</p>
      <h1>${esc(T.title)}</h1>
      <div class="pill" role="status"><span class="dot" aria-hidden="true"></span><span data-guide-status>${esc(on ? T.wrong : T.off)}</span></div>
      <p class="lead">${T.lead}</p>
      <div class="steps">
        ${step(1, T.get, st[0] === 'done' ? `<p>${on ? T.installed : 'Installed.'}</p>` : `<p>${T.free}</p>${button}`)}
        ${step(2, T.signin, chip + (on ? `<p class="warn">${T.removed}</p>${button}` : ''))}
        ${step(3, T.turnOn, on ? `<p>${T.isOn}</p>` : `<p>${android ? T.vpnAndroid : T.vpnIos}</p>${st[2] === 'now' ? button : ''}`)}
        ${step(4, T.back, `<p>${T.auto}</p><div class="wait"><i aria-hidden="true"></i>${T.checking}</div>`)}
      </div>
      <details><summary>${esc(T.about)}</summary><p>${T.about1}</p><p>${T.about2}</p><p>${T.about3}</p></details>
      <div class="foot"><button type="button" class="link" data-guide="other">${esc(T.other)}</button><span class="addr">${esc(host)}</span></div>`;
  }

  window.WizardTailscaleGuide = { html, steps, applies, tailnet, text: T };
})();
