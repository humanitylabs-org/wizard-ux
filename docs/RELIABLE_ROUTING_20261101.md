# Reliable routing candidate — source and release seam

REUSE: shared `chat-models.js`, model chip and feedback; existing Outbox, native take metadata, native LockedRunBridge, durable RunQueue and run events.
EXTEND: deliberate revision custody, qualified agent/session keys, exact configured transport bindings, stable picker request recovery, active-runtime steer checks and immutable replay.
NEW: regression cases and adjacent adapter custody only. No router, credential store, scheduler or economical policy.

## Two bounded delivery surfaces

- Shared main baseline: `df3a06590a417b02fded75bb589ddc11fec68295`. The main proposal cherry-picks only routing changes, not the retained live history. One `live.js` detail hydration conflict was resolved by preserving main's existing queueReason/status pairing and adding the deliberate selection field.
- Retained live parity baseline: `33e85353e856b75f7c740f305f6c565452d7797a`, branch `live/agent-parity-20261022`. The live-preserving candidate keeps all that source's features. It is not a proposal to replace live with shared main.
- At inspection, shared main and retained live had 65 main-only and 529 live-only commits. Existing custody reconciliation PR #697 is a draft, not authority to discard either side. Current open release/parity metadata is owned by the same `defleur-agents` account; no distinct human release owner was established from it.
- Live companion PR #825 must target the retained live parity baseline. Shared-main PR is a separate bounded review. Neither is permission to deploy. A later release owner must adopt the exact tested source SHA, pass the real live app-parity gate and use the normal backend/source release procedure. No blanket merge or ours/theirs reconciliation is part of this change.

## Regression diagnosis

The first real forum job failed both full suites; focused routing tests passed. Do not describe that run as green. Its receipt and complete logs are retained under the parent's `reliable-routing/diagnostic-first/` directory.

The four model-related UX failures were two assertions predating the explicit initial revision field and two VM fixtures omitting the secure browser crypto API. Fixtures now assert revision 0 on new drafts, inject Node's real WebCrypto and acknowledge an integer server-owned revision. Wrong acknowledgement still fails, keeps the previous chip custody and blocks Send until recovered. Unrelated Archive, Back, Look and outage assertions were not rewritten.

The service log included real Unix socket `listen EINVAL` failures: the former long TMPDIR put restricted fixture socket paths over the platform limit. Follow-up uses a short dedicated `/srv/work/rr...` TMPDIR for all phases, not just Chromium. Other service failures are not assumed inherited: baseline and candidate phases must run on exactly bound source trees and preserve every failure.

The historical gitleaks findings are localStorage-key assignments at `notif-bell.js` line 24 (commit `e4d8da50`) and `apps.js` line 87 (commit `c01bdf7d`). The existing upstream storage-name fix is retained; the additional notification exception is an exact known literal AND exact file, not a file/rule exemption. Logs containing raw scanner material remain private. Exact-head CI, including full-history scanning, is still required.

## Verification boundary

The implementation and synthetic tests have been staged for worker execution; local Node syntax and whitespace checks are not runtime acceptance. Provider-neutral cases include per-agent same-session custody, configured provider aliases, unsafe private mapping refusal, restart/idempotency replay, stale send refusal, next-turn changes versus actual active steering, and contradictory streaming/status runtime rejection. Unknown custom aliases and old routed admissions without a provable transport binding fail visibly rather than infer on a substitute.

The follow-up receipt is diagnostic, not release approval. Remaining gates include real stock-Hermes integration through the adapter, complete native/orb/composer/offline/reload acceptance, in-shell phone/desktop screenshots on two live-changing skins with visual review, all exact-head required checks, live app parity, a disposable actual-entry canary and drain-aware release. Synthetic registry fixtures are not a private-runtime or stock-Hermes proof. No owner threads, defaults, private-agent homes, credentials or running services were changed.
