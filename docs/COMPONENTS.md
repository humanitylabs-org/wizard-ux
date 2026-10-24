# Wizard OS components: reuse before build

**One implementation per capability.** Find the need below and reuse its entry point. Extend near-fit modules instead of building beside them. NEW lands in `web/core/` with a row here, never inside an app.

Every PR body carries a `Reuse:` block (see `.github/pull_request_template.md`); CI checks it (`tools/reuse-check.mjs`) and checks that every shell global is listed here (`tests/components-inventory.test.mjs`).

```
Reuse:
- chat: REUSE WizardApp.nav.openThread
- orb: EXTEND Orb.create (adds R option; row updated)
- habit streak card: NEW (no row; web/core/streaks.js + row)
Visual: <side-by-side screenshot of the existing element and yours, or "none">
```

`Reuse: n/a (<reason>)` is accepted only when the PR changes nothing under `web/` or `android/`.

## Apps (hosted frames: use only `WizardApp` from `/wizard-os-home/core/app-client.js`)

| Need | Use | Never hand-roll | Test the shared path by |
|---|---|---|---|
| Talk to an agent: composer, Stop/retry/outbox, models, dictation, attachments | `WizardApp.nav.openThread(sessionId, {reply})`, the real Chats thread over the app (wizard-builder `references/chat.md`) | composer, transcript, streaming client or retry loop in the app; `wizard-ui.css` is look only | the shell shows the `[data-chats]` thread for that session; the app frame has no textarea; a forced 503 leaves exactly one outbox item and one delivered message |
| Back inside the app | `WizardApp.back.register / push / useHistory` | root history guards, CloseWatcher | nested view + Back keeps the app open |
| Skin, tokens, light/dark | `WizardApp.theme.get / onChange`, `--wz-*` roles | theme storage, own dark mode, literal colours | two skins + a live skin change keep app state |
| Native Android screens in the worn skin | `WizardLook` (`android/app/src/main/java/ai/wizards/os/WizardLook.java`: shell `--wz-*` roles saved natively, Nebula fallback) | literal colours in native screens |
| Native "can't reach your Wizard" screen and the Connect / edit-address screen | `ReachScreen` (`android/app/src/main/java/ai/wizards/os/ReachScreen.java`, rules in `ReachPolicy`; Try again is the only primary, the address is a quiet Edit address line), `ConnectActivity` (`android/app/src/main/java/ai/wizards/os/ConnectActivity.java`, address in `ServerSettings`) | a second offline overlay, a WebView error page, another address editor |
| Transcribe an existing audio file (EXTEND) | `WizardApp.voice.transcribe(blob, {language})` → `{text}` or `{unavailable:true}`; verified installed frame, 25 MB cap, shell `WizConfig.transcribe` | app/provider transcriber, container-to-Voice-Core request | stale/foreign frame denied; unavailable endpoint is explicit |
| Share text or a file out (Wizard's share sheet first: people → Wizard apps → Other apps…) | `WizardApp.share.text / file` | `navigator.share`, an own share picker | cancelled is not reported as shared |
| Receive shares (people as direct targets) | `WizardApp.share.receive({accepts, targets, receive}) / targets / check` (`docs/SHARE-SHEET.md`) | own inbound share route, URL-fragment payloads | pending until `receive` is true, acked once |
| Mic, camera, screen capture | `WizardApp.capture.start / pending / ack` | `getUserMedia`, `MediaRecorder` | pending capture survives Back and is acked once |
| Title-bar tools | `WizardApp.titlebar.set(tools)` | an app header repeating the title | tools appear in the shell title bar |
| Protect unsaved work from updates | `WizardApp.update.hold` | app service worker, forced reload | hold released only after save + readback |
| Reading place in an app document | shell-owned `WizAppReadingPosition` (`web/core/app-reading-position.js`), automatic for registered apps | app-local scroll store | reopen lands at the saved place |
| Motion, haptics, press feel | `WizardMotion` (`/wizard-os-home/motion/wizard-motion.js`) | own spring/haptic helpers | — |
| App look: rows, sections, empty state, single-line add field | `WizardApp` swaps vendored `wizard-ui.css` for live `web/kit/wizard-ui.css` + `--wz-*`, then layers active skin (`core/skins.css`, package, My skin) after app styles | a forked kit; `.wz-field-row` as a chat composer; literal colours | two skins + My skin restyle the app's `.wz-*` rows live |

## Shell (`web/core/`, shared by both shells; every row serves every agent kind: main, host-profile, container, restricted; a per-kind variant is a fork, declare it EXTEND)

| Need | Use | Never hand-roll |
|---|---|---|
| Chats: list, Focus strip/Filter (All / agent / Space; 32px colour pills, 44px targets, persisted collapse), search, thread, composer (text/attachments), drop, cards/read state, Copy · Share (Regenerate: `--wos-reply-regenerate: on`); history only when populated | `WizCore` Chats (`web/core/chats.js`, `web/core/chats.css`); `setFocus(w, {kind, key})` / `setFocus(w, null)` persist `w.focus` via shell save; `WizCore.migrateChatsFocus` folds legacy `w.agent` windows on restore; live data `WizLive` (`web/live.js`) | a second thread, composer, Focus/command parser or per-agent thread logic; extra per-reply buttons on every skin |
| Alternative Chats list | `WizChatsHost` view slot (`web/core/chats-view.js`) | a forked Chats |
| Repaint a live view without flicker (only changed nodes move) | `WosMorph.morph` (`web/core/dom-morph.js`) | whole-view `innerHTML` on every live tick |
| Model picker, errors and retry, composer mic, work receipts, reading place | `WosChatPower` (`web/core/chat-power.js`) + `WosModels` (`web/core/chat-models.js`), `WosErrors` (`web/core/chat-errors.js`), `WosWork` (`web/core/chat-work.js`) | own model list, own error card, own reading-position store |
| Markdown, drafts, rich copy, Bangkok time, media viewer | `WosChat` (`web/core/chat-kit.js`: `md`, `copyRich`, `viewer`) | a markdown library, own lightbox |
| Spaces / Focus | `WizCore` Chats (`web/core/chats.js`), `WizLive.putPrefs` (`spaces` in box-wide ui-preferences); `WizLive.spaceSessions(ids)` hydrates missing focused members outside global list windows (memory-only, four concurrent reads); `winAgent` / `modelRoute` drive every new-chat adapter; `WosAgents.colour` / `distinctHues` drive tab identity and `--ch-agent-hue` list tint | automatic subject tabs, separate collection store, per-shell Focus routing or section implementations |
| Pinned threads (synced across devices) | `WosChatPins` (`web/core/chat-pins.js`) | device-local pin lists |
| Snooze thread/message: Later today · Tomorrow · In 2/3/5 days · Next week · Someday; Other date… last; success returns via threadBack like Done | `WosBoomerang` (`web/core/scheduled-reminders.js`) on the one scheduler; Settings → Schedules `WosSchedules` (`web/core/schedules.js`) | own timers or reminder stores |
| Thread topic emoji | `WosTopicEmoji` (`web/core/chat-topic-emojis.js`, data `WosTopicEmojiData`) | — |
| Durable send that survives outages without duplicates | `WosOutbox`, `WosCarry` (`web/outbox.js`) | fetch + retry loop |
| Cancelled-recording keep | `WosCancelled` (`web/core/cancelled.js`) | — |
| Share to Wizard | `WizShareWizard` (`web/core/share-wizard.js`) | Native/app input → one phone/desktop sheet; `share.wizard` |
| Uploads of any size | `WizUploads` (`web/core/uploads.js`) | file input + single fetch |
| Files browse, preview, attach | `WosFiles` (`web/core/files.js`) | own picker |
| Settings in both shells | `WosSettings.register` (`web/core/settings.js`); `focus(id)` routes aliases (empty/false opens root); `WosFeatures` actions/views | shell-only pages |
| Agent identity, glyph, hue; which agents an app joins (`appAgents`: privacy, needs_private_agent) | `WosAgents` (`web/core/agents.js`) | hard-coded agent names or colours |
| App routing to an agent, incl. the private-app note and Set up private agent (also from the Store install sheet) | `WosAppRoute` (`web/core/app-route.js`) | — |
| App glyph tiles | `WizSigil` (`web/core/sigils.js`, `web/core/sigils.css`) | PNG/emoji icons |
| App groups | `WosAppKinds` (`web/core/app-kinds.js`) | forks |
| Brand hat | `WizBrand` (`web/core/brand.js`) | redrawn logos |
| Links: in-app sheet, image links, long-press Open in your browser / Download / Copy link | `WizLinks` (`web/core/links.js`; Android: `WizardOSNative.openInBrowser` / `download`) | `window.open`, own iframe sheet, own link menu |
| Text-selection actions | `WosSelMenu` (`web/core/sel-menu.js`) | own context menu |
| Share sheet, receivers, pending handoffs | `WosShareSheet` (`web/core/share-sheet.js`), entered only via `WosChat.sharePayload` | a second share picker, sending for an app |
| Screen context for the agent | `WizScreen` (`web/core/screen-text.js`) | own DOM scrape |
| Dictation into a focused field | `WizCore` focused field (`web/core/focused-field.js`); voice `WizCore` (`web/core/voice.js`); mic choice `WosMic` (`web/core/mic.js`) | own recorder/transcriber |
| Local commands | `WosCommands` (`web/core/commands.js`) | a second command parser |
| Bound views beside a thread | `WosBoundView` (`web/core/bound-view.js`), renderers `WosViews` (`web/core/views.js`) | — |
| Screen capture | `WosScreenCapture` (`web/core/screen-capture.js`), `WosCaptureTools` (`web/core/capture-tools.js`) | — |
| Update banners, Settings card, Home pop-up | `WizWebUpdate`, `WizAppUpdates` (`web/core/web-update.js`), `WizAppVersions` (`web/core/app-versions.js`), `WosUpdates` (`web/core/os-updates.js`: `card`/`popup`) | own reload timers, a second card |
| Provider login (Claude, ChatGPT) for agents and apps | the installed login apps (`wizard-claude`, `wizard-chatgpt`; skill `app-owned-codex-connections`) | setup-tokens or bespoke auth flows |
| Native mic recording on the phone (voice notes, orb takes, live dictation) | `NoteRecorder` (`android/app/src/main/java/ai/wizards/os/audio/NoteRecorder.java`) over `MicRoute` (`audio/MicRoute.java`: `MicRoute.start` with `MicRoute.NOTE_SOURCES` for notes people listen to, `MicRoute.SOURCES` for speech-to-text) | `new MediaRecorder`, `AudioRecord` or `setAudioSource` outside `audio/` | `MicRouteTest`, `NoteRecorderTest` (source order, bitrate, every recorder goes through `MicRoute`) |
| Native Android device capability called from the shell (packages today; later mic, automation, notifications) | `wizardDevicePort` v1 (`android/app/src/main/java/ai/wizards/os/device/DeviceMessageProtocol.java`; add an adapter and list it in `device.capabilities`; see `docs/android-device-message-port.md`) | feature-named `@JavascriptInterface` methods, a second envelope on `wizardAppsPort`, native feature screens or wording |
| Add an app to the phone home screen (long-press on the Apps sheet and New desk grid; hold-and-release a one-app desk in Desks) | `WizHomeScreenApps.attach(menu, appFor, {rows, live})`, `WizHomeScreenApps.offer(app)` (`web/core/home-screen-apps.js`) + native `HomeScreenShortcuts`/`AppSessionActivity`; a pinned app keeps the floating orb (`AppState.shellFront`) | a second long-press menu or pin sheet per surface |
| Android long-screenshot (scroll capture) and text selection in the WebView | `ScrollAccessibilityProvider`, `ChatScrollCapture` + `android/app/src/main/assets/scroll-capture.js`, `SelectionWebView` (`android/app/src/main/java/ai/wizards/os/`) | a second accessibility provider or capture path | capture of a long Chats thread on a real device |

## Visual (anything drawn or animated: attach a side-by-side screenshot under `Visual:`)

| Need | Use | Never hand-roll |
|---|---|---|
| The orb, any size | `Orb.create(canvas, fallback, {R})` (`web/orb.js`); Android `android/app/src/main/assets/assist/everywhere.html`, Screen mode `assist/screen.html` | PNG + CSS spin, Lottie, SVG |
| Skins, backgrounds, scenery, skin feature switches (`--wos-orb-swipe-up`, `--wos-reply-regenerate`) | `WosSkin` (`web/core/skins.js`), `WosSkinHost` (`web/core/skin-host.js`; tweaks on `core/slots.json`; `.builtin` gestures, `api.gesture.intent`), `WosExperience` (`web/core/experience.js`: a family's tweaks), `WosMySkin` (`web/core/my-skin.js`), `WosScenery` (`web/core/scenery.js`), `WizAppearance` (`web/core/appearance-host.js`) | own gradients, canvases or colour constants |
| Motion | `WizardMotion` (`web/motion/wizard-motion.js`) | own keyframe sets |
| Tour and help sheet (Talk → Hide → end card; per-step skip); desktop composer guide `WosTour.desk` | `WosTour` (`web/core/tour.js`) | — |
| First launch and explicit Setup/tour; VM auto-onboarding; alongside launch starts only the orientation | `WosSetupLaunch` (`web/core/setup-launch.js`); built-in checklist `web/setup/setup.js` distinguishes ready-to-open from phone-connected | shell-specific first-run checks, a second tour launcher |

## Shell plumbing (owned by one module; never duplicate, rarely called directly)

`WizardApp` (`web/core/app-client.js`), `WizAppCapture` (`web/core/app-capture.js`, behind `WizardApp.capture`), `WosSkinFrame` (`web/core/skin-frame.js`), `WosDevice` (`web/device.js`), `WizAppServices` (`web/core/app-services.js`), `WizCore` (`web/core/core.js`, `web/core/bridge.js`), `WizConfig` (`web/core/config.js`), `WizReach` (`web/core/reach.js`), `WizAndroidRelay` (`web/core/android-relay.js`), `WizBackgroundAudio` (`web/core/background-audio.js`), `WizHomeScreenApps` (`web/core/home-screen-apps.js`), `WizHomeScreenPolicy` (`web/core/home-screen-policy.js`), `WosOwnViews` (`web/core/own-views.js`), `WosOrbHandoff` (`web/core/orb-handoff.js`), `WosSetupLaunch` (`web/core/setup-launch.js`), `WosShareSheet` (`web/core/share-sheet.js`), `WosBell` (`web/core/notif-bell.js`), `WosResources` (`web/core/resources.js`), `WosUsage` (`web/core/usage.js`), `WizPhotosRelay` (`web/core/photos-relay.js`), `WosMusic` (`web/core/music-voice.js`), `WizVideoDesks` (`web/core/video-desks.js`), `WosUsuals` (`web/usuals.js`), phone shell openers `WizAppOpen`, `WizCanOpen`, `WizOpenApp`, `WizOpenAgentChats` (`web/app.js`).
