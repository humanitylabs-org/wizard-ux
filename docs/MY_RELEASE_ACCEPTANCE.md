# My release acceptance repair

## Component decision / implementation plan
- REUSE: production phone/desktop Settings adapters and their browser/native Back handlers. The browser rig supplies only service responses, never a replacement navigation handler.
- EXTEND: shared `WosSettings` page/header/Back and shared `settings.css`. My release has a visible 44px Back target in both layouts; desktop root shows Appearance rather than silently reselecting My release.
- EXTEND: existing shell Docker packaging. Normalize copied public static/config/script read/traverse permissions before `USER 101:101` so a private build-service umask cannot create an unusable image.
- NEW: no runtime UI modules or parallel navigation implementation.

## Failure evidence
The original worker's first rebuild rolled back before its HTTP probe could succeed. Repeating the same first rebuild on forum under ordinary SSH umask succeeded. Repeating it under `umask 077` reproduced the rollback. Retaining the failed container exposed exit 2 and `/bin/sh: can't open '/usr/local/bin/wizard-shell-entrypoint': Permission denied`. Docker COPY preserved private-worktree modes while the image runs as UID 101. This is a real packaging defect, not grounds to weaken WAM's exact-manifest health check. The E2E rig now explicitly uses umask 077 and preserves container inspect/log evidence.

Desktop Settings also deliberately hid every page-header button with `.st-desktop .st-page-head button { display: none; }`. Its root defaulted back to My release, so simply removing that rule would not make Back visibly leave the page. Both causes are corrected in the shared component.

## Regression coverage
- Unit regression: My release -> real Settings root before a second Back belongs to the shell, on phone and desktop. Shared Back CSS retains a 44px target.
- Packaging contract test requires normalization after all runtime COPY instructions and before dropping privileges.
- Browser defaults: Nebula and Light (`obsidian-light`), phone 390×844 and desktop 1280×900, real shells, developer off/on screenshots, visible pointer Back, actual browser history Back, phone native bridge Back, same-document checks, and Settings-root screenshots. Per-case JSON is written incrementally. Native bridge testing is not a claim of real Android handset QA.
- Companion WAM E2E: a real intentionally non-listening Docker build must restore the exact previous override, running revision, manifest and owner asset; no injected failing probe substitutes for that build.

No live owner box, merge, ready transition or deployment is part of this repair. The fresh full worker acceptance is a separate admitted run.
