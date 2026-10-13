# Phone shell bottom-gap repair

## Reproduction and cause

The Ready-section deep link called `scrollIntoView({block:'start'})`. The `.device` shell used `overflow:hidden`, which hides overflow visually but remains a programmatically scrollable ancestor. Chromium scrolled the entire shell 99 CSS px upward (123 px with a 24px native top inset), lifting the dock and moving search under the system status bar. The exposed area was the shell background, matching James's screenshot.

## Repair

- `.device` uses `overflow:clip`, so nested focus and scrollIntoView cannot scroll the shell.
- Ready/Working section navigation changes only `.ch-scroll.scrollTop`.
- Android native insets, window geometry, dock height, immersive behavior and recording code remain unchanged.

## Verification on Thales

Actual daily origin: `https://wizard.tailc0f369.ts.net/wizard-os-home/`.
Browser: Google Chrome on Thales; Android-UA phone/touch 412×842; native bridge inset simulated at 24 CSS px. Every write intercepted; native hardware/IME not claimed.

`qa-phone-shell-scroll.cjs`: untouched daily 6 pass / 2 fail. Exact candidate 8/8 across three native-inset repeats. Before dock bottom719/viewport842, shell scroll123, search top−43. After dock bottom842/viewport842, shell scroll0, search top80. Nested scrollIntoView, keyboard-sized resize/restore, open thread/Back and zero page errors covered.

Broader `qa-chats-parity.cjs`: daily29/31 and candidate29/31, identical existing reply-attachment/tray-clearing failures; no new failure. The earlier chat-scroll-stability live receipt documents these same baseline failures.

Remote evidence: `/Volumes/ThalesMedia/wizard/phone-shell-scroll/` contains before/after screenshots and machine-readable check results. Live post-merge evidence will be retained in the same directory.
