# Wizard Mobile (legacy) — user-facing feature inventory @ ff86db8c

Source: `git -C /home/developer/apps/wizard-mobile show ff86db8c:<path>`, read-only. A copy was extracted to `/home/developer/.hermes/cache/scratch/wizard-audit/src-ff86/`.
Format: **ID. Name**: what the user sees or can do. *Evidence: file → symbol.*
⭐ = a feature James has explicitly said he cares about (keep screen on while recording; Archive/Done/Defer buttons; sent images showing in the thread).

Not present at this commit (checked so the rebuild doesn't hunt for them): home-screen widgets, emoji reactions on messages, reply/AI push notifications (the only Android notifications are for recording and Share-to-Wizard uploads), and a manual mark-unread action (unread state is computed automatically).

---

## A. Shell, navigation and root views

- **A1. Root views: Inbox / Work / Apps (+ Files, Settings)**. A bottom dock has Inbox, Work and Apps tabs. The header shows "Wizard workspace" with the view title, a gear button for Settings, and a Back arrow when not on Work. *App.tsx → `rootTitle`, `.bottom-dock`, `.root-header`, `navigateRoot`.*
- **A2. Inbox badge on the dock**. A count of threads needing attention, capped at "9+", with an accessible label "Inbox · N threads need attention". *App.tsx → `attentionCount`, `.dock-badge`.*
- **A3. New-thread FAB (orb)**. A floating Robert-orb button on Inbox, Work and Apps. Shows "…" while the new draft is opening. *App.tsx → `.new-thread-fab`, `newChat`/`openNewDraft`, `newDraftPending`.*
- **A4. In-app navigation stack**. Up to 32 entries of view/thread/file/usage history. Back pops it. *App.tsx → `pushNavigation`, `popNavigation`, `applyNavigation`.*
- **A5. Back closes the top layer first, never exits**. Order: video viewer → image viewer → markdown viewer → forget-confirm sheet → attachment sheet → model sheet → cancel live recording → pop navigation → close usage/file/chat → Files→Apps → any view→Work. At the root, Back is consumed. *App.tsx → `closeTopLayer`; MainActivity.java → `handleWizardBack` (calls `window.__wizardCloseOverlay`).*
- **A6. Predictive-back animation**. The Android 14 back-swipe progress scales, dims and slides the chat panel. Cancelling the swipe restores it. *MainActivity.java → `wizardBackCallback` (`handleOnBackStarted/Progressed/Cancelled`), `dispatchWizardBackProgress`; App.tsx → `__wizardBackProgress`, `backProgress` CSS vars.*
- **A7. Resume where you left off**. Reopening the app restores view, open thread, selected file, AI-usage screen, model, transcript and list scroll, follow state and nav stack. Data is per account scope. *uiResume.ts → `saveUiResumeState`/`readUiResumeState`; App.tsx → `persistCurrentUiState`, `initialUiResumeState`.*
- **A8. Instant cached startup**. The last session list and the open thread's messages render immediately from cache while the network refreshes. *App.tsx → `cachedPresentation` → `WizardController(api, undefined, cached)`.*
- **A9. Deep link to a thread (`?session=ID`)**. Opens Work with that thread, marks it read, then strips the param from the URL. *deepLink.ts → `readWizardSessionDeepLink`, `clearWizardSessionDeepLink`; App.tsx effect on `deepLinkedSession`.*
- **A10. Deep link to a root view or section (`?view=inbox|work|files|apps|settings&section=…`)**. Opens that screen with only the named Work section expanded. Overrides resume state. *deepLink.ts → `readWizardRootDeepLink`; App.tsx → `initialRootDestination`, `expandedWorkSections`.*
- **A11. Deep link to a video (`?video=<32hex>`)**. Opens the in-app video viewer over the originating conversation. *App.tsx → effect reading `video` param; VideoMedia.tsx → `privateMediaUrl`; commit 64c1b08.*
- **A12. Apps screen**. Cards for Files (in-app), Wizard Store (external link to store.wizard.example), and "Share to Wizard · Ready" (Android only). *App.tsx → `.apps-workspace`.*
- **A13. Snackbar / toast**. Transient status line, auto-hides after 4 s, tap to dismiss. Shown beside the mic inside a chat and at the bottom of root views. *controller.ts → `notify`/`showMessage`; App.tsx → `.snackbar`, `.composer-snackbar`.*

## B. Work list (chat list), sections and thread triage

- **B1. Work sections**. Collapsible sections with counts: Drafts, Errors (only when non-empty), Working, Ready, Yesterday, Past week, Deferred, Archive. Empty sections show "None". *App.tsx → `renderWorkSection`; workSections.ts → `groupWorkSessions`.*
- **B2. Bangkok 6 am work day**. "Ready" means today since 06:00 Asia/Bangkok. Yesterday is the previous work day, Past week runs up to 7 days, and older threads auto-move to Archive. *workSections.ts → `workDayStart`, `ARCHIVE_AFTER_MS`; App.tsx → `useWorkClock`.*
- **B3. Default expansion and remembered toggles**. Errors and Ready start open; the rest start collapsed. User toggles persist during the session. Deferring auto-expands Deferred. *App.tsx → `expandedWorkSections`, `deferThread`.*
- **B4. Approvals pinned at top of Ready**. Threads waiting for approval sort first in Ready with a "Needs approval" pill. *workSections.ts → `groupWorkSessions` sort; App.tsx → `renderSessionCard`; commits 69c3854, a4d9a18.*
- **B5. "N new" badge on the Ready header**. Count of Ready threads with unseen activity. *App.tsx → `readyNewCount`.*
- **B6. Thread card**. Each card shows the thread emoji, title, preview line, timestamp and a status pill: Needs approval / New / Needs retry / Queued #n / Processing / Working. *App.tsx → `renderSessionCard`, `statusLabel`.*
- **B7. Unread / "New" highlight**. Bold card with a "New" pill when there is a newer assistant reply since you last viewed the thread. Shown only in Ready, plus recording/voice cards in Inbox. *threadSeen.ts → `hasNewThreadActivity`; App.tsx → `newActivityKeys`, `.is-unread`.*
- **B8. Auto mark-read**. A thread is marked seen when opened, or when scrolled to the bottom while the tab is visible. *App.tsx → `rememberThreadSeen`, `onTranscriptScroll`, effect around `visibleLatestMatchesSession`.*
- **B9. Cross-device read sync**. Read state syncs with the server every 3 s and on focus/pageshow, merges with local state, and syncs across browser tabs via the storage event. *App.tsx → threadSeen sync effect (`api.threadSeen`/`updateThreadSeen`); threadSeen.ts → `mergeThreadSeen`.*
- **B10. Thread emoji**. A stable, topic-matched emoji per thread (security 🔐, bugs 🐛, mobile 📱, …), assigned once the title is real and persisted locally. *threadEmoji.ts → `threadEmoji`, `assignThreadEmojis`; App.tsx → `threadEmojis`.*
- **B11. Card timestamps**. Relative for under 24 h ("<1m", "5m", "3h"), otherwise "Oct 9 · 14:05" in Bangkok time (year shown if different). The tooltip says "Task assigned / Wizard replied / Latest message: …". Ticks each minute. *threadTimestamp.ts; App.tsx → `ThreadCardTimestamp`; workSections.ts → `sessionCardAt`.*
- **B12. Search work**. Filters by title and preview, with a clear (×) button, an active-search style, and a "No matching work" empty state. Also filters saved Drafts. *App.tsx → `.search-field`, `filteredSessions`, `savedNewDrafts`; commit e00be91.*
- **B13. Drafts section (unsent new chats)**. Unsent new-thread drafts saved on this device are listed as "Draft · Saved on this device". Tap to reopen with the exact model. *newThreadDrafts.ts → `readNewThreadDrafts`, `rotateNewThreadDraft`; App.tsx → `openNewDraft(saved)`.*
- **B14. Errors section cards with inline actions**. Failed or interrupted threads show "Review / Retry" and "Dismiss" buttons on the card. *App.tsx → `renderSessionCard` (error branch), `dismissWorkFailure`.*
- **B15. Failed-voice cards with Retry / Dismiss**. A voice note that failed to send appears as an "!" card with Retry and Dismiss. *App.tsx → `recoverableVoice` branch, `retryVoice`, `dismissFailedVoice`.*
- **B16. Optimistic "Preparing your request…" card**. A new thread appears instantly while it is being admitted (busy, not clickable until resolved). *controller.ts → `stagePendingNewThread`; workSections.ts → `isUnresolvedOptimisticSession`.*
- **B17. Duplicate-shell hiding**. Superseded single-message duplicate threads created within 5 min are hidden. *workSections.ts → `withoutSupersededSessionShells`.*
- **B18. Work-sync status banner**. "Work updated; some history is still unavailable" or "Showing saved Work; the latest refresh failed", with Try again. *App.tsx → `state.sessionSync`, `.work-sync-status`; controller.ts → `refreshSessions`.*
- **B19. Live refresh**. The session list and live state refresh every 3 s, on focus/pageshow/visibility, and on reconnect. *App.tsx → `controller.refreshLiveState` interval effect.*
- **B20. Loading and empty states**. "Loading work…" and "Loading inbox…" placeholders. *App.tsx.*

### Thread triage actions (bottom of an opened thread) ⭐
- **B21. ⭐ Close & file / Send & file (Archive)**. Archives an idle thread. If the composer has content it sends it, then files the thread ("Send & file"). Shows "Filing…", then returns to the list. Snackbar: "Filed in Archive"; on failure "Couldn't close & file · Thread restored". *App.tsx → `closeAndFile`, `.close-file-action`; controller.ts → `closeAndFile`, `fileSession`.*
- **B22. ⭐ Defer**. Moves the thread to the durable Deferred section. Keeps the visible unsent draft and returns to Work at once. Shows "Deferring…", then snackbar "Moved to Deferred" or "Couldn't defer · Thread kept open". *App.tsx → `deferThread`, `.defer-action`; controller.ts → `deferThread`/`setThreadDeferred`; commits 48a3c3f, f238086, 86c824a.*
- **B23. ⭐ Done**. Marks the thread done (files it), clears its draft and closes the chat. Shows "Finishing…", then snackbar "Marked done". *App.tsx → `markDone`, `.done-action`; controller.ts → `markDone`.*
- **B24. Button order Close & file · Defer · Done**. Shown only when the thread is idle, has an assistant reply, has no approval pending and isn't live. All three are disabled offline or while uploading. *App.tsx → `canResolveThread`, `nav.thread-resolution`.*
- **B25. ⭐ Restore (from Archive or Deferred)**. Archived or deferred threads show "Restore" ("Restoring…"), which returns them to Work. Deferred threads also show "Done" for direct completion. *App.tsx → `restoreThread`, `canRestoreThread`; controller.ts → `restoreThread`, `restoreSession`; commit 03d3b19.*

## C. Inbox and attention

- **C1. Inbox list**. Shows threads that are waiting for approval, failed, interrupted, or flagged critical, plus unseen 🎙 recording threads. *App.tsx → `statusInboxSessions`, `inboxSessions`.*
- **C2. Mizel.ai recording threads in Inbox**. Threads titled 🎙… stay in Inbox until opened, then drop out. *recordingInbox.ts → `recordingInboxSessions`; commit ed8407b.*
- **C3. Inbox clear state**. "Inbox clear — Approvals, recordings and work needing attention appear here." *App.tsx.*
- **C4. Critical-issue attention banner**. A red banner "N critical issues need attention · Open Inbox to resolve…" on root and chat screens. Inside a thread it excludes the current thread. *App.tsx → `AttentionBanner`; attention.ts → `criticalInboxSessions`, `threadAttentionSessions`.*

## D. Thread view: messages and rendering

- **D1. Chat header**. Back, the full thread title (or "New chat") with a live pulsing dot while working, model (star) button, and New chat button. *App.tsx → `.chat-header`; commit dcec4ce.*
- **D2. User bubbles and assistant messages**. User messages are right bubbles. Assistant messages are full-width Markdown. System lines appear centered. *App.tsx → `Message`.*
- **D3. Markdown rendering (GFM)**. Tables, lists, code and links via react-markdown + remark-gfm. Raw HTML is skipped. Only http(s), mailto and tel links are allowed. External links open in a new tab or the system browser. *MarkdownMessage.tsx → `MarkdownMessage`, `markdownUrlTransform`.*
- **D4. Inline Markdown images shown as alt text**. `![x](…)` renders as "[Image: x]" (no remote image loading). *MarkdownMessage.tsx → `img` component.*
- **D5. Session-reference links**. `@session:default/<id>` text becomes a tappable link that opens that Wizard thread. *MarkdownMessage.tsx → `remarkWizardSessionLinks`, `.wizard-session-link`; commit a16e650.*
- **D6. Copyable code / text blocks**. Every fenced block has a language label ("Text" for plain), a Copy button (→ "Copied") and a Share button. Shared text is attributed "From Archimedes:". *CopyableTextBlock.tsx; sharing.ts → `copyText`, `shareText`, `attributedText`.*
- **D7. ⭐ Sent images show in the thread**. Photos attached to a user message render as a 1–4 image grid in the bubble and are tappable to open full screen. *App.tsx → `Message` (`message.imageUrls` → `.sent-photo-grid`).*
- **D8. ⭐ Durable/private image attachments (sent and received)**. Images stored as Wizard files or attachments on user and assistant messages load through an authenticated fetch. They show "Loading image…" and, on failure, "Image unavailable · Tap to retry". *App.tsx → `MessageMedia`, `messageMedia`; PrivateImage.tsx; usePrivateImage.ts; commits 9ed8dbb, 615b602, e17a0af, 263dde2.*
- **D9. Audio attachments**. A native audio player with the transcript as caption. Audio fetches only on play. *App.tsx → `MessageMedia` (audio-card, `preload="none"`); commit 5c6df2a.*
- **D10. Video attachments**. An inline `<video>` card with filename, plus "Open video" (in-app viewer) and "Download video" buttons. *App.tsx → `MessageMedia` video-card.*
- **D11. Markdown file attachments**. Shown as a "Markdown · Open in Wizard" chip that opens the in-app Markdown viewer. *App.tsx → `isMarkdownMedia` branch.*
- **D12. Other file attachments**. A file chip with name and size or mime that opens the file in a new tab or downloads it. *App.tsx → `.media-file-link`, `FileChip`.*
- **D13. Video links inside Markdown**. Links to private Wizard video routes are probed with HEAD and open in the in-app video viewer instead of navigating away. *VideoMedia.tsx → `VideoLink`, `privateMediaUrl`.*
- **D14. Message timestamps**. 24 h HH:MM under each message, with a full date/time tooltip and screen-reader text "Sent… / Wizard replied…". *App.tsx → `MessageTimestamp`.*
- **D15. Day dividers**. "Today", "Yesterday" or "Oct 9" separators between days. *App.tsx → `transcriptItems`, `dayLabel`.*
- **D16. Streaming reply with caret**. The assistant text streams in live with a blinking caret. *App.tsx → `state.streamingText` article; sse.ts.*
- **D17. Share latest response**. A Share button on the latest completed assistant reply only. It shares that reply alone as attributed text (Android chooser or Web Share), falls back to "Copy response", and shows "Response copied". *ResponseShareButton.tsx; App.tsx → `shareableResponse`.*
- **D18. Delivery status lines on user messages**: "Sending…", "Not sent · Retry" (tap to retry), "Choose a model to send · Select model", "Steering", "Heard", "Couldn't steer — work had already finished". *App.tsx → `DeliveryLine`.*
- **D19. Loading / empty thread states**: "Opening your chats…", "Loading thread… Fetching the latest messages.", and for a new chat "Ready when you are. Ask anything, or attach a file." *App.tsx.*
- **D20. Hidden runtime chatter**. Injected recall, continuation chatter and control markers are kept out of the displayed human messages. *controller.ts/normalizers.ts (`stripWizardControlMarkers`); commits ea1b3a3, bac428c.*

## E. Thread view: working status, approvals, stop/steer

- **E1. Workline receipt under the request**. A collapsible row: live label ("Reading sources", "Testing", "Working · …") with elapsed time while running; "Worked for 3m 12s" when finished; "Ran into a problem after …" on failure. *App.tsx → `Workline`, `worklineElapsed`; workStatus.ts → `workStatus`.*
- **E2. Expanded task status**. "In progress / Finished / Stopped with an error · N actions completed", the latest activity and detail, or "Waiting for the next progress update." *App.tsx → `Workline` `.work-status`.*
- **E3. Activity details log**. "Activity details · N events" disclosure. Lists each step with state dot, detail and duration, and auto-follows the tail while live. *App.tsx → `Workline` `.work-log`, `WorkPhaseRow`.*
- **E4. Plan checklist**. When the agent has a todo plan: "X of N done · Y dropped", numbered items marked ✓ / ◌ (Now) / – (Dropped). Each item expands to its actions; the current item auto-expands. *App.tsx → `WorkPlan`; commits 75f2c53, dda4189, dd04d0e.*
- **E5. Waiting question**. Shows "Waiting on you" with the question and "Suggested: …" and "Reply in this thread to answer." It becomes "You answered" or "No answer recorded" after the run. A dot appears on the receipt while a question is open. *App.tsx → `WorkQuestion`; commits be2abc3, fa23bb2.*
- **E6. Screen-reader live announcements** of work state ("Wizard is working: … A question is waiting for you."). *App.tsx → `Workline` sr-only status.*
- **E7. Approval card**. "Needs your approval — Your Wizard wants to: <action>" with the server-provided choice buttons. Shows "Sending…" on the chosen button, disables the others, and is disabled offline. On error: "Couldn't confirm your decision…". Once resolved, the card shows a compact receipt line with the time. *App.tsx → `ApprovalPanel`; controller.ts → `chooseApproval`; commits 3fb0c0d, ce3509f.*
- **E8. "This approval is no longer waiting"**. Snackbar when the approval was already closed (404/409). *controller.ts → `chooseApproval`.*
- **E9. Stop button**. While your own run is active and the composer is empty, the send button becomes a Stop square. It is disabled offline, without the stop capability, or while stopping. The thread then shows "Stopped · HH:MM". *App.tsx → `.stop-work-button`, `state.stoppedAt`; controller.ts → `stop`.*
- **E10. Steer the current work**. While work is active the composer shows a "Steer" tag with placeholder "Guide the current work…". Sending posts guidance and files into the live run. If the run already finished, the steer falls through as a follow-up. *App.tsx → `send` (active → `controller.steer`); controller.ts → `steer`, `fallThroughCompletedSteer`; commit 7705c10.*
- **E11. Following externally started work**. Runs started elsewhere show a live dot ("Following active work"). Send is disabled unless steerable. *App.tsx → `externalActive`, `.external-work-note`.*
- **E12. Queued notice**. "Queued — starts automatically when a work slot opens." Cards show "Queued #n". *App.tsx.*
- **E13. Model-failure panel**. "Selected model stopped — <model · provider>" with Retry selected model / Choose another model / Dismiss. States that Wizard did not switch models. *App.tsx → `.model-failure-panel`; controller.ts → `retryFailedRun`; commit 6247ab0.*
- **E14. Server-failed thread panel**. "This thread needs retry" with Retry ("Retrying…") or Dismiss (clears the error, keeps the thread; snackbar "Failure cleared"). *App.tsx → `serverFailedSession`; controller.ts → `retryServerFailedSession`, `dismissSessionFailure`; commit fa0ac70.*
- **E15. Private Operator (GLM-5.3) background worker**. A "GLM-5.3 is working" workline with a "GLM-5.3 worker finished" snackbar. *controller.ts → `operatorActivity`.*

## F. Scrolling and reading position

- **F1. Auto-follow the tail**. While you are at the bottom, new content keeps the view pinned. Scrolling up stops following. *App.tsx → `followingRef`, layout effect.*
- **F2. "↓ Latest" jump button**. Appears when more than 600 px from the bottom. Smooth-scrolls unless reduced motion is set. *App.tsx → `showLatest`, `jumpLatest`.*
- **F3. Reading-position memory**. Leaving a thread while reading the latest reply saves an anchor (1 h TTL, 32 threads). Reopening restores that exact position. *readingPosition.ts; App.tsx → `rememberCurrentReadingPosition`, `prepareThreadOpen`.*
- **F4. Open at the start of the latest reply**. Fresh opens scroll to the top of the newest assistant message, not the very bottom. *App.tsx → `pendingLatestSessionRef` branch.*
- **F5. Working threads open at the live tail**, overriding old reading anchors. *App.tsx → `openingWorking`; commit a3ace7e.*
- **F6. Stable position during background refresh**. List and transcript refreshes don't jump the scroll. *App.tsx → root `useLayoutEffect` on `state.sessions`; commit ef8b46a.*
- **F7. Sending a reply returns to Work**. After send or voice-finish the app closes the thread back to the Work list. *App.tsx → `returnToWorkAfterReply`.*

## G. Composer

- **G1. Auto-growing textarea**. "Message your Wizard". Grows to 132 px, 64 000-character cap. *App.tsx → `updateDraftText`, textarea.*
- **G2. Per-thread, per-model drafts persisted**. Each thread keeps its own unsent text, photos and files in localStorage, including the provider. *storage.ts → `readDraft`/`writeDraft`, `DRAFT_KEY`; App.tsx → draft effects.*
- **G3. New chats start empty; previous unsent new draft is saved to Drafts**. *newThreadDrafts.ts → `rotateNewThreadDraft`; commits 8e75ffe, b14d33f.*
- **G4. Send button**. Disabled when empty, uploading, offline, fatal, voice requesting/transcribing, mid-resolve, or external work can't be steered. *App.tsx → `composerSendDisabled`.*
- **G5. Keyboard shortcut**. ⌘+Enter on Apple platforms, Ctrl+Enter elsewhere, IME-safe. *composerShortcut.ts → `handleComposerSendShortcut`; commit 2b6ac5b.*
- **G6. Dictation-safe send**. Reads the live textarea value at tap time, so Android dictation's last words aren't lost. *App.tsx → `send` (`textareaRef.current.value`).*
- **G7. Attachment sheet (paperclip)**. A bottom sheet with "Photos — Choose up to 4 images" and "Device files — Upload, then attach". *App.tsx → `attachmentSheet` Sheet.*
- **G8. Photo attach with preparation**. PNG/JPEG/WebP/GIF, max 4. Images are downscaled and recompressed to fit the storage budget. Animated GIFs are kept if small. Errors: "Use PNG, JPEG, WebP, or GIF photos.", "Only 4 photos were attached." *imagePreparation.ts → `prepareImages`; App.tsx → `onPhotos`.*
- **G9. Paste images from clipboard into the composer**. *App.tsx → `onComposerPaste`, `clipboardImages`; commit 9d5321c.*
- **G10. Device-file upload**. Files go up to Wizard Files (64 MB limit, max 8 per message), showing "Uploading to Wizard Files…". *wizardFiles.ts → `WizardFilesAPI.upload`, `MAX_THREAD_FILES`; App.tsx → `onDeviceFiles`.*
- **G11. Draft attachment chips**. Photo thumbnails and file chips, each with a remove (×) button. *App.tsx → `.draft-attachments`, `FileChip removable`.*
- **G12. Photos when steering are uploaded as files first**. "Photo upload failed · Attachment kept" on error. *App.tsx → `send` (active branch).*
- **G13. Attach from Wizard Files into the current chat**. *App.tsx → `addFile`.*
- **G14. Model picker sheet**. "Choose a model" lists one newest choice per family (Claude Fable/Opus/Sonnet/Haiku, then GPT Astra/Sol/Terra/Luna/Codex Spark), the global default first, and the private operator marked ◎. The selected model has a ✓. Includes loading and "Retry loading models" states. *App.tsx → `modelSheet`; modelChoices.ts → `visibleModelChoices`; commits b3220ef, 0b36bb0.*
- **G15. Per-thread model change**. Changing the model on an existing thread calls the server. A runtime switch starts a new chat. Locked threads refuse. Failure shows "Model not changed · Retry". *controller.ts → `chooseModel`.*
- **G16. New chats inherit the Hermes global default model** (with Sol fallback). *commits 3c4e8fb, 4db883e; controller.ts → `newChat`.*
- **G17. Needs-model recovery**. A saved message without a model is locked ("Choose a model for the saved message above"). Choosing a model retries it automatically. *App.tsx → `recoveryPending`, `modelRetry`; controller.ts → `retryAdmission`.*
- **G18. Durable outbox / no-loss send**. Sends are stored as durable envelopes (localStorage plus a native Android store) and reconciled after restart or reconnect. "Not sent · Retry" uses the same idempotency key. *storage.ts → envelope keys; controller.ts → `send`, `recover`, `retryAdmission`; DurableEnvelopeStore.java.*
- **G19. Guard rails while busy**. "Wait for attachments to finish.", "Your previous message is still sending.", "Current work is still starting. Your draft is safe.", "Thread organization is being saved. Your draft is safe." *App.tsx/controller.ts `showMessage`/`notify`.*

## H. Voice

- **H1. Mic orb in the composer (voice reply)**. Tap to record. The orb switches to the "listening galaxy" art with a running counter. Tap again to finish and send. *App.tsx → `.voice-fab`, `startVoice`, `finishVoice`, `VoiceCounter`.*
- **H2. Pause / Resume recording**. A satellite button. If the native shell is too old: "Pause needs Wizard 0.1.14. Tap Update to install it." *App.tsx → `pauseVoice`, `resumeVoice`; WizardRecordingService.java → `pauseRecording`/`resumeRecording`.*
- **H3. Cancel recording (× satellite or Back)**. Discards the capture and its native retained file. *App.tsx → `discardVoice`; `closeTopLayer` voice branch.*
- **H4. Text and voice sent together**. Typed or pasted text, photos and files are sealed with the recording into one turn. Tapping the text Send arrow while recording also finishes the voice. *App.tsx → `send` (voice branch), `transcribeAndSend`; voice.ts → `composeVoiceTurnText`; commit b176632.*
- **H5. Voice-first new chat**. The New-thread FAB opens an empty chat and starts the mic immediately, waiting for any pending native recovery first. *App.tsx → `openNewDraft` (`newVoiceStart`); commits 83cbfc0, 7c37420.*
- **H6. Server transcription and audio attachment**. The audio is transcribed via the Wizard STT broker and also uploaded as a `wizard-voice-<stamp>.m4a/webm` file on the message. *App.tsx → `transcribeAndSend` (`voiceApi.transcribe`, `filesApi.upload`); voice.ts.*
- **H7. Immediate return to Work while voice processes**. The card shows "Processing voice…" and the recorder is free for the next capture. *App.tsx → `finishVoice`, `upsertVoiceQueueItem`; controller.ts → `stageVoiceSubmission`; commit f7618f9.*
- **H8. Voice pinned to its original thread**, even after navigation. *controller.ts → `captureVoiceTarget`, `pendingVoiceSessionId`; commits e4a6b8d, d02eb50.*
- **H9. ⭐ Keep screen on while recording**. The Android window sets FLAG_KEEP_SCREEN_ON whenever the recording service is recording and clears it when recording stops or the activity is destroyed. *MainActivity.java → `reconcileRecordingScreenAwake`, `setRecordingScreenAwake`.*
- **H10. Background recording via foreground service**. Recording continues when the app is backgrounded. An ongoing notification "Wizard voice reply — Recording continues · tap to return and send" or "Paused · tap to return, resume, or send" shows a chronometer; tapping it returns to the app. *WizardRecordingService.java → `buildNotification`, `promoteToForeground`; AndroidManifest (`FOREGROUND_SERVICE_MICROPHONE`).*
- **H11. Built-in mic only, system audio preserved**. Recording forces the phone's built-in mic (not Bluetooth) at AAC 44.1 kHz mono 64 kbps, and errors if Android routes elsewhere. *WizardRecordingService.java → `startRecording`, InputRoutePolicy.java.*
- **H12. Retained recordings (native custody)**. A finished recording is kept in app-private storage until the web side acknowledges that the server accepted it. *PendingRecordingStore.java; nativeMicrophone.ts → `acknowledgeNativeMicrophoneRecording`.*
- **H13. Recording recovery after crash/kill**. On launch, a live recording is restored ("Recording restored. Finish to send or tap × to discard."). A sealed but unsent one becomes a failed item ("Recovered unfinished voice recording. Tap Retry to continue."). *App.tsx → recovery effect (`recoverNativeMicrophoneRecording`).*
- **H14. Duplicate-safe recovery**. A recovered recording already accepted by the server is released ("Voice reply already accepted · Saved recording released") using a SHA-256 match, not resent. *App.tsx → `reconcileRetainedVoice`, `recordingSha256`; controller.ts → `reconcileRetainedVoice`.*
- **H15. "Voice reply needs attention" sheet**. On a failed send: preserved transcript text, then "Retry now", "Retry with <model>", or "Choose model for saved reply", plus "Later". *App.tsx → `voiceFailureAlert` Sheet.*
- **H16. Inline voice error/recovery strip**. Shown beside the mic with the error detail, transcript preview, and Retry or ×. *App.tsx → `.voice-recovery`.*
- **H17. Dismiss failed voice**. Removes the item from Inbox and deletes the retained recording, with a durable tombstone so cleanup resumes next launch. Snackbar: "Removed from Inbox · Finishing cleanup in background". *App.tsx → `dismissFailedVoice`; voiceRecoveryReceipt.ts.*
- **H18. Mic permission flow**. Android runtime permission prompt. If denied: dialog "Allow microphone access … Open settings / Not now" that deep-links to app settings. *MainActivity.java → `showMicrophoneSettingsDialog`, `onPermissionRequest`; nativeMicrophone.ts.*
- **H19. Browser MediaRecorder fallback**. Used on web/desktop (echo cancellation and noise suppression on). If the browser mic is busy, the native recorder is used instead. Clear error copy for blocked, absent or in-use mics. *App.tsx → `startVoice`; voice.ts → `voiceStartError`, `isBrowserMicrophoneBusyError`; commit 7a91af8.*
- **H20. Choose-model-before-recording guard**. "Choose a model before recording · Your draft is preserved" opens the picker. *App.tsx → `startVoice`.*
- **H21. Voice needs connection**. "Voice needs a connection." when offline. *App.tsx → `startVoice`.*
- **H22. Voice transcription provider card (Settings)**. Shows the active STT provider/model (attested badge). Tinfoil / OpenAI / Local model rows ("Ask Wizard") prefill a new chat asking Wizard to set it up. *App.tsx → `.voice-provider-card`, `askWizardForVoice`.*

## I. Media viewers, sharing and export

- **I1. Full-screen image viewer**. Pinch to zoom (1–5×), pan when zoomed, double-tap to reset. Hint: "Pinch to zoom · Double-tap to reset". *MediaViewers.tsx → `ImageViewer`, `ImageViewerSlide`.*
- **I2. Image gallery swipe**. Swipe left/right or ‹ › buttons, or the arrow keys, across all images in a message. Shows a "2 / 4" counter. *MediaViewers.tsx; commit dee9e74.*
- **I3. Share or download image**. A share menu in the viewer: "Share file" (Android chooser or Web Share) and "Download image" (Android save-as document picker, toast "Image saved"). *ImageExportActions.tsx; sharing.ts → `shareImage`; imageExport.ts; MainActivity.java (IMAGE_SAVE_REQUEST); WizardImageShareRequest.java.*
- **I4. Markdown viewer**. Opens .md files and attachments up to 2 MB rendered in-app, with "Share file" and "Download .md". *MediaViewers.tsx → `MarkdownViewer`; markdownExport.ts; WizardMarkdownShareRequest.java.*
- **I5. Video viewer**. Full-screen player with filename, "Retry playback" on error, "Download video", Escape/Back to close. *VideoMedia.tsx → `VideoViewer`; useVideoOverlay.ts.*
- **I6. Native Android file downloads**. Downloads go through Android DownloadManager with the original filenames kept. Untrusted downloads are blocked with a toast. *MainActivity.java → `downloadWizardFile`; WizardDownloadFilename.java.*
- **I7. Text sharing with attribution** (code blocks and the latest response), via the native `WizardNativeText` bridge or Web Share. *sharing.ts → `shareText`; WizardTextShareRequest.java.*
- **I8. Upgrade-aware share fallbacks**. Messages such as "Update Wizard to share directly. Download is available now." *sharing.ts, ImageExportActions.tsx, MediaViewers.tsx.*

## J. Files (Wizard Inbox files)

- **J1. Files list**. Under "Files your Wizard can use", newest first, with name, mime, size, age, an Attach button, Refresh, error with Try again, and an empty state. *App.tsx → `.files-workspace`; wizardFiles.ts → `list`.*
- **J2. File detail**. Size, received date, source, status and note, with "Attach to chat" and Open (Markdown viewer, video viewer, or open file). *App.tsx → `.file-detail`.*

## K. Settings

- **K1. AI usage panel (first card)**. Compact rows per subscription window: % left (colour toned) and reset stamp, with the reading age, "% left · resets Bangkok", and per-provider notes (not signed in, expired, …). *AiUsage.tsx → `AiUsagePanel`; aiUsage.ts → `compactRows`.*
- **K2. AI usage detail screen**. Per-provider cards (Claude and ChatGPT subscriptions, account tag) with bars, reset countdowns, and paid extra usage; stale state ("countdowns paused"); Refresh and Try again; read-only note. Polls every 60 s while visible. *AiUsage.tsx → `AiUsageScreen`, `ProviderCard`; commits 4de1985, e6fb2fa.*
- **K3. Connection card**. "Wizard Link carries end-to-end encrypted traffic…" or "Cloudflare Access", plus "Paired with <name>" and "Forget this Wizard" (Link mode). *App.tsx → settings; WizardRoot.tsx.*
- **K4. Share pairing card**. Android share pairing status, "Generate pairing link / re-pair link" (Pair this phone deep link and enrollment page), and "Forget device" with a confirm sheet. *App.tsx → `generateInvite`, `forget`, `forgetConfirm`; nativePairing.ts.*
- **K5. Updates card**. Installed version, "Install X.Y.Z", "Reload updated interface", status text ("Wizard is up to date."). *App.tsx → settings Updates.*
- **K6. Access footer**. "Protected by Cloudflare Access" or "End-to-end encrypted through Wizard Link". *App.tsx.*

## L. Updates

- **L1. Native APK update banner**. "Update available — Wizard X is available" with Install. Checks the release feed every 5 min. *App.tsx → `UpdateBanner`; nativeUpdate.ts → `watchNativeUpdates`.*
- **L2. In-app APK download, verify and install**. Status steps: Downloading → Verifying (size, SHA-256, package, signer) → Opening Android installer. Asks for install-unknown-apps permission if needed. Errors show "Update failed: …". Progress resumes after app restart. *WizardUpdateInstaller.java; WizardUpdatePolicy.java; nativeUpdate.ts → `requestNativeUpdate`, `resumeNativeUpdate`, `watchNativeUpdateProgress`.*
- **L3. Web UI hot-update**. Polls every 10 s for a new UI bundle and shows "Interface update ready · Reload". Reload preserves the thread, draft and scroll. Blocked while recording ("Finish voice reply before reloading."). *uiUpdate.ts → `watchUiUpdates`, `saveUiReloadState`; App.tsx → `activateUiUpdate`.*

## M. Native Android shell

- **M1. WebView app shell**. Portrait, single-task, dark status/nav bars, splash screen, edge-to-edge with native safe-area insets injected as CSS (including the keyboard/IME). *MainActivity.java → `onCreate`, `installSystemBarInsets`; WizardInsetsCss.java.*
- **M2. Share to Wizard (Android share sheet)**. Accepts any file (single or multiple). Makes a safe local copy, takes an optional note, then "Drop". Queues a resumable chunked upload (up to 2 GB) via WorkManager that retries when the network returns. Includes "Cancel queued drop". If not paired: "Pair this phone first…". *WizardDropActivity.java; WizardDropWorker.java; WizardDropItem.java; AndroidManifest (SEND/SEND_MULTIPLE).*
- **M3. Share-upload notifications**. "Sending to your Wizard <file>" (ongoing), then "Received by your Wizard <file> · <wizard>". Tapping opens the app. *WizardDropWorker.java → `foregroundInfo`, notify; strings.xml.*
- **M4. Pair via `wizard://pair` link**. A native "Pair Wizard" screen with "Pair this phone". Supports both Wizard Link and Drop pairing. *WizardPairActivity.java; AndroidManifest intent-filter.*
- **M5. Wizard Link pairing page (web)**. "Pair with <name>", "Pair this device", "Open in the Wizard app", expiry time, one-time invite, auto-pair inside the native app, and a "Wizard paired" toast. Unpaired: an instruction to send to Hermes. *WizardRoot.tsx; linkTransport.ts; nativePairing.ts.*
- **M6. Native microphone and recording service**. See H9–H13 and H18.
- **M7. System file chooser for uploads** (multi-select up to 8). *MainActivity.java → `onShowFileChooser`, `onActivityResult`.*
- **M8. External links open in the system browser**. Non-Wizard navigation is handed to Android. *MainActivity.java → `shouldOverrideUrlLoading`, `openExternal`; TrustedNavigation.java.*
- **M9. Renderer crash recovery**. A crashed WebView is rebuilt automatically, up to 2 times. After that: "Wizard needs attention — Update Android System WebView". *MainActivity.java → `recoverRenderer`, `showFatalPage`.*
- **M10. Back never exits** (see A5/A6).

## N. Desktop / wide layout

- **N1. Split view**. At ≥700 px viewport on Work (the code uses 700 px; docs say 768 px), the list is a left sidebar and the chat sits on the right. The current thread is highlighted. Sibling taps replace rather than push nav. *App.tsx → `wideViewport`, `splitLayout`; desktopChat.css; docs/desktop-layout-preview.md.*
- **N2. Empty right pane**. "Your conversations, side by side. Choose a chat on the left…" with "Start a new chat". *App.tsx → `.split-empty`.*
- **N3. Sidebar locked during modals, recording or upload** (inert). *App.tsx → `modalOpen`, `rootInert`.*

## O. Connectivity, errors and recovery UX

- **O1. Connection banner**. "Offline — your draft and any work in progress are safe" / "Reconnecting…" / "Back online" (2 s). *App.tsx → `.connection-banner`; controller.ts → `setOffline`/`setOnline`.*
- **O2. Fatal overlay**. "Wizard needs attention <message> · Reload" for unreadable saved work, unsupported backend, or conflicting replay. *App.tsx → `.fatal-overlay`; controller.ts `fatalMessage`.*
- **O3. Reconcile after restart**. Interrupted, failed or completed runs are reconciled on launch; recovered completions show "Recovered request completed · Open thread". *controller.ts → `recover`, `reconcileRetainedVoice`; commits e5da470, 39b64b6.*
- **O4. Inline "Try again" errors** on Files, Work sync, and AI usage. *App.tsx, AiUsage.tsx.*
- **O5. Bottom sheets close on backdrop tap or ×**. *App.tsx → `Sheet`.*
- **O6. Accessibility**. aria-live regions, sr-only labels, focus restoration in viewers and menus, Escape closes menus and viewers, reduced-motion aware. *Throughout (MediaViewers.tsx, ResponseShareButton.tsx, App.tsx).*

---
Item count: 163 (A13 + B25 + C4 + D20 + E15 + F7 + G19 + H22 + I8 + J2 + K6 + L3 + M10 + N3 + O6).
