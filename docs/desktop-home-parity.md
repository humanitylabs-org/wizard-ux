# Desktop Home parity

James requested mobile components on desktop (including Resources), a Home shortcut recommendation, and correction of the selected house icon alignment.

## Changes

- Load the existing shared Resources component on desktop. Home shows real Server CPU/memory/disk and AI-account summaries. Its Resources dialog contains the same Devices and AI accounts tabs as mobile.
- Reuse shared resource polling, refresh, failures, keyboard focus and Back behavior. Pause resource reads when away from Home and abort pending reads on leaving.
- Add Home Settings access and a local unsent-message notice linking to the existing retry Inbox. Existing Agents/System launcher entries remain accessible.
- Use the same active Working projection as mobile.
- Home is Option+0 / Alt+0 (desktop zero); retain Option+H window navigation and Option+1–9 workspaces. Advertise it in the tooltip, keyboard help, palette and Home hints.
- Center the house in its selected/unselected frame with explicit grid alignment and zero button padding. Measured original horizontal offset: -2.5px; corrected offset: 0px at 1440px and 1024px widths.
- Keep Home attention columns within their grid tracks for long thread titles.

## Thales evidence

All browser runs executed on Thales, using installed Google Chrome, under `/Volumes/ThalesMedia/Projects/wizard-ux/desktop-home-parity-20261015`.

- Untouched live daily `f4e5a7e` primary repro: 0 passed, 3 failed (offset house, missing Resources, absent Alt+0).
- `candidate-evidence-r3/results.json`: 36 passed, 0 failed. Real Resources reads; dialog tabs; desktop sizes; focus; Escape/browser Back; composer/window identity; Home keyboard/palette/help; Settings; local-outbox fixture; resource lifecycle churn; phone Resources; no page errors. All non-GET/HEAD requests fenced.
- `regression-qa-device-resources/output.log`: 19 passed, 0 failed. Explicit fixture-based device/failure contract tests.
- `regression-qa-home-resources/output.log`: 50 passed, 0 failed. Existing phone Home resource checks, real AI reads and explicitly labelled fault fixtures; query `?view=home` verifies direct Home entry.
- `candidate-evidence-r3` contains desktop Home, Devices, AI, small desktop and phone screenshots.
- Existing general `qa-soak.cjs` (6 rounds, 10 seconds, time scale 6): phone passes. Desktop reports retained DOM node growth of 20,984; running the identical desktop suite against unchanged `f4e5a7e` reports **exactly the same 20,984 node growth**. This is a baseline defect in general desktop churn, not a claimed passing soak. Isolated new Resources open/tab/close churn passes its bounded-node/listener check. No soak threshold was relaxed.

No native app, Android build, Hermes core, backend release, guest archive, or live data mutation is part of this change. Queue the web delta for the next significant Mac guest release; do not rebuild the VM for this patch.

Independent source review and live readback are required before calling the request shipped.
