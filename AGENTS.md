# Agents working on wizard-ux

Wizard UX is the front end of Wizard OS everywhere: the phone web shell and Android app (`ai.wizards.os`), and the desktop shell. It is one codebase with two shells. Shared code lives in `web/core/`. Read the team rules below before you start.

## This repo

- **`main` is what James runs.** Until 19 Oct 2026 it was named `daily`. Older notes, `BRANCHES.md` rows and QA comments that say `daily` mean `main`.
- **Checks:**
  - `npm test` must pass.
  - PRs need the `gitleaks` and `validate` checks green.
  - For any change touching `web/core/` or the phone shell, run the matching `qa-*.cjs` browser suite and report both baseline and candidate results.
- **Publishing:** merging to `main` triggers the **Publish public image** workflow, which publishes `ghcr.io/humanitylabs-org/wizard-ux`. Confirm the run succeeded.
- **Android:**
  - Native changes need a version bump above the published update feed.
  - Signed APKs are built and signed on the Mac build host, which holds the signing key.
  - Web-only changes need no APK.
- **Back never exits.** Android and browser Back always take one step back inside the app: close the top overlay, then leave the nested view, then return to Home. At Home, Back stays put. In a plain browser tab, the first Back at Home shows "Press back again to exit", and only a second Back within about 2 seconds may leave. Every Back change ships with a test that opens a nested view, presses Back, and asserts the app is still open.

### Shared responsive feature contract

New cross-platform UX belongs in `web/core/`. Register it once, and both shells render it. A shell adapter may own layout, navigation and input (touch and the orb on the phone, keyboard and window manager on desktop). Each feature's markup, state and action dispatch exist once, in `web/core/`.

- **Settings:** add one `WosSettings.register({ id, html, act, aliases?, available? })` in `web/core/settings.js`, or in a shared module that both entrypoints load. Both mounted layouts render new registrations automatically. Deep links route through this same registry, so they need no separate shell route branches.
- **`available`** gates real browser, OS or native capabilities, and never viewport width. When the hardware lacks a feature, hide it or say honestly what capability is missing.
- **Styles:** shared control styles live in `web/core/settings.css`. Responsive geometry belongs in media or container rules. Keep `polish.css` free of desktop copies and `styles.css` free of phone copies.
- **Parity guard:** `npm test` runs it. It checks both entrypoints and the full core-module inventory, and exercises a synthetic feature registered once in two mounts. Adding a general-purpose module to only one entrypoint fails the test.
- **Exceptions:** existing exceptions and open gaps are recorded in `docs/responsive-feature-inventory.json`. An exception is not proof of parity, and it does not waive a newly requested cross-platform feature.
- **Browser QA:** run `qa-responsive-parity.cjs` against live GET APIs plus `QA_SOURCE`, with every production write blocked. Verify:
  - phone touch and desktop;
  - keyboard and focus;
  - nested and root Back;
  - drafts and recordings that must survive;
  - agent scope;
  - the real styling of hosted apps.
- **Claiming parity:** an import test alone never proves universal parity. Whether a feature is reachable, whether its actions work, and native-specific limits all need runtime evidence. A screenshot-only or mocked-API-only pass does not count.
- **Concurrent work:** when integrating, preserve voice-custody work that is in flight on other branches.

### Skins: build your own look (James, 18 Oct 2026)

- **James's skins:** Nebula (the default), Grove, Tide, Ember and Signal, together with the base shell look in `web/core/base.css` (palette and body font).
- **Your own look:** collaborators ship UX features and fixes as usual. A different look, palette, font or card style goes into a new skin of your own: a `SKINS` entry in `web/core/skins.js` plus `html[data-skin="<yours>"]` rules. Obsidian and Landscapes are working examples.
- **What stays as it is:** James's five skins and the shared base. Scope fonts to your own skin, rather than to `body`, `.win` or controls.
- **The guard:** `tests/owner-skins-guard.test.mjs` fingerprints James's skins. It fails on any change to them, and on any shell-wide font rule. `tests/fixtures/owner-skins.json` changes only with James's explicit approval, named in the commit message.

<!-- wizard-os-team-rules v2 (19 Oct 2026). Same text in every Wizard OS repo; the canonical copy is humanitylabs-org/wizard-os AGENTS.md. Change it there first, then copy the block to every repo in one round of PRs. -->
## Wizard OS team rules (identical in every repo)

Wizard OS is built by James, Jan and Miguel together with their agents. Archimedes commits as `defleur-agents` and Oscar as `oscarhenrycollins`. Every repo belongs to Wizard OS as a whole, and no repo belongs to one person. Make the change that is best for the whole system, and build on each other's work.

### Branches

- **`main` is the trunk in every repo.** It is what runs live and what releases are built from. `main` changes only through a merged pull request. Nobody pushes, force-pushes or rewrites `main` directly.
- **Start every change from a fresh `main`:**
  ```sh
  git fetch origin
  git switch -c fix/short-purpose origin/main
  ```
- **Name branches by purpose.** Use one of these prefixes:
  - `feature/`: new behaviour.
  - `fix/`: a bug fix.
  - `docs/`: documentation only.
  - `spec/`: a contract or decision change, in wizard-os.
  - `release/`: a version bump or release snapshot.
  - `integration/`: combines several branches for testing together.
  - `evidence/`: test evidence only.

  Write the rest in lowercase words joined by hyphens. A date suffix like `-20261019` is fine. People's names stay out of branch names.
- **Push after every commit:** `git push -u origin <branch>`. Work that exists only on your machine is invisible to the rest of the team.
- **One branch per change.** Leave other people's branches as they are. To build on someone's branch, branch from it and open your own PR.
- **Old branches are history.** Only `main` and the open PRs are current.

### Pull requests

- **Say what kind of change it is.** Every PR gets exactly one tier, shown both as a label and as the start of its title. This lets anyone triage a list of PRs at a glance.

  | Tier | Label | Title starts with | Means |
  |---|---|---|---|
  | Bug fix | `tier: recommended fix` | `Recommended fix:` | Something is broken and this makes it work. It must land. |
  | Improvement | `tier: strong suggestion` | `Strong suggestion:` | A clearly better behaviour or a new capability. Feel free to drop it. |
  | Personal preference | `tier: opinionated` | `Opinionated — feel free to drop:` | Taste: look, layout, gestures, wording, or how you like to work. In the shell it belongs in your own skin (below). |
  | Maintenance | `tier: maintenance` | `Maintenance:` | Docs, releases, CI, tests or refactors with no change in behaviour. |

  Optional labels:
  - `priority: 1` (review first), `priority: 2` (review next) and `priority: 3` (when there is time).
  - `needs: james review`: the PR waits for James to accept it or drop it.
  - `preview only`: an experiment that must not be merged.
  - `from: <where it already runs>`, for example `from: miguel test port`: the change is already in daily use there.

  Use the same tiers for issues.
- **Open the PR once your first commit is pushed.** Use a draft until it is ready: `gh pr create --base main --draft`.
- **Keep each PR to one change** that a reader can follow in a few minutes. Split unrelated fixes into separate PRs.
- **Title:** after the tier prefix, state the outcome in plain words ("Recommended fix: threads open instantly from the on-device cache"), rather than the mechanism.
- **Body:** fill in the PR template. Write it for someone opening it cold:
  1. **What and why:** what changes for the user or the system, and the problem it solves.
  2. **Verified:** the exact commands you ran and their results. Add runtime evidence (a live box, screenshots or a short recording) wherever behaviour changed. For a bug fix, show the new test failing before the fix and passing after it.
  3. **Not checked:** what you could not verify, and why.
  4. **Links:** related issues, the matching PRs in other repos, and the decision or spec this change follows.
- **If `main` moves while you work,** merge `origin/main` into your branch and re-run the checks.

### Merging

- **The author merges their own PR** once three things hold:
  - the required checks are green;
  - the Verified section reflects real results;
  - nothing in the PR needs a decision (see the next section).

  There is no wait for a human approval.
- **What each tier means for merging:**
  - **Recommended fixes and maintenance** merge on those conditions.
  - **Strong suggestions** merge on them too, unless they change something James sees or uses every day. In that case add `needs: james review` and wait.
  - **Opinionated changes** to the shell's look or UX go into your own skin: wizard-ux `web/skins/<yours>/` plus your `SKINS` entry (see wizard-ux `web/skins/README.md`). A PR that only touches your own skin merges on the conditions above. Never add a Settings toggle or core code for one person's taste.
  - **Making something the default for everyone** (any opinionated change outside your own skin) carries `needs: james review` and waits for James. Bring it once you have used it in your skin, with a preview he can try.
  - **`preview only`** PRs never merge.
- **Use "Create a merge commit"**, then delete the branch.
- **After merging anything that publishes or deploys,** confirm that the workflow run on `main` succeeded.

### When a change needs a decision

Decide and merge yourself, except when the change:

- reverses a locked decision in wizard-os `docs/DECISIONS.md`;
- changes a contract in wizard-os `spec/` that other repos depend on;
- changes James's skins (Nebula, Grove, Tide, Ember, Signal) or the base shell look;
- deletes user data, rewrites history, or is otherwise hard to undo.

For those, open the PR or an issue and explain the choice in one paragraph. Then:

- **If James decides:** add `needs: james review`.
- **If another agent's side has to act:** assign that agent's account. GitHub's Assignee field is used only for this.

Carry on with other work while you wait.

### Changes that span repos

1. Change the contract first, with a `spec/` PR in wizard-os.
2. Land the code PRs in dependency order: the service before the UI that calls it.
3. Keep each step backward compatible, so `main` works in every repo at every point.
4. Link the PRs to each other.

### Releases

Anything shipped, tagged or handed to a tester is built only from commits already on GitHub. Release notes name the repo, branch and commit.

### Safety

- **Keep secrets and private data out of commits.** That covers keys, tokens, passwords, `.env` files, personal data, real conversation content, owner hostnames and home-directory paths. Put these in config or environment variables. Private repos are still visible to every org member.
- **Hermes, the agent harness, stays stock.** Wizard behaviour goes in the Agent Service, the App Manager, Wizard UX or an app.
- **Run this repo's checks before opening a PR.** They are listed under "This repo" in this file.

### Where work comes from

Pick up work from the open issues in this repo and from wizard-os `docs/WORK_OUTSTANDING.md`. For how the pieces fit together and what is already decided, read wizard-os `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.
<!-- /wizard-os-team-rules -->
