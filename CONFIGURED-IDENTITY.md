# Configured wizard identity

User outcome: quoted, selected, code-block and full-response shares carry `From` plus the user's configured wizard name. Runtime identity must not be hard-coded to a developer's personal wizard.

Bounded Standard repair, direct implementation; no consequential promotion trigger. Copy remains exact and un-attributed. Generic app share payloads remain unchanged. The shared helper resolves `WizConfig.agent()` at each tap, with `Wizard` as neutral fallback. The same config now supplies spoken-name prefixes to command, search, music and Food parsing; literal escaping and boundaries prevent regex/name-prefix surprises. Native notification/voice identity is a separate Android slice.

Verification on Thales: updated phone/desktop `qa-quote-actions.cjs`, baseline fails the new attribution assertions; candidate 42 passed, zero failed. Includes selected assistant/owner text, live rename, unset name, code sharing, cancellation and clipboard fallback. Focused Node tests `tests/configured-identity.test.mjs` and `tests/autolink.test.mjs`: 17 passed. Tests intercept writes and share calls; no outbound messages sent.

Audit: remaining case-insensitive Archimedes mentions in web production files are historical comments and provenance, not active identity values. Android production identity is being fixed independently. No guest rebuild is required for the web slice.
