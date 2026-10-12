# Home resources — approved for release with skin correction

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
James approved shipping on 12 Oct after correcting both widget and popup backgrounds to the shared UX skin. The correction uses `core/home-surfaces.css` (`wz-home-widget` and `wz-home-popup`) with semantic app-skin roles and legacy glass/line fallbacks. All three Home widgets now use the same component surface; the resource popup uses its shared raised-surface counterpart. Current pre-release state remains staged until the release receipt is appended. Production transport: the exact `/api/system/load` private-gateway path authenticates/strips identity just like the existing shell path, then goes to the narrow loopback `tools/system-resources.mjs` adapter on :9582. It reads Runtipi server-side and returns six numeric fields only. This avoids restarting the busy Agent Service or taking queue ownership. Heavy tests run on Thales: skin negative control 3/8 (five exact reported mismatches), corrected skin 8/8; full resource UI 45/45; adapter tests 9/9. Next: independent source verdict, atomic runtime install, gateway reload with preserved connections, serialized daily fast-forward and live replay. The current helper is a private preview bridge, not a broad production /api proxy. Do not contact Miguel or deploy native builds for this request.
