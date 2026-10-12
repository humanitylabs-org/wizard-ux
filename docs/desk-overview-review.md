# Desk overview review handoff

Status: James approved shipping the sigil-first overview. Release removes the staging-only seed and preserves the reviewed layout.

## Chosen design
Large bare glyphs + app-colored card tint. Home house. App name beneath, thread caption when relevant. Here badge plus outline; independent Review badge. Grouped windows retain their app/thread labels and a window count. Multi labels reserve two lines and grouped cards grow to 224px to prevent overlap. Close targets 36px; keyboard activation ignores nested buttons. New desk goes directly to the live app-tile desk path.

## Evidence
Thales public staging URL tested: overview 42/42 (393/360px), live-base recognition 4/14; existing desk-strip suite 31/31 both base and candidate (module-path override, task-owned QA_SHOTS, session-pagination wait raised from 10 to 60 seconds). Exact human entry loads the real hosted apps, opens on overview with Music current, scroll top, HTTP 200, no page errors or writes. New layout tests explicitly isolate hosted-app bodies; they do not claim app-body verification. Initial four-window label overlap repaired and retested. Other early failures were test seed interference, session-pagination timeouts and Thales internal disk pressure; QA remained on Thales, using task-owned external-drive scratch.

Fable design consultation: two rounds; rendered candidate approved with baseline-aligned multiline labels and color-mix fallback declarations, both implemented. Accessible grouped labels now include count and contained windows. Source review and screenshots: /home/telos/.hermes/cache/scratch/desk-overview/ . Remote evidence: /Users/thales/workspace/wizard-desk-overview-qa/ and /Volumes/ThalesMedia/agent-scratch/desk-overview/ .

## Promotion
Remove web/preview-overview.js and its index.html tag. Merge current daily into this branch; re-run qa-desk-overview and desk-strip on Thales. Confirm current daily's web changes have not moved underneath the candidate, merge, push, and verify served ux-version.txt and live browser behavior. Do not ship the staging seed.
