# Mobile replies return one thread level

James's job: work through a roundup's linked threads, replying to each and returning to the roundup rather than hunting for it in the index.

Bounded standard repair; direct Hermes implementation; existing shared navigation helper, no schema, new dependency or native build. Base: daily 9a7bcc8. Thales browser QA only, all writes intercepted.

Acceptance:
- Phone roundup → linked thread → typed/composer-mic/orb reply returns one level immediately, retaining parent reading position and draft.
- Nested links unwind one at a time; list-opened threads and new chats return to the list; desktop stays in the replied thread.
- Delivery retains the original target and message. Storage failure restores the sending composer and trail only if navigation has not moved since the send.
- Back remains in the app. Test untouched base, candidate and promoted live assets; ship via PR to daily. No guest rebuild.

Verification: Thales browser A/B uses the extended existing `qa-thread-trail.cjs` with all writes intercepted. Candidate 45/45; untouched base 33 passed and 12 expected failures covering the reported behavior. Independent source review approved the scoped change; strengthened desktop linked-trail setup and delayed transcription fixture from review feedback. The separate legacy `qa-send-leave-timing.cjs` timed out during live-session boot twice and is not a passing result; the scoped suite directly holds enqueue unresolved to prove immediate navigation.

Scope limits: browser phone/touch emulation, not a physical handset check. Orb failure custody remains its existing outbox behavior. Navigation during delayed orb delivery beyond the roundup return is unchanged.
