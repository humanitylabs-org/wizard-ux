# Styling-author handoff

Candidate only: `/home/telos/worktrees/wos-app-styling`, branch `preview/app-styling` from `c5e7ed2607aa43bb94788e9eae48608597d9b2b5`.

## Result

Claude CLI authored all four frozen fixtures, their CSS/interaction JS, Preview controls, isolated boot and candidate index wiring. Wisdom retains the exact Georgia/Iowan Old Style/Charter/Times New Roman serif stack, editorial library, paged reader; Music keeps shelves/search/mini-player; Signal keeps timeline/filter/nav anatomy; Topics keeps edition cards and three panes. Unified/original compare identical content and typography through palette variables. Read-only sample disclosures are explicit; simulated music uses no audio or requests.

## Actual model evidence

Both calls used `HOME=/home/telos`, `--model claude-opus-5-5 --effort high`, only Read/Write/Edit/Glob/Grep, acceptEdits, strict empty MCP config, no persistence, JSON output, memory-bounded systemd scopes. Round 2 additionally bounded turns. Raw response files confirm `canonicalModel: claude-opus-5-5`, `provider: firstParty`, success, no permission denials. CLI did not execute browsers/builds and correctly did not claim it did.

- `docs/evidence/cli-invocation.json`
- `docs/evidence/opus-round{1,2}-prompt.md`
- `docs/evidence/opus-round{1,2}-response.json`
- `docs/evidence/model-evidence.json`
- `docs/evidence/opus-design-notes.md`
- `docs/evidence/opus-round2-review.md`

Round 1 received actual app sources + screenshots. Round 2 received ten actual implementation screenshots and made one targeted CSS correction: mobile Preview pill moved to the left so the host staging badge no longer obscures it. No GPT-authored app styling.

## Verification performed

Bounded browser renders/smokes ran remotely on `thales.local` with Chrome and playwright-core against the parent's already-created private isolated service. No server/proxy/staging registration or deployment was made by this worker.

- All four fixtures load inside existing shell; all receive acknowledged theme bridge state.
- Nebula, Paper and Original screenshots for all four; desktop preserved phone-shell render.
- No horizontal overflow at 393x850 (iframe width and scroll width both 371).
- No browser errors, no write requests.
- Native Back: Wisdom reader -> library, h1 changes, shell stays open, root hook false.
- Revised Preview pill is reachable by a real tap; sheet contains all six named skins, comparison, four app shortcuts and Architecture.
- Architecture opens as a shell link frame without leaving root.
- Paper reader body captured on page 3/6: serif computed Georgia/Iowan/Charter/Times New Roman, text rgb(29,27,23), reader surface #fffdf8.
- Reader text unchanged across comparison toggle.
- Seven owned JS files pass `node --check`; `git diff --check` passes.
- Actual app source snapshots still match live source files byte-for-byte. app.js/orb.js/styles.css/core/apps.js unchanged from candidate HEAD; skin JS/CSS copied exactly from yesterday's source.

Receipts/images: `docs/evidence/final-shell-shots/{shell-render-receipt.json,final-controls-receipt.json,*.png}`. First-pass images sent back to Opus: `docs/evidence/round1-shell-shots/`. Repro scripts: `docs/evidence/{shell-render.cjs,final-controls.cjs}`. Remote artifacts: `/Users/thales/.hermes/cache/scratch/wos-app-styling-evidence/`.

## Owned deliverables

- `web/demo/apps/{wisdom,music,signal,topics}.{html,css,js}`
- `web/demo/apps/shared/fixture.js`
- `web/demo/apps/assets/*.jpg` (six permitted real source portraits)
- `web/demo/preview-{boot.js,controls.js,controls.css}`
- `web/index.html`
- `web/data.js`, `web/summaries.js`: empty fixtures, **gitignored**; parent must include deliberately if committing/packaging candidate.
- `web/core/skins.js`, `skins.css`, `skins/*.woff2`: exact copied assets, no modifications.

Parent-owned theme bridge/UI/architecture/server/QA files were not modified.

## Remaining caveats for parent QA

1. Staging server injects its yellow marker both at shell level and inside app frames. Remove the iframe copy (parent server only): it crowds reader title/controls. Opus deliberately did not alter server code.
2. Collapsed mobile Preview pill is only 13px tall. Its expanded controls are 44px. This preserves title gestures but remains a small touch target; larger accessible affordance requires parent-approved shell integration rather than overlaying title bars.
3. Preview-sheet browser Back without CloseWatcher closes sheet and may also take a shell step; test fallback platform before claiming full Back acceptance.
4. Full six-skin/all-app interaction matrix, standalone Back and sustained QA remain parent responsibilities. These renders are bounded smoke evidence, not a release-quality complete matrix.
5. No commit/push/PR/live changes or deployment by this worker. Service and staging origin already existed from parent work.
