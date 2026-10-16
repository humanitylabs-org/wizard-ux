# Standalone Back guard repair

Scope: shared app-client guard only; no Wisdom source, native APK, host Back API, or Hermes runtime changes. Built from serving UX commit `4863792e98e6a6940abb83ba94dbfa1cb38ea256`.

## Mechanism

`useHistory` stamped and counted the synthetic standalone guard as a domain entry. Its pop landed on another stamped entry, so the standalone listener returned before clearing `guarded`. A cold Wisdom collection could reach home while the client still believed a guard existed; the next Back left the document.

- Push the shared sentinel outside the domain history adapter; retain its base route identity without incrementing the domain index.
- Strip the sentinel marker from actual adapter pushes/replaces.
- Reconcile `guarded` before returning a genuine domain pop to its router.
- At the matching root guard floor, use the existing root warning/native-consumption logic.
- After the router finishes a domain step to root, restore protection without requiring another pointer gesture. Do not take a second domain step.
- Framed clients still create no root guards; hosted dispatch stays in the existing shared host.

## Verification on Thales

Baseline client SHA-256: `c3dcb761af1ba10fa4f9334cf52c84b6342dbd29b31f2644d4ed6f76a9cb124e`.
Candidate client SHA-256: `6d152b0afcc9c54044bda95df3603ddc116192e03616dee35fb493f5c05aabc9`.

- Supplied `root-edge.cjs` against the real Wisdom fixture: baseline leaves to `about:blank`; candidate stays on home.
- `qa-app-standalone-back.cjs`: **43 checks passed**, including fresh/cold roots, no extra domain index/step, browser second-Back exit and timeout recovery, repeated installed/Android/Mac root Back, CloseWatcher overlay LIFO, and the real shared host's domain/root ownership with zero client guard pushes.
- Real Wisdom root matrix: **8 cases passed** (fresh/cold × browser/installed/Android/Mac), including cold-to-home followed immediately by Back without another tap.
- Wisdom companion revision: `3c1f93d53dfbbeb8d882f06388b1bfbc996c1561`. Remote `static/app.js`, `static/wisdom.js`, and `qa/browser_fixture.py` hashes match the untouched frozen source.
- `node --check` for client and regression script; `git diff --check` passed.

Installed display mode and native bridge presence are simulated in desktop Chrome. This is not physical Android or Mac-wrapper acceptance. Hosted verification uses the actual client, registry and app-services modules with a synthetic registered app, not a live shell deployment.

Run the focused regression with:

```sh
PLAYWRIGHT_DIR="$PLAYWRIGHT_DIR" QA_WEB_DIR="$PWD" QA_OUT="$EVIDENCE" \
  node qa-app-standalone-back.cjs
```

## Release-owner recipe — not executed by this patch

1. Recheck the current serving revision and the live `/wizard-os-home/core/app-client.js` hash. Resolve the service's `WIZARD_UX_DIR`; the historical reports copy is not authoritative.
2. Review this isolated branch against the serving base. If the base moved, replay only this delta in a new isolated integration checkout and rerun the focused gate. Preserve other owners' changes.
3. Use the repository's protected-branch PR and serialized UX promotion path. Only the shared client runtime file changes; no restart or APK build is intrinsically required for this static asset.
4. Verify the deployed client bytes through the Agent Service's actual `/wizard-os-home/core/app-client.js` route and from the private peer origin. Verify the normal web-tree update marker (`ux-version.txt`) through the standard hook/release path; do not hand-invent it.
5. Rerun Wisdom's cold collection → Back home → first root Back sequence against the deployed client, plus the ordinary hosted path. Existing documents need to load the new client before they are repaired.
6. Roll back through the same serialized release path to the recorded preceding shared-client source, preserving unrelated later releases.

No merge or live deployment was performed here. Parent release owner retains integration, review and promotion authority.
