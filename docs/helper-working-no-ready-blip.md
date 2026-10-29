# Keep helper handoffs in Working

## Ownership

- REUSE: the Agent Service's list projection (`status: running`, `waitingOn: helper`) and existing `groupWork`/Chats classification.
- EXTEND: `web/live.js`'s existing `sessionInfo` merge; preserve list lifecycle when detail omits status.
- NEW: no runtime component or API. Add executable regression coverage around the existing client.

## Failure and fix

The list correctly says Working after a parent finishes while its helper runs. Hermes's detail response ordinarily has no `status`. `normalize` turns that omission into `undefined`, and `sessionInfo` used to assign it over the list row's `running`. The grouping predicate then puts the same thread in Ready until another list poll restores it. Both opening a thread and background transcript preload can hydrate detail. Partial-list merges can retain that overwritten row when it is absent from the newest page.

Copy a detail status only when one is actually supplied. This preserves explicit retry failures and provider-sign-in waits, does not lengthen the two-minute send hold, and leaves the server responsible for deciding when the helper's result has been answered.

## Evidence

A disposable real thread ran one background delegate and immediately replied `TEST HANDOFF`; the delegate later returned and the parent replied `TEST RESULT ANSWERED`. Its recorded list/detail responses were replayed through the full serving client in jsdom with a simulated phone outbox send. Before: hydrating detail changed `running` to absent status, Working=false, Ready=true while the delegation was running. After: hydration, repeated list/detail reads and send-hold expiry all stayed Working; the real answered response moved it to Ready. The test thread was archived and read back. Raw response recordings remain private, outside this repository.

The server monitor recorded no `FLIP_BAD` during this investigation. This demonstrates a client-only failure; it does not prove that a separate server projection/cache failure is impossible, or that this was the exact event on the owner's uninstrumented handset.

## Checks

```sh
node --test tests/helper-working-no-ready-blip.test.mjs tests/send-working-race.test.mjs tests/space-members.test.mjs tests/provider-access-wait.test.mjs tests/archived-working-threads.test.mjs
```

The new test executes the full `web/live.js`, not a reimplementation of the merge. It covers the turn-end race, a detail request crossing a list refresh, the helper returning before the parent answers, partial-list reuse, send-hold expiry, main/host-profile/container/restricted rows, explicit retry failure and queued sign-in wait. To run the regression against an older client:

```sh
WIZARD_LIVE_SOURCE=/path/to/baseline/web/live.js node --test tests/helper-working-no-ready-blip.test.mjs
```

No live service/shell deployment, handset verification, full browser matrix or full repository test suite was performed for this isolated fix. No service change or Android rebuild is needed. Apply the fix commit onto the current live shell branch, preserve any concurrent changes, run these checks and the normal release checks, then reload the phone shell. Its service worker is network-first and does not cache scripts.
