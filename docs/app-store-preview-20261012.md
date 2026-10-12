# Wizard OS · App store preview

Task: recover Miguel/Oscar's app browsing UX and yesterday's native integration, on current daily parity, with usable phone/desktop QA entries.

## Staged candidate

- Branch `feature/app-store-preview-20261012` in `/home/telos/worktrees/wos-app-store-preview-20261012`.
- Daily baseline: `c5e7ed2607aa43bb94788e9eae48608597d9b2b5`; existing native Apps integration: `a612285`.
- My Apps: https://apps-views.staging.wizard001.com/wizard-os-home/?view=apps
- Store: https://apps-views.staging.wizard001.com/wizard-os-home/?view=store
- Resources: https://apps-views.staging.wizard001.com/wizard-os-home/?view=resources
- Tracker: https://github.com/humanitylabs-org/wizard-ux/issues/2

The preview preserves Oscar/Miguel's native My Apps / Store / Resources design. PR14's newer four-layer graph (`f5b738683e0c3068a4527d084aa128fe6e6e9176`) remains a separate design proposal; its code and screenshots were recovered/read, not silently adopted as a redesign. Service PR7 remains an open read-only route candidate, `2d22e8770a5fb5e0879a2cecf02dffa1524a547a`.

## Changes since yesterday

- Retained today's daily shell and resolved the sheet-reset/tour integration conflict.
- Replaced dead transient staging shell/bridge processes with durable, enabled user units scoped to this preview. Shell `9551`; read-only data bridge `9553`; existing staging route retained.
- Removed unavailable-app → shell redirects, which nested Wizard inside its app frames and confused joint browser history.
- Mirrored a constrained set of existing daily GET-only app routes so real reachable apps such as Wisdom can open.
- Root Back stays inside this candidate instead of entering the old double-Back exit path. Nested Card → Store → My Apps → closed remains intact.
- Incorporated installation lane's **exact adapter-only** commit `23db0d10281f4b570ec845d0cb882b3bfda1fdcf` as `bb54231`. Owns `web/core/wizard-apps.js` and `web/core/apps.js` seam only; preview hostname still makes lifecycle actions read-only, and the origin rejects unsafe methods before forwarding.
- Corrected the QA observer to record real popstate receipts in the top page **and** same-origin hosted frames before shell propagation guards. No fabricated Back success.

## Evidence and authority

Thales workspace: `/Volumes/ThalesMedia/Builds/wos-app-store-preview-20261012`.
Evidence mirror: `/home/telos/projects/wizard-os-integration/rollout-20261012/evidence/app-store-preview`.

Verified `qa-apps-views`: **54/54** through the delivered staging URL (412×892 phone and 1440×900 desktop), actual apps.json/index/Runtipi installed/load data, nested Back, resource meters, read-only lifecycle messages, no page errors and zero `/v1/runs` writes. Existing launcher baseline: **63/63 candidate and 63/63 daily** on the same current data, with every unsafe request fenced by the Thales harness. Repeated-root/reload/Cmd-K contract and broad `qa-os` run receipts are finalized in the external handoff manifest, rather than inventing results here.

All sustained browser QA executes on Thales under `/Volumes/ThalesMedia/AndroidBuilds/worker.lock`. Phone evidence is Chromium touch viewport; physical Android hardware is not claimed. No builds, mutations, changes to daily/main, live gateway/Runtipi/host configuration or core Hermes changes are part of this candidate. Normal lifecycle delivery belongs to App installation; release integration remains with the coordinator.

## Phone/desktop review

1. Open My Apps; tap Wisdom and return with Back.
2. Open Store; search `transcri`, open a card, then Back through Store → My Apps → closed.
3. Open Resources; check all three meters. Lifecycle buttons explain that this is a read-only preview.
4. Desktop: Cmd-K → `get apps`; Escape/Back unwinds the app panels.

Remaining decision: James's keep/modify/replace verdict on these recovered views. Daily promotion is a separate approval.
