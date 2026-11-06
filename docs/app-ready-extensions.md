# App-owned Ready extensions

EXTEND `WizChatsHost.configure/create` and `ready-top` with `WizAppExtensions`.
REUSE the installed Agent Service registry, shell frame ownership, app opening,
Back and canonical list renderer. Domain writes, validation, status, retry and
recovery belong in the app repository, not core.

A fresh `source: apps.json` entry with `provides: [ready-extension]` admits trusted
same-origin code. This is owner-installed code, not a sandbox. A launcher link
or cached app list does not admit it. The app's non-root URL directory serves
`ready.json`: contract `wizard.ready-extension/1`, `module_sha256` and
`style_sha256` (lowercase SHA-256). The host imports `shell.js?sha256=<digest>`
and styles `shell.css?sha256=<digest>`. The app must reject requests whose exact
bytes do not match the digest. This binds a deployment revision without adding
an app-specific route or field to core or the installed registry.

The module exports the same `contract` and a default factory. Its instance owns
`html`, `poll`, `write`, `handle` and `dispose`; optional `busy` defers replacement
while app-owned writes settle. It receives `installed`, `authorize`, `changed`,
`open`, and `toast`. `authorize` requires the exact connected shell-owned frame,
its current document and same-origin app path. Callers use generic
`WizardApp.readyExtension.write(kind, input, before, {onAdmitted})`; domain kinds/bodies stay
opaque to the host. Browser-supplied trusted message origin/source admits the exact frame, not a caller-provided WindowProxy. Admission acknowledgement permits Back without waiting for the backend. Removed grants revoke admission immediately. Superseded
metadata/imports cannot resurrect them. Updates use a new content-addressed
module and dispose its old listeners/styles after pending custody settles.

Tests: `app-ready-extension.test.mjs` executes the host with transport-boundary
stubs; `app-finish-back.test.mjs` retains generic Back guards. These do not claim
real-browser or App Manager installation proof. Run those on the isolated worker
before live cutover.
