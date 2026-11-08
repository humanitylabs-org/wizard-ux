# Contributor guide for agents

Entry point is [AGENTS.md](../AGENTS.md); this page holds the commands. Everything here was checked against the code and workflows on 5 Nov 2026. If a command fails, fix this page in the same PR.

## What this repo is, and its neighbours

Wizard UX is the shared phone and desktop front end plus the Android wrapper. It holds no agent state.
- **wizard-agent-service** serves `/wizard/...` (threads, runs, files, read state). Never re-create its state in the shell. Contract changes go service first, UX second, each step backward compatible.
- **wizard-app-manager** installs apps, writes the app registry and cuts OS releases. **wizard-troubleshooter** is the independent repair page; it only borrows the shell's skin and Back when hosted. **Hermes** is the stock agent, reached only through the Agent Service.

## Layout

- `web/core/`: every shared capability, one implementation each; [COMPONENTS.md](COMPONENTS.md) is the inventory (read it first). Settings: `web/core/settings.js`. Skins/Appearance: `web/core/skins.js`, `appearance-host.js`, `app-client.js`; app kit: `web/kit/README.md`.
- Phone shell: `web/index.html`, `web/app.js`, `web/orb.js`. Desktop shell: `web/desktop.html`, `web/desktop/`. Shared transport/outbox: `web/live.js`, `web/outbox.js`.
- `android/`, `ios/`: native wrappers (see their READMEs). `server.py`: small loopback server for voice-to-text and orb routing; not the Agent Service.
- `tests/*.test.mjs`: unit tests. `qa-*.cjs` (root) and `tools/qa-*.cjs`: Playwright suites. `scripts/ci/`: image publication code and its tests.

## Setup, tests, checks

Node 22 (CI) and Python 3. The web tree is plain JS: no install or build step for unit tests.

```sh
npm test                                                   # node --test tests/*.test.mjs
python3 -m unittest discover -s scripts/ci -p 'test_*.py' -v   # the "validate" job
git diff --check
```

There is no lint script. Start the prototype with `python3 server.py` (http://127.0.0.1:9271/, empty data).

Required checks on `main` (read from branch protection on 5 Nov 2026; re-check with `gh api repos/humanitylabs-org/wizard-ux/branches/main/protection/required_status_checks`): **`gitleaks`** and **`validate`**. Other workflows still run on PRs and must be green too. Always read results on the exact PR head SHA.

| Workflow / job | Reproduce locally |
|---|---|
| `publish-image.yml` / `validate` | the unittest line above |
| `secret-scan.yml` / `gitleaks` | Gitleaks 8.30.1 (pinned download in the workflow): `gitleaks git . --config .gitleaks.toml --no-banner --redact --log-opts="$(EVENT=pull_request PR_BASE=<base sha> PR_HEAD=<head sha> sh tools/secret-scan-range.sh)"`. PRs scan only base..head. |
| `reuse-check.yml` / `reuse` | `PR_BODY="$(cat body.md)" BASE=origin/main node tools/reuse-check.mjs` |
| `responsive-features.yml` / `shared-features` | `npm test` |
| same / `tap-outside-closes` | `npm install --no-save --package-lock=false playwright && npx playwright install chromium`, then `node tools/qa-tap-outside-closes.cjs` and `node tests/qa-store-install-deeplink.cjs` |
| same / `opaque-overlays` | Playwright as above, then `npm run test:opaque-overlays` |
| `style.yml` | `python3 tools/style/check_style.py . --policy tools/style/style-policy.json --base origin/main` |

## Reuse block in every PR body

CI (`tools/reuse-check.mjs`) fails a PR without `Reuse:`. One line per capability: `- <capability>: REUSE <entry point from COMPONENTS.md>`, `EXTEND <entry point>` (update its row in the same PR) or `NEW` (add a row in the same PR). A PR that changes nothing under `web/` or `android/` may write:

`Reuse: n/a (documentation only; nothing under web/ or android/ changes)`

Drawn or animated elements also need a `Visual:` line with a side-by-side screenshot. Other app repos use the same gate: [app-reuse-gate.md](app-reuse-gate.md).

## UI rules every change keeps

- **A tap paints on the same frame** and never waits for the backend, a poll or a render guard: update visible state first, reconcile after. Irreversible or external actions show an honest pending state, never early success.
- **Back never exits** (close the top overlay, leave the nested view, return Home, then stay). Tapping outside a sheet, menu or modal closes it through the same path as Back.
- **Appearance v1:** use `--wz-*` tokens, follow live skin changes without losing state, keep a dark standalone fallback. Text-bearing floating panels are **fully opaque** ([OPAQUE_OVERLAYS.md](OPAQUE_OVERLAYS.md)). UI changes need in-shell screenshots on **two skins**.
- **Never drop an existing feature.** Compare against the code that serves today and list what is kept. This repo has no `app-parity-gate`; record your comparison and any gap instead of claiming a pass.
- App workflows, styles and approved behaviour live in the app's own source and release, never only in an agent's notes or an installed copy.

## Browser checks

```sh
npm install --no-save --package-lock=false playwright && npx playwright install chromium
node tools/qa-origin.cjs                       # QA origin on 127.0.0.1:9371 (QA_ORIGIN_PORT, QA_BACKEND_PORT)
WIZARD_ORIGIN=http://127.0.0.1:9371 node qa-brand.cjs
```

`tools/qa-origin.cjs` serves `web/` and forwards read-only requests to a loopback Agent Service; it refuses writes. Suites must also block writes and use synthetic threads, never someone's real sessions. Each suite's header states its own setup (`qa-responsive-parity.cjs`, `qa-appearance-live.cjs`, `qa-instant-ui-taps.cjs`). Phone checks use touch and a mobile user agent; a narrow desktop window is not phone evidence. Unit or fixture passes are not live, installed or device proof. Heavy browser, emulator and Android work belongs on a configured build worker (`WIZARD_BUILD_HOST`, `WIZARD_WORK_ROOT`; see the README).

## How a change reaches users

1. A PR merges to `main`. **Publish public image** (`publish-image.yml`) then builds `ghcr.io/humanitylabs-org/wizard-ux` by digest, attests provenance and writes write-once SHA tags; the `anonymous-pull` job inside `publish-image.yml` re-pulls it after publication. The separate `verify-public-image.yml` checks an existing immutable image on matching PRs or manual dispatch. Publication PRs only validate and build. See `scripts/ci/ghcr_image.py`. Confirm the run on `main` succeeded.
2. Web-only changes need no APK. Native changes need a version bump above the published update feed and a signed build ([android/README.md](../android/README.md)); signing keys never enter the repo.
3. Boxes run plain `main` (Latest); users get Stable after a soak, and `hotfix` skips it (see Team workflow in AGENTS.md). Today's executable OS channel gate (72 h soak, promotion record, `fast_track`) lives in `wizard-app-manager` (`releases/README.md`, `wam/updates.py`); the new policy does not change it until that code does. The GHCR `latest` image tag is not the OS Latest channel.
