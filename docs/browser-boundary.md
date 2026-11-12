# Browser owner boundary (shell side)

Issue: humanitylabs-org/wizard-os#133. App Manager side and the box switch: wizard-app-manager `docs/browser-boundary.md`.
Agent Service side: wizard-agent-service `server/browser-boundary.mjs`.

Off unless the box ran `wam browser-boundary on` (it sets `WIZARD_BROWSER_BOUNDARY=1` and `WIZARD_SHELL_TOKEN_FILE`
for this container). Off: no token file, the page's `<meta name="wizard-shell-token" content="">` stays empty,
`core/shell-token.js` wraps nothing, and nginx serves the pages exactly as before.

On:

- `packaging/entrypoint.sh` reads the token (64 lowercase hex) or refuses to start. nginx writes it into
  `index.html` / `desktop.html` only for a page navigation: `Sec-Fetch-Mode: navigate` with `Sec-Fetch-Dest:
  document` (top level), or `empty` (the same navigation passed on by the shell's service worker). A frame load
  (`iframe`), a `fetch`, a worker or the service worker's own warm-up read gets the empty placeholder. Scripts cannot
  set these headers. The answer is `Cache-Control: no-store`, so the service worker and the HTTP cache never keep
  it; a shell opened from the offline copy has no token (its owner calls then fail until the next online load).
  A shell page that ends up in a frame anyway never arms the wrapper (`window.top !== window`).
- `core/shell-token.js` is the first script on both pages. It takes the token out of the page, keeps it in a closure,
  and adds `X-Wizard-Shell-Token` to `fetch` and `XMLHttpRequest` calls from the top-level shell to owner routes on
  this origin: `/wizard/`, `/api/`, `/v1/`, `<prefix>api/` and `<prefix>store-install/`. App paths (`/notes/`, …)
  and other origins never get it, so no app backend learns it.

Not covered yet (next slices, all on #133): app frames are still same-origin and unsandboxed, so until they are
sandboxed the token is not a real boundary; shell pages that run inside a frame (Store, Agents, Setup) send no token;
`<img>`/`<video>` loads of `/wizard/attachments/…` cannot carry a header. So nobody should turn the box switch on yet.
