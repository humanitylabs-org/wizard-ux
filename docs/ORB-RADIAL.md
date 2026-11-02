# Orb radial: pins-only repair

Default-off tweak `wizard/orb-radial`, version 1.1.0. This is a repair of the live 1.0.0, not permission to enable it on an owner's device.

## Interaction

- Hold the dock orb: pinned apps only, plus Voice and Customize. No open-desktop wedges.
- Pin order runs left-to-right across the inner ring first, then the outer ring. Empty slots stay empty.
- Near voice (default): rightmost inner slot, **5 inner + 8 outer pins**. Far voice: rightmost outer slot, **6 inner + 7 outer pins**. Customize is always far-left outer. Up to 13 pins; the picker disables further additions at capacity rather than silently hiding newly selected pins. Legacy over-capacity lists retain their first 13 valid IDs.
- Geometry remains 44–90 px inner, 92–138 px outer. Voice movement/speed/dwell guards are unchanged.
- An open pin keeps its own name, icon and open dot. Hover may preview its desk. Release always calls the existing app opener, which focuses/reuses or opens the app. The radial does not select a cached desk index. Home is a pinned shortcut through the existing Home command.
- Empty state: only Voice + Customize, hint **Pin apps in Customize**.
- Settings > Phone > Orb switcher and the Customize wedge open the same picker. It repaints on `wizard:apps`, so a late registry response or app installation does not leave an empty/stale list. IDs come directly from the shared mobile registry; no alias guessing.
- The removed `showOpen` preference is ignored when reading old JSON and is not saved again. Other preferences retain their existing normalization.

## Swipe-up investigation

A touch Chromium A/B replay served 9cad920d and f9afdb37 separately through `tools/qa-origin.cjs` on a spare port. All dynamic APIs were synthetic, service workers blocked, and writes refused. No owner's browser data or saved skin choice was read. The selected skin is device-local `wos.skin`; composition is `wos.skin.composition.v1`.

| Skin | Before 9cad920d | Deployed f9afdb37, OFF | Deployed f9afdb37, ON |
|---|---|---|---|
| Nebula, Grove | Apps launcher | Apps launcher | Apps launcher |
| Obsidian, Obsidian Light, Landscapes, Landscapes Light | Desks overview | Desks overview | Not offered by these skin families |
| Novairecito, Sepia | Apps launcher | Apps launcher | Not offered by these skin families |

Source diff confirms `orbUpDesks()` and the vertical swipe branches did not change in the radial deployment. The intervening live 60b9f5d3 → 9cad920d change did not touch app.js/skins/layouts/tweaks. The old experimental fan commits 80e2a143 and 51bd5b32 are not ancestors of 9cad920d.

The skin-specific Desks route predates the radial: **cab06fd9 (22 Oct 2026)**, “Miguel's skins (phone): swipe up grows the pill into the Desks overview”; **28bab40b (23 Oct 2026)** extends this to another skin's `--wos-orb-swipe-up: desks` override. Those are source dates, not proven first deployment timestamps. Both behaviours were already present in the exact serving release 9cad920d. The 25 Oct Orb gestures request asked for a **staging hold/fan prototype**, not a swipe-up change. No historical swipe-up restoration is justified by this evidence, so the repair leaves it unchanged byte-for-byte outside the radial release branch.

The repair's browser suite also exercises fast swipe-up with radial ON, with two-orbs ON/OFF, and with the CSS override absent/present. It asserts Apps versus Desks using the same shell handlers.

## Reproduced pin defects

1. **Secondary app disappears on a split desk.** Pin Calendar, open it, then put Notes in front on the same desk. 1.0.0 removes Calendar from the pin list because `openIds` contains it, but emits only the desk's focused Notes item. The Calendar pin vanishes entirely. An already-open pin also moves between rings/order as desktops change. Build items from the saved pin order and catalog; annotate open membership across every app on a desk, never replace pins with focused desk items.
2. **Already-open release does not focus the pinned app.** The old release returned a desk index. Even when a pin remained visible, selecting it could only navigate to the desk, leaving another split app focused. Always return `{kind:'open', id}` to shared `openApp`/`placeApp`.
3. **Late app registry response leaves Customize stale.** Dispatching `wizard:apps` after opening the picker did not add an installed fixture app. Subscribe for the module lifetime and repaint the sheet, preserving scroll/focus; unsubscribe on teardown.

Basic pin toggling, ID spelling, persistence, and unopened-app release worked in the 1.0.0 synthetic reproduction. Do not claim they were independently broken. Regression coverage names each actual defect above.

## Evidence and release gate

- Targeted unit files run serially: **230/230 across 22 files** (radial itself 9/9).
- Updated browser acceptance: **91/91 twice locally**. The attempted third pass and OFF hold-command suite were stopped before launch when host load exceeded 6. A forum run of three consecutive 91/91 passes, OFF hold-command and Android-UA OFF smoke is still required before activation.
- Screenshots reviewed at 412 px on Nebula and Grove, empty state and settings sheet. The hint and sheet have an opaque base under Appearance v1 surfaces.
- Local raw source/pin reproduction, touch A/B results and receipts: `$TMPDIR/orb-radial-pins/` (controller-local scratch; not shipped source).
- No live deployment or owner preference change is implied by this document. Follow the exact-head worker receipt and fresh rollback gate.
