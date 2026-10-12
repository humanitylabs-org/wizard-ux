# Delivered-but-unanswered helper recovery regression

`qa-helper-delivered-recovery.cjs` runs the unchanged UX against the actual Agent Service HTTP list and Continue handlers. It uses a small, explicit SQLite fixture and a mock Hermes transport; this is **not live agent execution or deployment evidence**.

The fixture reproduces a completed, `delivered` delegation, a genuine owner steer before completion, its completion message, a later assistant FYI, and no active lease/run. The upstream list deliberately says `completed` so the service must correct it rather than the test manufacturing a Working row.

Run on Thales with isolated state:

```sh
export PATH=/opt/homebrew/bin:$PATH
export HERMES_HOME=/Volumes/ThalesMedia/wizard-qa/helper-status-release-20261012/isolated-hermes
export TMPDIR=/Volumes/ThalesMedia/wizard-qa/helper-status-release-20261012/tmp
export WAS_ROOT=/Volumes/ThalesMedia/wizard-qa/helper-status-release-20261012/delivered-recovery
export QA_WEB_DIR=/Volumes/ThalesMedia/wizard-qa/helper-status-release-20261012/delivered-ux/web
export QA_OUT=/Volumes/ThalesMedia/wizard-qa/helper-status-release-20261012/evidence/delivered-native-green
node qa-helper-delivered-recovery.cjs
```

Both phone and desktop must:

- Receive `status: running`, stalled helper status, returned count 1 and `resumeEligible: true` from the real HTTP list.
- Place that row in actual `WizLive.workGroups().working`, show the existing Working receipt and a visible, touch-sized Continue button.
- Send the intercepted Continue through real HTTP admission, receive 202 and make exactly one **native model-locked** `/api/sessions/<fixture>/chat/stream` dispatch, zero unlocked `/v1/runs` dispatches, and the original `wizard-helper-receipt-deleg_review` identity.
- Read back integrating/non-resumable status and remove repeat Continue, with no browser runtime errors.

All browser writes are intercepted. The static origin also refuses non-GET/HEAD service requests. Only the intercepted Continue naming the exact fixture session is forwarded to the isolated test service; read receipts and other writes are blocked. No live backend or data is used.

Before repair, the same script against backend `d43501a99f5f63421199a5be6f35001fc911d223` fails with `completed`, Working false, zero Continue buttons and HTTP 409. Thales evidence lives under `/Volumes/ThalesMedia/wizard-qa/helper-status-release-20261012/`: `delivered-native-red.log`, `delivered-native-green.log`, and `evidence/delivered-native-{red,green}/` (screenshots and green JSON receipt). Backend normal Vitest and native lock receipts are `delivered-full.log` (289 passing) and `delivered-lock.log` (9 passing).
