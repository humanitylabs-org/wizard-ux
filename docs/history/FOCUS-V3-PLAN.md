# Chats Focus v3

- REUSE: WizCore Chats section renderer, toggleSection and persisted section state; Focus must not force sections open.
- EXTEND: Chats winAgent/modelRoute for focused-agent new-chat routing in existing phone/desktop voice adapters. Keep explicit app-item main-agent routing and private thread custody.
- REUSE: WosAgents.colour/distinctHues for tab identity and list tint, Appearance tokens for surfaces.
- EXTEND: existing Focus strip CSS with a 32px visual pill inside a 44px button hit target.
- EXTEND: qa-chats-focus.cjs with base/candidate transport interception, collapse persistence and visual geometry assertions; retain existing tests.
- Verify: candidate/base fixture QA, live-read regressions with write fences, Dark/Nebula phone and desktop screenshots, live integration worktree QA; ship non-merge commits to existing PR and live branch only.
