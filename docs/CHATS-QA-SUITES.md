# Chats regression QA repair

Baseline: `origin/main` at `00ffd23a8fce489f606a75a9c896a468720f52d3`.
Re-ran every listed gate after incorporating PR #266's desktop connection pill
and PR #268's Stable/Latest update-channel picker.
Scope: isolated QA and one confirmed shared-renderer defect; no merge or deployment.

## Repaired assumptions (not disabled checks)

- Uploads now use create / PATCH chunks / complete, not the retired one-shot
  upload endpoint. `tools/qa-uploads.cjs` checks metadata, offsets and complete
  byte counts. Parity compares the uploaded PNG/PDF bytes exactly. Three unit
  tests exercise successful completion and reject invalid/incomplete uploads.
- Successful send returns to the list. Tests reopen the same session, then check
  its optimistic photo/text bubble, cleared composer/tray and cleared draft.
  New-session fixtures preserve the client's requested id instead of inventing
  a different id that violates outbox idempotency.
- The initial list is the exact bounded `archive-50` API window, not the entire
  historical database. The test compares ids, checks the archive bound/total,
  then searches for a real older thread outside that loaded window.
- The voice playback sample is a deterministic two-second PCM WAV with file-chip
  metadata. It must render, report the actual duration, play with advancing
  progress, and pause. Real list/search reads remain part of parity QA.
- Unified Chats starts its own fresh `--main=fixture --seed=private` sidecar.
  Only explicitly scoped APIs go to it; all other live mutations are refused.
  This retains private reads, sealing, replies, model routing, privacy context
  exclusion and Back assertions without requiring a private agent on the owner
  service. It includes main's newer GLM/DeepSeek checks from PR #265.
- Desktop uses current Option-Space / Option-N / Option-V and Home-aware desktop
  slots, registry app labels and real installed Calendar/Music entries. Shared
  data modules are not misclassified as phone-shell modules. Right Option is
  intentionally reserved for the OS; its inert boundary is asserted, while the
  retained dictation controller and native insertion bridge are still exercised.
- The Back race's QA init script guards storage access in opaque sandbox frames;
  no product exception is suppressed. Its late-response and real iframe history
  traversal cases still run.
- Skin QA waits for the actual Mizel intro before the next tap. No palette,
  animation, owner skin or colour assertion is altered.

## Confirmed product defect

A historical inline JPEG was **not corrupt**: direct browser decoding succeeded
at 1080 × 1090. Its rendered image-only bubble initially had zero width;
`loading="lazy"` never decoded it, so the original real-data assertion failed.
The shared media renderer now eagerly decodes inline `data:image/` sources,
whose bytes are already local. Network images remain lazy. Five unit cases
exercise the actual renderer function for JPEG, PNG, inline thumbnail, Wizard
attachment and remote photo. The original historical JPEG browser check is
retained and now additionally requires nonzero rendered width; deterministic
photo-only fixtures are still checked separately.

No other product bug was required to make these suites pass.

## Execution

Browser execution was on Thales, with checkouts, profiles and evidence on its
external data volume. Phone: 412 × 892 touch; desktop: 1440 × 900.

Serve a worktree with `node tools/qa-origin.cjs PORT WORKTREE/web`.
`QA_BACKEND_PORT` optionally selects a loopback read-proxy tunnel;
`WIZARD_UX_FALLBACK_WEB` optionally supplies untracked data/summaries outputs.
Neither option permits backend writes. Serving static files on the browser host
avoids navigation/request stalls through a multiplexed all-assets SSH tunnel.

Run each script with its header's environment (Playwright via `PW` / `NODE_PATH`,
Chrome via `QA_CHROME`, private screenshots via `QA_OUT` / `QA_SHOTS`).
`qa-own-views.cjs` also needs `QA_APP_VIEWS_MODULE` naming the companion Agent
Service's `server/app-views.mjs`; it starts its own isolated origin and fixture
files. Companion reader revision used: `d7d08d4` (unmodified).

All production mutations are intercepted or receive 403. Local in-memory
fixtures may acknowledge simulated sends/uploads/reads. The origin refusal
counters stayed zero: no mutation escaped the browser fences. Real conversations
in screenshots/logs remain private; none are committed or attached to a PR.

## Main acceptance (pass / fail)

| Suite | Completed result |
| --- | ---: |
| qa-chat-basics | 112 / 0 |
| qa-chats-parity | 31 / 0 |
| qa-unified-chats | 47 / 0 |
| qa-desktop | 55 / 0 |
| qa-thread-back-race | 19 / 0 |
| qa-mark-unread | 25 / 0 |
| qa-skin-palettes | 28 / 0 |
| qa-my-skin-script | 34 / 0 |
| qa-own-views | 26 / 0 |
| node --test tests/*.test.mjs | 468 / 0 |

All commands exited zero; none timed out. Owner-skins guard is included and
unchanged. `git diff --check` is clean. No production send/upload, physical
Android, packaging, merge or deployment is claimed.
