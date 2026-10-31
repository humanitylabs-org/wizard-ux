# Oscar review — isolated staging acceptance

Credit: Oscar (Miguel's agent). Synthetic review only; no main merge or live deployment.

## Entry and exact actions

Base: https://wizard.tailc0f369.ts.net:9465

- `/__preview/`: labelled entry with both Look variants and all three review items.
- `/wizard-os-home/?look=768&view=skin`: AS BUILT from #768; removes own skins and + New skin.
- `/wizard-os-home/?look=keep&view=skin`: KEEP; keeps those controls plus #768's fixes and Select all, with main's author groups.
- `/wizard-os-home/?open=field-notes`: app with no selection actions of its own.
- `/wizard-os-home/?open=wisdom`: public starter library only, not the owner's library.
- `/wizard-os-home/?view=my-changes`: clickable demo settings page.
- `/wizard-os-home/?session=wizard_change_orb`: demo Undo / Keep / Share card.
- `/wizard-os-home/?session=wizard_change_tweaks`: demo Asked → Built → On GitHub #768 → Staged + Next step.

From the entry page:

1. Look: tap AS BUILT or KEEP (1), tap a palette (2). Scroll down for Select all (tap 3), or Your skins / + New skin in KEEP. No hidden submenu.
2. Shared menu: tap Field Notes (1), select words (hold/drag gesture, 2), tap Reply in chat (3). It opens an unsent main Chats draft, not a run. To check dismissal instead: open Field Notes, select, then Back or tap outside (3 interactions).
3. My Changes: tap Mine / Testers / Everyone entry (1), tap a tab (2); or tap the Thread / Undo / Keep / Share entry (1), then Undo, Keep or Share (2). Status progression: tap the GitHub → Staged entry (1), View on GitHub (2). The tab entry routes correctly after adding its missing alias.

## Execution results

- Backend `127.0.0.1:9511`, user unit `wizard-stage-review-1031.service` active. Receipt: `synthetic:true`, `liveUpstream:false`.
- HTTPS entry and shell respond 200 from Thales. AS BUILT link emits the expected Secure variant cookie, curl's redirect chain accepts it; explicit cookie reads `look:asbuilt` from the HTTPS receipt. VPS DNS cannot resolve the tailnet hostname, so browser rendering was captured against the identical loopback backend. No remote-browser/device acceptance is claimed.
- Phone 412×915 and desktop 1440×900 captured on Nebula and Sepia, including both Look variants, tweaks, own skins, My Changes, per-thread status, shared menu and unsent reply draft. Full matrix visually inspected via contact sheets and targeted full-resolution images.
- Both variants: Grove stays selected after reload. Select all leaves all 10 of 10 switches on after reload. KEEP: a named Review skin can be created and remains after reload; AS BUILT has zero + New skin controls.
- Field Notes: Reply in chat opens an unsent draft on main Chats. Back / Escape and tap outside close the selection menu on both viewports and skins. Menu state reports idleTimers:false.
- Chats keeps Copy / Share / Quote / Select all. Quote was clicked and composer value was `> made\n\n`.
- Wisdom registers Highlight / Note / Copy / Look up / Ask AI; shell adds Reply and Share. Its old floating panel is hidden, so there is one menu. Highlight was clicked and one saved highlight appeared. No Ask AI or Look up network request was made.
- My Changes Mine / Testers / Everyone tabs select correctly. Undo → Undone, bring back, Keep → Kept on your skin, and Share → On GitHub/Everyone work in demo state. Thread card PR URL is #768.
- Opaque menu interior: pixel difference is zero over a white vs black/text-bearing sibling behind the actual panel, excluding rounded edges, for all four viewport/skin combinations. Visual capture caught and fixed a light-skin contrast defect caused by a fixed dark tint.
- Focused Node tests on the combined KEEP branch: 17 pass, 0 fail (`look-keep-own-skins`, `my-changes-demo`, `selection-menu-unified`). No full browser suite was run on the VPS.

## Artifacts

- Screenshots and JSON receipts: `/home/telos/.hermes/cache/screenshots/staging-1031/`
- Core screenshot matrix: 37 unique files enumerated by `capture-receipt.json` (36 matrix captures + named own-skin capture); `overview-*.jpg` are inspection contact sheets. Extra Wisdom, Chats and clip-state evidence is also present.
- Final video: `/home/telos/.hermes/cache/videos/review-1031-selection-menu.mp4`, 11.333333 s, 412×916 (one padding row for H.264). Actual timestamped browser screenshots, not reconstructed UI. Shows selection, Reply draft, return to Field Notes, another selection, then Back closing the menu. The native text range is automated; physical Android long-press / hardware Back was not tested.
- Final clip source receipt: `/home/telos/.hermes/cache/scratch/review-1031-video-fixed/receipt.json`.
- Important current receipts: `supplemental-receipt.json` (Look, Chats, Wisdom), `capture-receipt.json` (matrix/actions), `final-checks.json` (fixed menu colors/opacity source).

## Real vs demo and remaining limits

Real executable frontend: both Look variants, preference persistence in this isolated browser origin, shared shell menu, app item routing, copy/quote/highlight and unsent context draft.

Demo only: all My Changes statuses, staged/live/on-your-skin claims, PR associations and Undo/Keep/Share semantics. They change demo browser state only, never deploy, change a real skin or publish a PR. No live content, owner setting, real message or recording was read.

Not accepted as production: skin-folder server round trips are intentionally 404 in this preview. The duplicate/empty My skin 2/3 behavior is covered by the focused source regression, not a real filesystem/backend integration. Full suites were inherited from the previous helper, not rerun: KEEP had zero failures; AS BUILT retains expected conflicts with tweak-layout tests #755/#1683 plus COMPONENTS.md size. Git hooks report missing lefthook; explicit focused tests were run instead. Wisdom's cold reading deep link returned to the collection; clicking Continue opens the reader; the Field Notes menu path avoids that unrelated navigation behavior.

No merge or live deploy was performed. New commits were pushed immediately to their existing branches. Current shell SHAs are readable at `/__preview/receipt`; preview-only server/entry files are under `tools/review-1031/` on the combined KEEP branch.
