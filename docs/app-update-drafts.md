# App drafts and shell Reload

REUSE the existing `WizardApp.update.hold` / `release` contract. EXTEND a hold with an optional app-owned keeper; no second persistence service.

```js
const hold = WizardApp.update.hold('Editor unsent draft', {
  keep: async () => {
    // Persist in this app's storage/server and read back the exact current state.
    return await persistAndVerifyCurrentDraft() ? 'kept' : false;
  }
});
// On EVERY edit: release this hold and acquire a new one with the current keeper.
hold.release();
```

A user-requested Reload asks all keepable holds concurrently. The shell allows at most 1.5 seconds and skips a hold only for exactly `'kept'`, from the original authorized document, while that same hold is still registered. Failure, no callback, timeout, another value, a replaced document or a newly acquired hold keeps blocking. Late confirmations cannot admit reload. A kept hold stays registered until its owner releases it; reacquiring on every edit invalidates old confirmations. Do not capture an out-of-date snapshot in the callback.

The direct same-origin facade and the existing postMessage transport implement the same contract.
The installed-app Reload button also calls the existing keeper, scoped to its own frame. Its frame-hold projection omits only confirmed drafts; other app holds and new edits remain visible. A frame/document change or dismissed notice while keeping cancels that click's navigation. Only the registered frame/document may acknowledge its unpredictable preparation challenge. The shell receives confirmation, not the text. Storage failures must never be reported as kept.

Use ordinary holds for sends/saves until their network result is confirmed, and for all recordings, unsent voice takes, audio in memory and capture work. Audio-labelled holds cannot opt into draft keep. No keeper means the original hold behavior. A successful draft keep does not waive another app, host work, capture uncertainty, active audio or the final pre-navigation safety checks.

Persist small text drafts on each edit as well as on keep, restore on app load, and clear them only after an acknowledged send or explicit owner discard. App-origin storage must be namespaced to the app; the shell never reads it. Do not write attachment blobs into localStorage; retain their existing durable server/IndexedDB or blocking-capture workflow.
