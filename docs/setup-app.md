# Setup app — "Use Wizard on your phone"

System app `setup` (title **Setup**), listed beside Chats. Contract: wizard-os `spec/PHONE_SETUP.md` → "Setup app".
Design: Claude Fable, two rounds on 14 Oct 2026 (layout, copy, every state, first-run order). Archimedes built it as
specified; the only deliberate deviation is the deep-link launch rule below.

## What it is
- **Checklist** (root): one item now, "Use Wizard on your phone". Later setup items slot into the same list.
- **Use Wizard on your phone**: three steps on one screen, live from the Agent Service:
  1. Sign in to Tailscale on this Wizard → `POST /wizard/v1/setup/phone/start`, then the sign-in page (`auth_url`)
     opens outside Wizard; "Open the sign-in page" is always a real link as the fallback. `https` shows
     "Turn on secure addresses" (`https_enable_url`). Green at `serving` with the device name.
  2. Get Tailscale on your phone → QR of `install_url` (desktop) / "Get Tailscale" link (phone layout) + address row.
  3. Open Wizard on your phone → unlocked at `serving`; QR of `wizard://connect?origin=<percent-encoded HTTPS origin from wizard_url>` (desktop) / HTTPS link (phone layout) + address
     row with Copy. Green at `phone_seen`: "Your phone is connected. Add Wizard to your home screen."
- Every state of `GET /wizard/v1/setup/phone` is handled: `unavailable`, `off`, `signin`, `https`, `serving`,
  `phone_seen`, `error` alongside any step, and API failures (network/5xx banner, 401/403, 404).
- Disconnect lives behind the `···` menu with a confirm sheet (`POST …/phone/reset`).
- Polls `GET /wizard/v1/setup/phone` every 2 s (1 s while a sign-in is starting) **only while the phone screen is on
  screen**: an IntersectionObserver on the screen inside the frame (another desk/workspace stops it), page visibility,
  and the layer itself. One immediate fetch on return/focus.
- QR codes are drawn locally on a white 168 px tile from the vendored MIT `qrcode-generator` 2.0.4
  (`web/setup/vendor/`, provenance in `web/setup/provenance.json`). No address leaves the device.
  Connection origins reject non-HTTPS schemes, credentials, paths, queries and fragments. Android Connect also
  accepts a plain HTTPS origin; displayed/copyable browser addresses always stay HTTPS.
- Look: Appearance v1 tokens only (`--wz-*`), transparent canvas on the shell's window material like Chats, dark by
  default. Two colours of its own: `--setup-ok` and `--setup-warn` (step glyphs only).
- Owner name only from settings (`WizConfig.owner()` / bootstrap `owner.name`); no name → no name in the copy.

## First run and the tour (decision)
- The shell asks `GET /wizard/v1/setup` at boot (2.5 s budget). `first_run: true` → it opens Setup. The **app** POSTs
  `/wizard/v1/setup/seen` when it renders with `first_run` (one retry on the next visibility change), so if the
  open fails Setup simply tries again next launch.
- **Setup first, tour after.** On the phone layout the 30-second gesture tour is held (session-only flag) and starts
  the first time the Home desk settles in front — which is exactly where Back from Setup lands. It never stacks on
  Setup and runs at most once. The checklist footer says so, and "Show the 30-second tour" runs it at once (phone
  only). If the person never goes back Home, the tour runs on the next launch as it always has.
- **Deep-link launch** (`?session=`, `?view=`, `?open=`): the link wins. Setup doesn't auto-open (it does on the next
  plain launch) and the tour keeps its existing deep-link rule. (Fable's checklist had Setup open here too; a
  notification tap or a shared link shouldn't be hijacked, so this one rule differs.)
- No answer, an old box without the API (404), or `first_run: false`: the shell behaves exactly as before.

## Back (never exits)
Disconnect sheet → menu → phone screen → checklist, each one press, via the shared WizardApp Back client
(`WizardApp.back.register/push`). At the checklist the app declines and the shell takes its own step (phone: Home desk;
desktop: Esc keeps the window). The frame's URL never changes.

## Leaving Wizard (sign-in, HTTPS switch, install page, the Wizard address)
Plain `<a target="_blank" rel="noopener">` links. The shell's frame guard (`core/links.js` `guardFrame`) hands them
to `external()` → new tab in a browser; the Android app hands the main-frame navigation to the system browser; the
Mac app's WKWebView delegate opens new-window URLs with `NSWorkspace.shared.open` (system browser). The auto-open after
`start` uses the same path once; if a browser blocks it, the visible link is the second tap that always works.
Setup never calls `window.open`.

## Files (cherry-pick map)
New, self-contained:
- `web/setup/index.html`, `web/setup/setup.js`, `web/setup/setup.css`
- `web/setup/vendor/qrcode.js`, `web/setup/vendor/LICENSE-qrcode-generator`, `web/setup/provenance.json`
- `web/core/setup-launch.js` (first-run open + held tour; `WosSetupLaunch.boot/desk`)
- `tools/fake-setup-api.cjs` (fake Agent Service Setup API + static server), `qa-setup-app.cjs`,
  `tools/qa-setup-app-thales.sh`, `docs/setup-app.md`

Registration hooks (one line each):
- `web/core/apps.js`: the `setup` entry in `ALL`, right before Chats.
- `web/index.html`: `<script src="core/setup-launch.js">` after `core/tour.js`.
- `web/desktop.html`: `<script src="core/setup-launch.js">` before `desktop/desktop.js`.
- `web/app.js`: the first-run tour timer becomes `WosSetupLaunch.boot({...})` (old timer kept as the fallback when the
  module is absent); `goDesk` calls `WosSetupLaunch.desk(idx === HOME)`; `setup` joins the `store-window` list.
- `web/desktop/desktop.js`: `WosSetupLaunch.boot({ open })` right after `C.deeplink.consume()`.
Dependencies on the base: `core/app-client.js` (WizardApp v1 Back/appearance), `core/appearance-host.js`,
`core/links.js` `guardFrame`, `core/deeplink.js` log, `WosTour.start/mark/done/active`, `__wosNativeBack`.

## QA
`node tools/fake-setup-api.cjs 9473 & node qa-setup-app.cjs http://127.0.0.1:9473/wizard-os-home/`
(`QA_JSQR` = path to `jsqr`, `QA_PLAYWRIGHT` = Playwright module path; on Thales use
`tools/qa-setup-app-thales.sh <label>`). The runner stages a frozen source snapshot below
`/Volumes/ThalesMedia/QA/phone-setup`, runs browser-only QA without the Android/VM worker lock,
and writes `out/qa-setup-app.{log,json}` and `out/shots/`. Source-only Android files are copied for
the portable `npm test` inventory checks; no Gradle/build tasks run. The browser suite uses a mobile
UA + touch context and a desktop context, exercises the visible Skin controls, preserves an open
disconnect dialog and document identity across every installed skin, and decodes rendered QR pixels.
 `--walk` on the fake server walks a started sign-in through every
step by itself for demos.
