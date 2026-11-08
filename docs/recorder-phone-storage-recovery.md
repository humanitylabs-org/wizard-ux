# Phone Recorder storage recovery

## Evidence and cause

The 6 November Android diagnostics show readonly/write transactions rejected at
1501–1525 ms while origin usage was 104–139 MB against roughly 10.8 GB quota.
That matches our unconditional 1500 ms abort, not a quota failure. A synthetic
1800 ms transaction reproduces it in both modes. The old transaction wrapper
kept the same connection after abort/backend failure, with no transient retry;
an unexpectedly closed connection also remained cached. A transient failure
therefore became a persistent Recorder backup failure instead of a fresh open.

`recoverLocked()` previously left an earlier `recoveryError` in place when called
directly by capture start, even after a healthy read and native ownership check.
`recover()` also requested this page's already-held microphone lock on every
pending refresh. The live diagnostics normalized `busy` through `storageFailure`
to `UnknownError`; phase `lock` with `heldLocks: 1` does **not** establish an
IndexedDB or Web Locks backend error. Genuine Web Locks UnknownError is now
retried once, but real busy ownership is never stolen or retried.

## Changes and safety

- Give IndexedDB opens/transactions 5 seconds, separate from instant Send's
  existing short UI bound. Abort a timed-out transaction, forget and close the
  failed connection, then replay once only for timeout, UnknownError,
  AbortError or InvalidStateError. All callers use stable keys/atomic writes or
  replace read snapshots, so replay cannot double-count saved bytes.
- Forget unexpectedly closed connections. A stale connection event cannot clear
  a newer connection promise. Late transaction callbacks cannot acknowledge an
  aborted save. Quota/security failures are not retried or acknowledged.
- Clear stale recovery errors only after a successful session read; native
  uncertainty can set its own error again. Skip recovery's self-lock request
  during active capture, and let idle recovery accommodate reopen/retry I/O.
- Preserve optional native backup, automatic native reattach, strict ordinary
  recording durability, voice microphone loans and existing Reload safety.

## Retention is not a safe target for speculative deletion

The app already acknowledges a stopped native backup after domain readback
(`SharedMeeting.acknowledge()` in the installed Recorder), and shared
`ack()` atomically deletes its sessions row and indexed chunks. The regression
suite exercises this deletion and rejects acknowledgement while live. The
observed growth during a live meeting matches retained 16 kHz PCM, not proof of
an orphan leak. `rows()` reads session metadata, not audio blobs.

Android's state bridge exposes `pendingChunks`, but no acknowledged contiguous
media watermark. A count of zero can precede an open native file's upload, and
Stop/stopped is not a receipt. Do not prune live chunks, old unknown backups or
ordinary voice notes based on age, queue count or native Stop. Adding incremental
pruning requires a verifiable per-meeting acknowledged range from the uploader;
that is not present in the current Android build and this fix does not invent it.

## Regression proof

Run `tests/capture-phone-storage-recovery.test.mjs` with `CAPTURE_SOURCE` pointing
at a previous `app-capture.js` to reproduce the failures without modifying the
checkout. The fixture uses virtual time and atomic fake transactions; no private
phone audio or live IndexedDB data is used. The previous main passes 2 and fails
12 of its 14 cases; the fix passes all 14. Existing reload, audio custody,
instant-capture, start-policy and mic-loan checks must remain green.
