# Desktop Chats sidebar search

The expanded left-sidebar search, folded-rail search and Alt+K are contextual Chats controls. They return conversation threads only. Installed apps (including Browser) belong in the global Ctrl/Cmd+K launcher, not in these results. Phone AI apps drawer search is a separate contract and is unchanged.

Reuse:
- Conversation projection/actions: REUSE WizCore Chats, `WizChatsListModel.sessionList`, the existing desktop `api.sessions.list()` projection and `chatRow` renderer/actions.
- Title matching: REUSE AI apps `parts.js` matching against the existing locally projected conversation titles. No new search engine, network dependency, body search, archive-index loader or sort policy.
- Browser fixture: REUSE `tools/qa-closed-shell.cjs` and `tools/qa-playwright.cjs`, with only synthetic sessions and an explicit installed Browser/app-only control.

## Regression checks

- `node --test --test-name-pattern='desktop contextual Chats|phone search still covers' tests/ai-apps-view.test.mjs`
- Browser: `QA_TREE=<exact-source-root> QA_OUT=<fresh-evidence-directory> QA_PLAYWRIGHT=<module> QA_CHROME=<binary> node qa-desktop-chats-thread-search.cjs`
- Set `QA_EXPECT_RED=1` only for the exact pre-fix tree. A valid red receipt must say `expected-product-failure`, with the specific zero-app-recommendations assertion after a clean boot, the installed Browser positive control and multiple rendered thread matches. A timeout, missing control or unrelated error is not a product red.

Run browser/behavior verification through the finite forum queue runner, never on a live owner origin. Its matrix covers same-input-task local matches, installed Browser plus matching threads, app-only and no-match Enter, clear/Cancel/Back, folded rail and Alt+K, exact archive click/first-result Enter, preserved global app ranking and classic Chats, live Nebula→Signal change, and adjacent phone captures on both palettes. Inspect all retained screenshots before acceptance. No CSS changes are made by this fix; the existing Appearance and dark fallback implementation is retained byte-for-byte.

A prepared queue spec is not a browser pass. Retain source/archive hashes, exact failed/passing receipts and the request/error journals; do not deploy or claim device acceptance from staging. Existing archived-title/body-search coverage is unchanged: the contextual adapter still searches the existing session-list projection, not `WizLive.searchRows()`'s larger slim title index.
