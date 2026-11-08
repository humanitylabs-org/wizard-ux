# App-declared home-screen capabilities

## Rollout correction (#892 P1)

Retain the existing shared-main exact-script legacy cleanup migration until an installed app declares `home_screen.offline`; the generic declaration check then refuses cleanup. The earlier removal in this PR was premature: shell and companion app updates are not atomic. The feature-ID inventory for `web/core/apps.js:wisdom` therefore retains shared main's existing six occurrences, instead of this PR's premature reduction to three. This adds no app dispatch, changes no scanner rule and creates no broader allowance. Tests cover pre-declaration cleanup, declared-offline refusal, and root/replacement-worker confinement.

The shell holds **no per-app capability table**. Reviewed historical cleanup migrations are not capability declarations. An installed app opts in itself in `wizard.md`:

```yaml
home_screen:
  offline: true                    # a home-screen pin of this app may open with no connection
  position_keys: ["myapp:*:pos:*"] # localStorage keys that hold SCREEN position (kept per pin)
  route_state: myapp               # history.state key the app restores its own route from at boot
```

The chain is the same as `voice_names`: `wizard.md` -> App Manager `apps.json` -> Agent Service `/wizard/v1/apps`
-> `WizCore` tile (`homeScreen`, sanitized once by `core/home-screen-capabilities.js`). Spec: wizard-os
`spec/WIZARD_MD.md` ("Home-screen pins").

| Field | What the shell does with it | Without it |
|---|---|---|
| `offline` | Publishes the app id to the shell worker (`core/offline-session.js`), prepares the small `app-session.html` host before mount, keeps route + reading position in the app's own `WizOffline` replica (`<id>-offline-v1`) with strict durability, never unregisters the app's own worker | A pin needs a connection, exactly as before |
| `position_keys` | Re-homes those keys per pin so a pin's reading position never overwrites the in-workspace one; content and preferences stay shared | Shared storage, no re-homing |
| `route_state` | Skips the synthetic `popstate` replay for that state key (the app rebuilds its route itself) | `popstate` is dispatched |

Rules the code enforces: strict booleans; patterns need 3 literal characters before the first `*` (an app cannot
claim keys it does not own by pattern alone); at most 8 patterns; unknown or malformed values yield no capability.
`offline` also requires the app to keep its data in a `WizOffline` replica named `<id>-`.

**Failure signal.** If the durable journal cannot save (quota, blocked, no strict durability), the shell dispatches
`wizard:presentation-save-failed` on the app window. The app shows its own quiet inline notice; the shell never
pops anything up.

**Worker.** `tools/build-offline-session.py` generates `core/offline-session-config.js` (no app ids). The worker
serves the fixed `app-session.html` for `/wizard-os-home/?app-session=<id>` only when `<id>` is in the published
snapshot (cache `wizard-os-home-registry`), otherwise it passes the request to the network untouched.
`python3 tools/build-offline-session.py --check` fails CI when the generated file is stale.

Reuse: REUSE `WizOffline` (replica, outbox, `presentation`), `single-app-session.js`, `WizAppServices`. EXTEND
`offline-sw.js` (navigation fallback) and `home-screen-policy.js` (declared storage). NEW only the validator
`home-screen-capabilities.js` and the snapshot publisher `offline-session.js`.
