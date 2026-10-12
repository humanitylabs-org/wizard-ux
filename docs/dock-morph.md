# Dock morph

User outcome: talk while exploring an app with its bottom navigation fully visible; attach the actual visible screen to that same voice take.

James chose dock morph on 12 Oct 2026 and specified X, Pause, orb (unchanged centre), Screenshot, Attach. Orb left/right desk swipes and up/down navigation remain unchanged in listening, paused and sending states; screenshot never remaps a swipe.

Acceptance:
- All four controls fit inside the existing 66px dock at 360/412px, preserve safe area, and never overlay app navigation. Idle desk icons remain intact.
- Pause/resume, cancel and file attachment use existing paths; orb tap sends; orb swipes navigate and preserve the take.
- Explicit Screenshot captures actual WebView pixels (including hosted apps), adds an image to the current take, and sends its file ID with the voice. It captures only after a tap, with the recording UI hidden. No Accessibility permission needed for this app's own window.
- Capture/upload blocks sending until complete; cancel/restart/navigation cannot transfer a late screenshot into another take. Failures leave the take intact and visibly report no attachment.
- Back navigates within Wizard, never discards recording or exits at root.

Surfaces: phone index/styles/app.js, shared native capture client, MainActivity PixelCopy bridge; separate signed Android Preview build for native acceptance. No Hermes or Agent Service modifications. Consequential (new user-facing capture flow and native bridge); direct Archimedes implementation of James's chosen layout, independent read-only review before delivery. Builds/tests/emulator on Thales only. Features stay in isolated staging until accepted. Evidence: negative-control and candidate touch suites, native PixelCopy pixel/PNG + uploaded body checks on Thales emulator, live staging readback and phone screenshots.
