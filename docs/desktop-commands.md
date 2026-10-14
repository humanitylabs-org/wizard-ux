# Desktop commands and on-demand desktops

James's 13 Oct scope supersedes the earlier new-chat-only preview. The desktop now uses demand-created desktops, familiar native commands, spatial app focus and chat navigation.

## Accepted working interpretation

`Command-T` opens a new desktop and switches to it, like creating a browser tab. `Command-Shift-[` / `]` and `Control-Tab` / `Control-Shift-Tab` switch existing desktops. This implements both the new-desktop and tab-switching intent without using Command-Tab, which belongs to macOS.

`Command-W` closes the focused app. Closing the last app leaves its bare desktop. A separate next press removes that empty desktop and returns to the previously active desktop. At the last remaining desktop it stays open. Key autorepeat cannot cascade closes.

Other commands:
- Command-N: fresh new-chat composer.
- Command-Shift-N: new-thread voice; repeat distinct press sends once.
- Option-Up / Down: previous/next chat in the Chats app.
- Command-arrows: spatially focus apps inside the current desktop.
- Command-F: fullscreen selected app; same command restores. Omarchy uses Super-F and Super-arrows for these roles.
- Command-Enter retains message Send.

Browser tabs retain browser-owned Command-N/T/W. Website JavaScript/`preventDefault` is not a dependable way to take those reserved chords. Keyboard Lock is a user-initiated fullscreen capability, not an ordinary browser/PWA shortcut replacement. Browser-safe aliases remain Option-Enter (chat), Option-T (desktop), Option-W (close), Option-Shift-V (new voice), Option-F (fullscreen). Native Wizard 0.5.2 owns the familiar chords in File/View/Window menus and forwards them exactly once into the shared desktop shell, including iframe focus. System Command-Tab, Control-arrow desktop switching and Control-Command-F native-window fullscreen remain untouched.

## State and integration

Fresh state starts with one desktop. Nine-slot legacy state is migrated once by preserving occupied desktops and the active desktop while removing unused slots. Deliberately created empty desktops subsequently persist. Stable IDs preserve hosted app DOM/state as closing a desktop renumbers the tab strip. App composers save before close; recorded replies keep their original thread even if their source app closes.

The candidate integrates daily e7a4ec7, including other owners' microphone recovery, single-app fullscreen and paused PWA Right Option ownership fixes. PWA Right Option remains unconsumed for the system voice tool; manual Dictate still supplies focused dictation-state tests. The fullscreen regression was adapted to create its second desktop on demand; all fullscreen behavior is retained.

## Evidence — Thales only

Exact served staging origin: https://desktop-keys.staging.<private-domain>/wizard-os-home/desktop.html

- On-demand desktop lifecycle and added navigation keys: 40 passed.
- New-chat/new-voice regression: 26 passed.
- Command-W regression: 13 passed.
- Existing single-app/hosted fullscreen regression: 22 passed, zero agent sends.
- Paused PWA Right Option/system-tool ownership regression: 7 passed, zero writes.
- Wizard for Mac 0.5.2 actual AppKit event loop/native menu acceptance: 22 passed, including first-open preview destination and preservation of saved Wizards. Covers all requested keys, empty/root close behavior, autorepeat, new voice audio enqueued once. Generated test tone through actual MediaRecorder; hardware microphone/keyboard testing is not claimed. Native defaults restored with exact semantic readback.

All QA writes were intercepted/refused or mocked at the outbox. Four `/wizard/thread-seen` attempts were blocked in lifecycle QA; no live messages were sent. Scripts/receipts and built DMG live under `/Volumes/ThalesMedia/Projects/wizard-desktop/dynamic-keys/` on Thales. The current DMG SHA is recorded in the release receipt, not duplicated here before final publication.

User-requested scope, integration gate, independent review and publication state are tracked in https://github.com/humanitylabs-org/wizard-ux/issues/9. Preserve daily/main and original release authority; tracker bookkeeping is not deployment approval. The Mac artifact is the route for familiar reserved browser chords; do not send a Brave page as proof that those chords work.
