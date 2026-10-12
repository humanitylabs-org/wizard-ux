# Home resources — shipped

## Requested outcome
Unread and Working directly below time/status; remove Home Yesterday bar while preserving Day in review elsewhere; keep blank lower space. Compact aesthetic Home resource widget: CPU, memory, disk and condensed AI availability; tap into server/full AI-account dashboard. Use Opus 5.5 for design.

## Implementation
- Opus 5.5 selected Quiet Instrument; two design rounds (plus one correction for a tool-shaped non-answer) and two code-review rounds. Archimedes implemented and independently verified it.
- Native phone Home only, on `feature/home-resources`, preserving foreground-battery/Mizel changes from daily c5e7ed2. Desktop shell unchanged, no APK/native changes.
- Real Runtipi `/api/system/load`: CPU `cpuLoad`, RAM `percentUsedMemory`, disk `percentUsed`, capacities in GB. Existing Miguel/Oscar resource view source: `wos-apps-screens/web/core/wizard-apps.js` at a612285; `wizard-app-manager/packages/backend/src/modules/system/system.service.ts` confirms definitions.
- Existing `/wizard/ai-usage` feed: configured Claude + three ChatGPT accounts. Widget shows weekly remaining separately; detail reuses WosUsage for every session/weekly/model quota window, reset times and reported paid-credit information. This is current account quota, not a fabricated historical usage chart or coverage of disconnected providers.
- Server 15-second/AI 60-second bounded refresh, one timer only on visible Home/details; stops on another desk/background. Unknown and stale states explicit. Server and AI tap zones open one resource sheet with tabs; Back/Escape close to Home; keyboard focus retained/restored.
- Shared Usage null-percent correction is staged here; `.rs-sheet .us-*` overrides resolve a Usuals class collision without changing Settings.

## Preview and evidence
- Exact entry: https://home-resources.staging.wizard001.com/wizard-os-home/?review=home
- `wizard-stage-home-resources` qa-origin :9504 + enabled `wizard-stage-home-resources-front` :9571; staging router uses front. All writes denied. Front returns only allowlisted numeric stats; token never enters browser.
- Run on Thales: `NODE_PATH=$HOME/workspace/wizard-mobile-link-candidate/node_modules /opt/homebrew/bin/node qa-home-resources.cjs https://home-resources.staging.wizard001.com/wizard-os-home/?review=home`
- The stage-only `?review=home` bootstrap opens Home directly and skips practice onboarding; verified with fresh browser storage and with a different desk previously saved. It leaves daily onboarding unchanged.
- Final: **45/45**, zero page errors and zero user/agent writes. Responsive 360×740, 390×844, 412×892; full dashboard labels/bars, browser Back and native adapter Back, error fixtures, all-unavailable-200 fixture, off-desk cached render, timer suspension, keyboard focus and actual accessibility tree.
- Earlier focused Home-only suite before widget: old tree fails 3 layout checks; after patch 9/9. It is intentionally a layout-only negative-control test and its blank-space threshold does not apply after adding the widget.
- Raw Opus prompts/replies, remote QA log and screenshots: `/home/telos/context/sources/projects/ai-wizards/wizard-home-resources/2026-10-12/`.

## Review disposition
Review 1 M1 defensive unknown-label, M2 cached off-desk render, focus retention/restoration and stale detail dimming resolved. Review 2 closed those findings; its remaining freshness fallback and screen-reader names corrected and covered by final 43-check run. Normalized null quota windows are dropped; defensive direct-null rendering also tested with an isolated fixture.

## Release gate
James approved shipping on 12 Oct after correcting both widget and popup backgrounds to the shared UX skin. The correction uses `core/home-surfaces.css` (`wz-home-widget` and `wz-home-popup`) with semantic app-skin roles and legacy glass/line fallbacks. All three Home widgets now use the same component surface; the resource popup uses its shared raised-surface counterpart. Current pre-release state remains staged until the release receipt is appended. Production transport: the exact `/api/system/load` private-gateway path authenticates/strips identity just like the existing shell path, then goes to the narrow loopback `tools/system-resources.mjs` adapter on :9582. It reads Runtipi server-side and returns six numeric fields only. This avoids restarting the busy Agent Service or taking queue ownership. Heavy tests run on Thales: skin negative control 3/8 (five exact reported mismatches), corrected skin 8/8; full resource UI 45/45; adapter tests 9/9. Independent reviewer found popup parity and descendant text-role mismatches; both are now fixed and covered by the expanded 10/10 skin regression. Shell Settings/Chats and Resources share the same raised-surface roles while preserving window navigation/layout/focus styling. Resource controls inherit the semantic foreground. Adapter source received no must-fix finding; its remote 9/9 tests passed. Source verdict recovered from completed delegation deleg_c1b468f1 after automatic delivery was dropped. Next: atomic runtime install, gateway reload with preserved connections, serialized daily fast-forward and live replay. The current helper is a private preview bridge, not a broad production /api proxy. Do not contact Miguel or deploy native builds for this request.

## Shipped receipt
James approved this release with the skin correction. Daily Home is live at `https://wizard.tailc0f369.ts.net/wizard-os-home/?view=home`: two attention rows beneath status, Yesterday removed, matching shared widget/popup surfaces, real server and AI resource dashboards. Resource controls inherit semantic foreground. Settings/Chats/resource panels use the same skin-owned raised surface while keeping existing layout/navigation.

Live web tree: `7bb3bdf3808ce1a6bf30866e2e51989bc3da7570`; UI code promotion `579ab90`. Thales live resource suite **45/45**, skin suite **10/10**; adapter **9/9**. The fault-injection suite explicitly blocks service workers so its unavailable-response fixtures reach page fetches; the earlier ordinary-worker live run passed the first 35 actual-render/navigation/timer checks before its fixture interception failed. Live gateway tests independently confirm trusted read 200, untrusted PROXY peer with forged identity 403, cross-site 403, unsafe method 405. Busy Agent Service was not restarted; activation timestamp remains 09:44:29 UTC.

The stats adapter runs from immutable source f893fa2 on loopback :9582 and the private gateway has only an exact authenticated read route. Browser never receives the Runtipi token. Caddy config was validated, then reloaded by SIGUSR1 without replacing its process or stopping Agent Service. Main daily promotion used the Wizard UX release lock and fast-forward-only gates; served fingerprint matches `daily:web`.

No remaining James gate. Exact live evidence and final asset receipt: `/home/telos/context/sources/projects/ai-wizards/wizard-home-resources/2026-10-12/shipped/`. The prior source-review automatic delivery was dropped; the parent recovered its canonical result, resolved both must-fix findings and completed this release itself. A progress-only turn had surfaced prematurely in Ready; completion is recorded only after the live checks above.

