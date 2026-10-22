# Desktop Home parity

James requested mobile components on desktop (including Resources), a Home shortcut recommendation, and correction of the selected house icon alignment.

## Changes

- Load the existing shared Resources component on desktop. Home shows real Server CPU/memory/disk and AI-account summaries. Its Resources dialog contains the same Devices and AI accounts tabs as mobile.
- Reuse shared resource polling, refresh, failures, keyboard focus and Back behavior. Pause resource reads when away from Home and abort pending reads on leaving.
- Add Home Settings access and a local unsent-message notice linking to the existing retry Inbox. Existing Agents/System launcher entries remain accessible.
- Use the same active Working projection as mobile.
- Home is Option+1 / Alt+1; the first app desktop is Option+2, followed by the icons left to right through Option+9. Shift+Option+2–9 moves windows; Home stays empty. The next icon slot adds a desktop and further digits stay inert. Retain Option+H window navigation. Advertise the mapping in tooltips, keyboard help, palette and Home hints. This supersedes the initial Option+0 recommendation, per James's follow-up.
- Consolidate phone/desktop workspace identity in `core/workspace-navigation.js`, with shared bare-glyph/count-badge styling in `core/sigils.css`. Both shells delegate focused-app selection, colour, custom/private agent glyphs, empty rings and multiwindow badges to the same renderer. The desktop bar now shows app icons instead of workspace numbers, updating immediately on focus changes. Preserve existing stored desktops/windows without migration.
- Center the house in its selected/unselected frame with explicit grid alignment and zero button padding. Measured original horizontal offset: -2.5px; corrected offset: 0px at 1440px and 1024px widths.
- Keep Home attention columns within their grid tracks for long thread titles.

## Thales evidence

All browser runs executed on Thales, using installed Google Chrome, under `$WIZARD_WORK_ROOT/Projects/wizard-ux/desktop-home-parity-20261015`.

- Untouched live daily `f4e5a7e` primary repro: 0 passed, 3 failed (offset house, missing Resources, absent Alt+0).
- `candidate-review-r1/results.json`: 56 passed, 0 failed (includes six review regressions). Real Resources reads; dialog tabs; desktop sizes; focus; Escape/browser Back; composer/window identity; Home keyboard/palette/help; Settings; local-outbox fixture; resource lifecycle churn; phone Resources; no page errors. Also validates shared icon navigation, focused-app updates and badges, Home-first numeric mapping, shifted window movement, next-slot creation, empty-desktop pruning, inert out-of-range digits and reload persistence. All non-GET/HEAD requests fenced.
- `node qa-workspace-navigation-unit.cjs`: 135 passed, 0 failed (includes generator/source stylesheet parity). Pure shared-renderer and key-slot projection tests.
- `candidate-regression-qa-hat-home/result.json`: 51 passed, 0 failed; `candidate-regression-qa-dynamic-desktops/receipt.json`: 50 passed, zero page errors. Existing tests now use Home-first numeric slots. The staging-marker assertion is opt-in via `QA_EXPECT_STAGING`, since live/candidate origins do not have staging markers.
- `regression-qa-device-resources/output.log`: 19 passed, 0 failed. Explicit fixture-based device/failure contract tests.
- `regression-qa-home-resources/output.log`: 50 passed, 0 failed. Existing phone Home resource checks, real AI reads and explicitly labelled fault fixtures; query `?view=home` verifies direct Home entry.
- `candidate-evidence-r3` contains desktop Home, Devices, AI, small desktop and phone screenshots.
- Existing general `qa-soak.cjs` (6 rounds, 10 seconds, time scale 6): phone passes. Desktop reports retained DOM node growth of 20,984; running the identical desktop suite against unchanged `f4e5a7e` reports **exactly the same 20,984 node growth**. This is a baseline defect in general desktop churn, not a claimed passing soak. Isolated new Resources open/tab/close churn passes its bounded-node/listener check. No soak threshold was relaxed.

No native app, Android build, Hermes core, backend release, guest archive, or live data mutation is part of this change. Queue the web delta for the next significant Mac guest release; do not rebuild the VM for this patch.

Independent source review found three issues: shell overlays opened under Resources; empty-desktop app launches left Resources open; shared glyph CSS was missing from generator input. All three are repaired and exercised by regression checks. `tools/sigils/build.py` ran on Thales: regenerated CSS, JS and glyph JSON exactly match the committed files by SHA-256. The reviewed documentation mismatch was already superseded by the Home-first follow-up. Live readback is recorded in the release receipt.
