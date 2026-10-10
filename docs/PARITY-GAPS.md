# Wizard UX vs legacy Wizard Mobile: what's missing in the chat

Sources: legacy-features.md (163 legacy features at wizard-mobile ff86db8c), new-ux-features.md (140 Wizard UX features at wizard-os-home daily 8d427f4 / 0.5.0).

## P0: basic chat-app expectations that are broken
1. Keep the screen on while the orb records. DONE on feature/recording-awake (0.5.1).
2. Your own sent images don't show reliably. Photos attached as inline images (legacy photos, screenshots, data-URL image parts) are ignored. A photo-only message drops the whole turn, so the reply attaches to the wrong message. The QA check for this is a no-op (`|| true`).
3. Images, screenshots, audio and files that Archimedes sends back are invisible. `<helm_attachments>` tags are stripped but their raw JSON stays in the bubble.
4. Tapping an image or file navigates the whole app away to the raw file, and coming back reloads the app and loses state. There's no in-app viewer.
5. Can't copy, select or share message text. `user-select:none` everywhere, and there's no Copy button on code blocks or "Share response".
6. Drafts leak between threads (they're per window, not per thread) and are lost on reload.
7. No Done / Close & file (Archive) / Defer / Restore buttons on a thread.
8. No approve/deny buttons. You only see "Waiting for your approval".
9. No Stop button for a running reply.
10. Long threads show only the last 60 turns, with no "load earlier".

## P1: legacy features you've used and expect
11. Model picker (per thread, plus the new-chat default) and recovery when the selected model fails (Retry / Choose another).
12. Errors section actions: Retry / Dismiss on failed threads and failed voice notes.
13. Mic button inside the composer for a guaranteed voice reply to this thread. The orb's router can misroute.
14. Voice keeps recording when the app is backgrounded or the screen locks (foreground service plus notification), and the recording survives an app kill.
15. Message timestamps and day dividers.
16. Full Markdown: real tables, italics, quotes, nested lists, headings, code blocks with Copy/Share, and `@session` links that open threads.
17. Work receipt detail: plan checklist (X of N done), named steps with durations, "Worked for 3m", and "Waiting on you" questions.
18. Reading position: open at the start of the latest reply, remember position for an hour, "↓ Latest" jump button.
19. Paste an image into the composer, and send text + voice + photos as one turn. Paste-image DONE (integrate/chat-basics). Text + voice + photos as one turn: DONE on fix/voice-seals-composer (it was never ported: 47ba6a0 carried photos only and kept typed words back as a draft).
20. Share to Wizard from other Android apps (share sheet → upload → notification).
21. Reply notifications for any chat, not just Everywhere sends.
22. In-app updates (banner → download → verify → install) and web hot-reload that keeps the draft.
23. Files screen: browse Wizard Files and attach an existing file to a chat.
24. AI usage panel (Claude/ChatGPT quota %, reset times) in Settings.
25. Image viewer: pinch-zoom, swipe a gallery, share/download. Also video player and Markdown file viewer.

## P2: polish and parity
26. Search message bodies, not just titles.
27. Offline / reconnecting / back-online banner, plus a fatal-error overlay with Reload.
28. Deep links: `?session=` / `?view=` / `?video=`.
29. Desktop split view (list + thread side by side).
30. Voice transcription provider card in Settings.
31. Critical-issue banner across screens.
32. Chats window title shows the thread name.
33. Drafts section for unsent new chats.

## Already ported (no action)
Work sections with the Bangkok 06:00 day, unread sync with legacy, approvals sorted first, attach files/photos via Wizard Files, voice-note playback, steering a live run, durable outbox with Retry/Edit, and Back that never exits.
