# Phone–desktop sync repair (candidate only)

Base: live UX c0120f8e7c9a81ed3bf61cfa3ebbfc206c615ef1; Agent Service was-e689ea890b8fb034d28499ecaa3fa33ad0c6dd8d.

Reuse:
- REUSE WosLookSync and the versioned Pages API; no new service, storage, skin editor or sync engine.
- EXTEND WosExperience/WosLookSync to share the safe built-in tweak switches, independently of colour and personal script approval.
- EXTEND existing shell sessionList adapters to preserve inventory across the day/status grouping projection.
- NEW none.
Visual: existing Appearance v1 surfaces unchanged; queued acceptance must inspect both real shells on two skins, preserve drafts/forms/navigation, and prove opaque text panels. No physical-phone claim from Android-UA browser coverage.

Confirmed source faults:
1. Release-wide switches (notably wizard/unified-inbox) return before the shared-choice event, are excluded from tweakIds, and are ignored by adopt. Two devices can show different notification/meeting-summary inventories indefinitely.
2. Look sync reads only at startup/foreground/network events; a desktop kept open does not see phone choices until another event. Add one bounded, stopped-with-controller foreground refresh timer to the existing engine.
3. Alternate shell sessionList exports only Working, Ready, Snoozed and Archive while workGroups also returns Errors, Yesterday and Past week. Non-archived rows in those groups disappear from the alternate view and its search. Preserve these as Ready in its status-only vocabulary, leaving stock day grouping and backend disposition unchanged.

Evidence boundary: Main sync exists in the main sessions API and was Ready at inspection. No affected desktop browser localStorage/screenshot was available. These confirmed defects can explain missing inventories, but do not prove the exact physical device trigger. No content from private agents, Messenger or Recorder is used.

Acceptance (parent-admitted forum run, never VPS): new regressions fail on pinned baseline and pass on candidate; all affected existing suites; isolated real desktop + Android-UA contexts on one synthetic backend, same complete inventory including Main sync and a meeting-summary notification, arbitrary agent identifiers, no agent writes; two skins through real controls, pending I/O, retained draft/form/navigation, screenshots; soak for added timer; app-parity-gate against freshly re-read live source before any later promotion.

No deploy, merge, live preference write, or physical-phone install is authorised in this task.
