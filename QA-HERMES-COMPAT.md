# Hermes v0.22.1 control UI acceptance

Companion: Wizard Agent Service `feature/hermes-0221-compat`, `scripts/acceptance/README.md` for the authoritative compatibility and rollback contract.

The UI uses only controls actually returned by the run. Legacy `approval` retains the old `{choice, request_id}` body. Canonical `pending_controls` require the displayed prompt ID and execution generation. Unknown recovery requires `features.run_unknown_resolution`; old runtimes receive no automatic recovery call. No clarification capability flag is invented.

A button carries a rendered identity key. Its async result may affect only that prompt, run, thread and navigation generation. A stale response refreshes the prompt without answering the next one or claiming success. The composer draft remains separate from approval/clarification fields. Unknown state remains Needs recovery even when a later local outbox reply is pending.

## Reproduce on the build host data volume

```sh
export PATH=/opt/homebrew/bin:$PATH
export TMPDIR="$ACCEPTANCE_ROOT/tmp"
mkdir -p "$TMPDIR" "$ACCEPTANCE_ROOT/evidence"
npm install --prefix "$ACCEPTANCE_ROOT/browser" --no-audit --no-fund playwright-core
cd "$UX_SOURCE"
PLAYWRIGHT_MODULE="$ACCEPTANCE_ROOT/browser/node_modules/playwright-core" \
QA_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
QA_OUT="$ACCEPTANCE_ROOT/evidence" node qa-hermes-compat.cjs
npm test
```

The browser fixture runs the actual shell at 412×892 with all network routes intercepted. External optional scripts are empty in this fixture. It is **synthetic transport**, not a real account. It proves settled phone fit, stale displayed recovery identity, retained draft, no automatic recovery resubmit, canonical approval body, delayed stale response and second-view conflict, clarification endpoint/body, legacy approval, stop409 state, and Back staying in the app. Evidence includes `browser-receipt.json` and `unknown-phone.png`; wait for the carousel to settle before judging screenshots.

Shared source activation remains a parent-review step. These are web-only changes: deploy the existing static shell, no APK/DMG/VM guest rebuild. WAS must be rolled out with the companion compatibility adapter before canonical controls are relied upon. Existing open tabs are served by the backwards-compatible server routes and can reload to acquire the new controls.
