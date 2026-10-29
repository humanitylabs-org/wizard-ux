# Shared-components reuse gate for app repositories

Add `.github/workflows/reuse-check.yml` (no secrets or app install/build required):

```yaml
name: Reuse check
on:
  pull_request:
    types: [opened, edited, synchronize, reopened, ready_for_review]
permissions:
  contents: read
jobs:
  reuse:
    uses: humanitylabs-org/wizard-ux/.github/workflows/reuse-check-app.yml@main
```

## Private repositories: self-hosted reuse worker

Public app callers keep the snippet above unchanged: the reusable workflow's
`runner` input defaults to the JSON string `"ubuntu-latest"`. Private app callers
must pass the repo-level self-hosted reuse-worker labels instead:

```yaml
jobs:
  reuse:
    uses: humanitylabs-org/wizard-ux/.github/workflows/reuse-check-app.yml@main
    with:
      runner: '["self-hosted","linux","forum","reuse-check"]'
```

Before opening the first private app PR, the installation operator registers its
repo-level runner with `forum-ci-runner-add <repo>` on their control host (see the
installed `wizard-builder` skill for the operator setup). The helper obtains a
short-lived registration token locally; no personal token goes to the runner or
into source. Keep public repositories on GitHub-hosted runners. The input accepts
JSON, not a comma-separated string. Do not move unrelated existing workflows or
build jobs to this lightweight worker. Any inline job in the **reuse caller**
uses the same self-hosted label array.

Self-hosted runners are for trusted private app repositories only. They run as an
unprivileged account without Docker, KVM, libvirt or sudo access, with an aggregate
resource limit separate from other workloads. The gate still executes only the
canonical checker, never PR code; do not add app installs or scripts here. Do not
route public/fork app PRs to this worker. Revisit trust and registration if a
repository becomes public; labels and a shared Unix account are not a sandbox
against malicious workflows.

Every app PR, including CI-only work, needs a `Reuse:` block naming entry points
from [COMPONENTS.md](COMPONENTS.md). Template:

```text
Reuse:
- voice: REUSE WizardApp.capture.start
- chat: REUSE WizardApp.nav.openThread
- orb: REUSE Orb.create
- scroll: REUSE WizAppReadingPosition
```

The reusable workflow reads the caller's base/head diff and wizard-ux **main**'s
inventory and gate, not an app-vendored copy. It never installs or executes app
code and only needs `contents: read`. PR body text comes from the event JSON,
not shell interpolation. Fork PRs need no secrets. `edited` rechecks body changes.
Existing implementations outside added lines are not scanned, and deleted lines
are ignored. Source files are checked wherever the app keeps them, not just web/.

The heuristic guard detects new microphone/recorder capture, chat composers /
transcripts / streaming clients, custom orb renderers and reading-position stores.
It is a guardrail, not an exhaustive semantic/code-security analysis. Branch
protection should require `Shared-components reuse` to prevent merging failures;
workflow installation alone does not change protection settings.

## Shared paths, not app forks

- Voice notes / meetings: `WizardApp.capture.start`, `.pending`, `.ack`; transcription
  of an existing file: `WizardApp.voice.transcribe`; receive the shell's voice input
  through `WizardApp.voiceInput.register`. The shell owns mic choice and routing.
- Agent chat: `WizardApp.nav.openThread(sessionId, {reply})`, never an app composer,
  transcript or streaming transport. The UI kit only supplies looks.
- Orb: `Orb.create(canvas, fallback, {R})`, not another SVG/canvas/spinner.
- Reading place: shell-owned `WizAppReadingPosition`, automatically for hosted apps.

## Explicit NEW exception

A genuine new shared capability belongs in wizard-ux `web/core/` with its inventory
row, not a permanent app implementation. If a staged adapter genuinely needs a
review-visible exception, the app PR must include **both**:

1. `- voice: NEW: Exact new row title` (or `chat`, `orb`, `scroll`, as applicable).
2. A new table row with exactly that title in `docs/COMPONENTS.md` in the PR diff,
   describing its shared entry point and linking its wizard-ux implementation/PR.

The name cannot be an existing canonical row. A generic NEW declaration, a row
mentioned only in the body, an existing row, a code comment or a REUSE declaration
cannot suppress findings. Each NEW exception waives only its named capability;
`voice` cannot hide a duplicate chat. Reviewers must reject app-local forks masked
as NEW. No path allowlist exempts recorder/service apps.
