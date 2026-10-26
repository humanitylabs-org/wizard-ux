# Stable onboarding repair source

This maintenance branch is the one-time exception approved in wizard-os #236 and wizard-ux #530. Base: Stable 0.3.39 UX source `c8433e348f1e715a5652089411f11d401a7860bc`.

Runtime changes are only the onboarding repairs from #434/#482/#483/#486: alongside first launch offers the phone tour or real desktop composer guide instead of auto-opening Setup; replay works through the actual desktop Keys button or `?view=tour`; Settings/Back handoff leaves controls usable; slow setup never interrupts an owner action; WebKit copy never enters with zero opacity. Stable already has per-step skip and no Command beat. No required appearance change was added.

All other runtime files, Dockerfile, app recipes, Android sources and feature code remain the Stable source. No backup/restore/Undo, Spaces, shared-composer, Store, Android or other Latest features are imported. The official hosted publisher and its regression tests are imported from main merge `8c7ba9e5f107066602c5bfffd3c618f7590ccc9e`; only the unprivileged PR trigger additionally admits this exact maintenance base so both build-only architecture legs actually run. Publication remains explicit full-SHA dispatch only, with real maintenance-ref provenance.

Local verification before PR:
- Full `npm test`: 748 pass, 0 fail.
- `node --check` for app.js, tour.js, setup-launch.js and desktop.js: pass.
- New onboarding tests run against untouched Stable: 16 fail, 3 pass (negative-control log retained outside source).
- Official publication contracts: 31 pass. These mock registry operations and are not a published image.

Installed upgrade, fresh alongside install, real first-chat, full Chromium/WebKit behavior, anonymous published-image pulls and Stable promotion are separate gates. This document does not claim them. No channel is moved by this source PR. Do not dispatch before non-author review of the exact final backport commit; do not wipe the demo until the repair is Stable and installed acceptance passes.
