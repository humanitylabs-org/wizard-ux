# Store home simplification — 12 Oct 2026

James requested four browse types with descriptions, keeping the existing category lists/details; a quiet System icon on Home replaces the oversized attention card. Fable first-party CLI design recipe (claude-fable-5-1) supplied row/grid geometry and compact System/Settings placement; Archimedes implements and verifies.

- Home: Apps, Agent apps, Agents, Connections. Header/search remain; featured, shelves, topics and counts removed.
- Phone: four quiet list rows. Wide Store windows: 2×2 understated tiles.
- System: labelled 44px icon next to the existing Settings gear, out of attention cards. Server/AI widgets unchanged.
- Store category journeys exposed browser focus scrolling the hidden desk container sideways; use overflow:clip (desk navigation remains transform-owned), assert frame bounds after every category. No data/lifecycle, native, shared API or production service changes. Contributor GPL LICENSE and prior provenance in docs/app-store-window.md preserved.
- Evidence: qa-store-system.cjs, Thales peer HTTPS source-hash and phone/desktop navigation checks. Real Back must stay inside Wizard; no unsafe request is permitted.

Acceptance: exactly four choices, each description and clean list, detail/list/root Back; search/install labels unchanged; System icon compact and opens the existing System window; Settings still opens; Resources unaffected. Lane: Standard bounded presentation refinement, no new flow/API. Base 0b754a21f4d9edf047988e8ca00b9a44d55c6c54. Existing private daily-driver route; isolated preview first, serialized promotion only after verification.
