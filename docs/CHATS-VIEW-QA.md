# Chats view slot — completed parity receipt

Status: **behaviour parity proven; ready for review. No merge or deployment.**

- Current main base: `bfca77a8fd2979ab6cd615d0df1bf4bd74d88a27`, including
  My skin script, own screens, Novairecito, pull-to-refresh and private GLM routing.
- Main repair: PR [#267](https://github.com/humanitylabs-org/wizard-ux/pull/267),
  `fix/chats-qa-suites` at `5ae3f436d0d39db3f7881ffa2e9cbb5868346c06`.
- Candidate exercised: `feature/chats-view-slot` at
  `77dfe4a1ec5ca7367844b35f93e6d34eee82eb1c` (PR #256). Later receipt-only
  commits do not change the exercised product or QA bytes.

## Completed main / candidate gate

Every command below completed, exited zero and reported zero failures. No timeout
or skipped failing assertion is counted as a pass. All eight shared browser suites
and their QA origin/upload helpers are byte-identical on main repair and candidate
(`git diff` over those files is empty).

| Suite | Main + repair (#267) | Chats slot (#256) |
| --- | ---: | ---: |
| `qa-chat-basics.cjs` | 112 / 0 | 112 / 0 |
| `qa-chats-parity.cjs` | 31 / 0 | 31 / 0 |
| `qa-unified-chats.cjs` | 47 / 0 | 47 / 0 |
| `qa-desktop.cjs` | 55 / 0 | 55 / 0 |
| `qa-thread-back-race.cjs` | 19 / 0 | 19 / 0 |
| `qa-skin-palettes.cjs` | 28 / 0 | 28 / 0 |
| `qa-my-skin-script.cjs` | 34 / 0 | 34 / 0 |
| `qa-own-views.cjs` | 26 / 0 | 26 / 0 |
| `qa-chats-view-slot.cjs` | n/a | 22 / 0 |
| `node --test tests/*.test.mjs` | 466 / 0 | 473 / 0 |

The seven candidate-only unit tests explain the unit-count difference. The
owner-skins guard remains unchanged and passes. `git diff --check` is clean.
No branch-only product difference needed a fix after importing the repairs.
The slot suite now also uses the required 1440 × 900 desktop viewport.

## Before / after, without disguising incomplete runs

These **earlier before counts** are the original staged receipt, not a claim that
those partial runs were full results on today's main. Main has since advanced.
`abort` means the previous script timed out after the listed assertions.

| Suite | Earlier main / earlier candidate | Completed main / completed candidate |
| --- | --- | --- |
| chat-basics | 90/5 + abort / 90/5 + abort | 112/0 / 112/0 |
| chats-parity | 9/6 + abort / 9/6 + abort | 31/0 / 31/0 |
| unified-chats | 4/7 / 4/7 | 47/0 / 47/0 |
| desktop | 11/3 + abort / 11/3 + abort | 55/0 / 55/0 |
| thread-back-race | 18/1 / 18/1 | 19/0 / 19/0 |
| skin-palettes | 28/0 / 28/0 | 28/0 / 28/0 |
| chats-view-slot | n/a / 22/0 | n/a / 22/0 |
| my-skin-script | not previously run | 34/0 / 34/0 |
| own-views | not previously run | 26/0 / 26/0 |
| unit tests | 436/0 / 443/0 | 466/0 / 473/0 |

## Stale tests versus one real defect

See [CHATS-QA-SUITES.md](CHATS-QA-SUITES.md) for each repaired assumption and setup.
The stale assumptions were the retired upload protocol, full-history initial list,
fixed owner search/voice seeds, old desktop shortcuts/desktop numbering/app names,
a missing private-agent fixture, unsafe QA storage access in sandboxed previews,
Mizel intro timing, and expecting a composer immediately after send returns to list.
Assertions still check the real current behaviour. The old unconditional
`|| true` photo check and desktop `ok(true)` write claim were replaced by actual
rendered-photo and proxy-counter assertions.

The historical JPEG failure was **a real product bug**, not corrupt owner data.
Direct decoding yielded 1080 × 1090, while the rendered lazy image began at zero
width and never decoded. Shared `mediaBtn` now eagerly decodes already-local
`data:image/` bytes; Wizard/remote images remain lazy. The original real JPEG
browser assertion is retained, strengthened with a nonzero-width check, and
passes. Five renderer unit cases guard that distinction. No owner palette,
colour token or live state was changed.

## Safety and execution evidence

- Browser QA ran on Thales, outside the Android/VM worker lock, with source,
  profiles, scratch and screenshots on its external data volume. Phone was
  412 × 892 with touch; desktop was 1440 × 900.
- `tools/qa-origin.cjs` served each exact worktree. Real Agent Service reads
  crossed a loopback read-proxy tunnel; the origin independently refused writes.
  Static assets were local to the browser host to avoid all-assets tunnel stalls.
- All production mutations were intercepted or answered 403. Only in-memory
  fixtures acknowledged simulated sends/uploads. Main origin, candidate origin
  and upstream read proxy all reported `{"refused":0}` after the full runs:
  no mutation escaped the browser fences.
- Served `core/chats.js`, `core/chat-models.js`, `app.js` and
  `desktop/desktop.js` bytes matched each staged worktree exactly.
- The own-view suite used unmodified companion reader revision `d7d08d4` with
  candidate fixtures, not a live app installation. The slot registry suite
  likewise uses a candidate install projection, not an external installation.
- Nebula and Mizel Light slot screenshots were visually inspected at the actual
  1440 × 900 viewport: distinct readable lists, the same native thread/composer
  in both windows, inherited colours, no newly clipped composer controls.
  They remain private under the QA scratch directory; no conversation screenshots
  or raw conversation logs are committed or attached to public PRs.

## Actual final output tails

```text
112 passed, 0 failed · intercepted writes: 36
31 passed, 0 failed · intercepted writes: 16
47 pass, 0 fail
55 pass, 0 fail
thread-back-race: 19 passed, 0 failed
28 pass, 0 fail
34 pass, 0 fail
26 pass, 0 fail
PASS registry: installed descriptor works without dev opt-in; owner links and dev providers are absent
PASS registry: no rejected module loads or page errors
22 pass, 0 fail
# tests 473
# pass 473
# fail 0
# cancelled 0
# skipped 0
```

## Scope remaining after this PR

Parity/readiness is no longer blocked. Real external provider installation,
uninstallation/default selection, provenance/package integrity and the companion
App Manager/Agent Service multi-provider slot are separate integration work,
unchanged from the contract. No production send/upload, physical Android,
release packaging, live deployment or merge is claimed or authorized.
