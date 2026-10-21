# Chats view slot — staged acceptance receipt

Status: **draft; do not merge or deploy**. The slot implementation and its new QA
are exercised, but the existing full Chats browser regression gate is not green.

Base: `dfc2be4215a7b076ebc16d57192651255ee45ef9` (`origin/main` at branch creation).
Product/browser evidence: `534f13a`; final slot QA including desktop browser Back:
`7f49e19`. Later documentation-only commits do not change the exercised web bytes.
Branch: `feature/chats-view-slot`.

## Execution boundaries

- Fresh isolated worktree; no live shell edits or deployment.
- `node tools/qa-origin.cjs PORT WORKTREE/web` on loopback. Reads proxy to the
  live Agent Service; non-GET/HEAD backend requests are refused.
- Browser execution on Thales with source, profiles and evidence on its external
  data volume, without the Android/VM heavy-worker lock.
- The new QA returns **403 for every non-GET**. Native Chats still attempts normal
  PUT read receipts when opening a thread; all were intercepted. Both QA origins'
  `/__qa/refused` counters stayed zero: none escaped the browser fence.
- Registry-only admission is tested using an intercepted **candidate install
  projection**, not a claim that an external provider was installed on the live
  App Manager.

## Before / after

Counts are **pass / fail**. `abort` means the script timed out after those
assertions; it is not a full suite result.

| Command / suite | Main | Candidate | Result |
| --- | ---: | ---: | --- |
| `node --test tests/*.test.mjs` | 436 / 0 | 443 / 0 | All unit tests; owner-skins guard unchanged |
| `qa-chat-basics.cjs` | 90 / 5 + abort | 90 / 5 + abort | Photo/upload assertions fail; later composer timeout |
| `qa-chats-parity.cjs` | 9 / 6 + abort | 9 / 6 + abort | Full-list/search and uploads assertions fail; attachment timeout |
| `qa-unified-chats.cjs` | 4 / 7 | 4 / 7 | Suite expects seeded private-agent fixture, absent from live-read origin |
| `qa-desktop.cjs` | 11 / 3 + abort | 11 / 3 + abort | Shell-asset classification/palette expectations fail, then hidden palette input |
| `qa-thread-back-race.cjs` | 18 / 1 | 18 / 1 | Thread/Back cases pass; old suite's unguarded init-script storage access throws in sandboxed previews |
| `qa-skin-palettes.cjs` | 28 / 0 | 28 / 0 | Same corrected QA script on both origins, waits for actual skin intro completion |
| `qa-chats-view-slot.cjs` | n/a | 22 / 0 | New contract/slot runtime checks |

The initial unmodified skin suite tapped again during the existing Mizel intro
(main 23/5, candidate 21/7). Its sole change here is waiting for `.mz-intro` to
finish, without disabling the intro, altering a palette or removing an assertion.
The initial unified main run also hit a navigation timeout (1/3); paired repeat
runs produced the 4/7 results above. Private raw logs retain both runs.

## New QA receipt

`qa-chats-view-slot.cjs ORIGIN` verifies:

- Standard Chats list and standard composer alongside a second installed view;
  both refer to the same real Agent Service thread ids and can show the same thread.
- Subject-list fixture on desktop, and phone slot default plus actual dock reopen.
- Browser Back from fixture threads preserves the app/document on phone **and** desktop.
- Named fallback for the throwing provider, with standard Chats still rendered.
- Live Appearance token inheritance and visible views after skin intro on Nebula
  and Mizel Light; no page errors.
- External registry descriptor admission without development opt-in; owner links
  and the throwing development fixture are absent in that mode.
- Zero live writes; intercepted read receipts receive 403.

Final output tail:

```text
PASS phone: browser Back leaves the thread, app and document stay open
PASS phone: throwing provider names itself and falls back
PASS phone: fallback has standard Chats list
PASS phone: zero live writes; all read receipts blocked with 403 PUT /wizard/thread-seen
PASS phone: no page errors
PASS registry: installed descriptor works without dev opt-in; owner links and dev providers are absent
PASS registry: no rejected module loads or page errors

22 pass, 0 fail
```

## Private visual evidence

Screenshots are retained in the task's private scratch evidence directory, not
committed or uploaded: real thread labels/content must not enter a public PR.
Files: `desktop-side-by-side-nebula.png` and
`desktop-side-by-side-obsidian-light.png`.

Both were visually inspected after the skin intro completed: distinct lists,
the same native thread/composer in both windows, legible inherited colours and
no obvious clipped controls. This is browser evidence, not physical Android QA.

## Remaining before release / next increment

1. Restore isolated fixtures/assumptions for the existing browser suites and
   rerun them end-to-end; equal partial baseline/candidate counts are not full
   daily-surface parity certification. No production send/upload was attempted
   to make an old suite pass.
2. App Manager: add a multi-provider `chats` slot with the built-in fallback,
   preserve/version/lint `provides` and `chats_view`, and project them plus the
   owner-selected default through Agent Service `/v1/apps`. Add real
   installation/uninstallation/default-selection acceptance and package integrity
   pinning. No companion repository was modified in this increment.
3. If publishing standard Chats as a separately installed package is required,
   package its current renderer against the same host instead of forking state.
   Fully custom thread rendering is optional; the example deliberately reuses the
   daily thread/composer.
4. Keep the PR draft until parity is proven. No merge, live shell deploy, APK or
   VM image release is authorized by this receipt.
