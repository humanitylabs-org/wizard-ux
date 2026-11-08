# Desktop unread pill parity

Only change counts, not Ready membership, order, navigation or Working/Snoozed counts.

Reuse:
- capability: EXTEND WizCore.workspaceNav with a shared `chatsCount` projection of canonical visibleUnread plus unread routed notifications. Both shell publishers and stock Home/Classic status use it.
- capability: REUSE api.apps.badges/badgeText for AI apps desktop's Ready header and ungrouped rail, exactly as the phone menu does.
- capability: EXTEND WizChatsListModel with a deduplicated unread-row count for status/project subdivisions; row unread already comes from canonical isNew and notification read state.

Regression: execute real shell statements and desktop render functions with the real live/read module and a tiny in-memory DOM. Read and unread Ready threads must yield identical phone/menu/desktop header/rail/Classic counts; reading clears pills without removing rows. Cover status/project groups, badge-only repaint, zero, cap and routed notes.

No CSS changes: existing Appearance v1 skin materials are retained. No browser or broad suites on VPS; run only focused nice -n 19 Node tests. CI supplies remaining checks. Physical-device and two-skin screenshot acceptance is not claimed by VM tests.

Ship non-draft PR after focused tests. Merge exact green head, compose fresh main with freshly resolved live (preserving Recorder #975 and concurrent pane work), parity gate, lock-protected immutable archive/symlink deployment, and static readback at both serving ports.
