# Shipped device-view catch-up (4 November 2026)

Previous boundary: `44e53363ae42434a1e0bccd89d5ff5af4bdbf986`.
Covered release/miguel boundary: `c474318ecc3a1a481ed8aaaef6dbdaeaf0dcb176`.
Finite snapshot: every non-merge commit in this range is listed below. Earlier coverage remains in `miguel-release-coverage-20261104.md`.

| Source | Disposition |
|---|---|
| `8d4ba559ef44d79ba475e1c925d3581e48ef08c9` | Ported as `9cf9f9d88`: AI apps only mounts on desktop; phone keeps stock view unless another supported view is chosen. #957 generic yield-to-sheets and drag cancellation retained unchanged. |
| `c474318ecc3a1a481ed8aaaef6dbdaeaf0dcb176` | Ported as `9e6bbcb4d`, reconciled by `73daa999f` and follow-up regressions: separate desktop/phone views and device-filtered Look rows; main's logical clock and inline Settings options retained. Local cached per-type choices can seed an absent shared file. |

## Reuse and compatibility

- EXTEND `WosExperience` and existing view manifests; REUSE `WosSkinHost` mounting and generic sheet yielding.
- EXTEND `WosLookSync`/versioned Pages choices, with per-shell logical revisions, stale-first-sync renewal and simultaneous-device conflict tests. No parallel preference store.
- REUSE shared `WosSettings` Look switches; no separate phone settings implementation.
- Legacy single-view choices remain in the mix and map to both supported shells until each type explicitly chooses. AI apps legacy choice remains effective on desktop; phone does not support it. Neither file migration nor a choice on one type silently clears the other type's supported legacy view. Untouched old look.json is not rewritten merely to add views.
- #956 remains open and is not overwritten or cherry-picked. Its built-in `defaults` and refresh changes are separate from this schema extension. When integrated, retain both `defaults` and `views`, including parse/merge/pending/clock/adopt paths; its proposed second `adopt` argument must not replace this PR's per-shell choices. Existing logical-clock skin/tweak convergence is preserved here.
- James's known state has no shell view enabled; this change does not opt him in.

## Verification boundary

Browser-free focused tests cover both shell mounts, hiding AI apps on phone, legacy preservation, stale first sync with a future revision, simultaneous choices and quiet repeated sync. Full npm and a real /tmp zero-leftover audit plus desktop/phone two-skin screenshots belong to the separately staged parent-admitted forum v6 gate. No deployment, restart, physical phone verification, browser or Docker execution on the VPS is claimed.
