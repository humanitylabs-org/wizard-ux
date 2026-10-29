# Shared components

**One implementation per capability.** NEW: `web/core/` + row, never an app.

CI: [reuse gate](app-reuse-gate.md).

```
Reuse:
- chat: REUSE WizardApp.nav.openThread
- orb: EXTEND Orb.create (row updated)
- streak: NEW web/core/streaks.js + row
Visual: <side-by-side screenshot, or "none">
```

`Reuse: n/a (reason)` requires no `web/` or `android/` changes.

## Apps (`WizardApp` via `/wizard-os-home/core/app-client.js` only)

| Need | Use | Never hand-roll | Test the shared path by |
|---|---|---|---|
| Owner signatures | `WizardApp.identity.*` → `wizardDevicePort` | app keys | `wizard-id-bridge.test.mjs` |
| Agent chat | `WizardApp.nav.openThread(sessionId, {reply})`, `nav.openContextDraft` | own chat UI/retries | shell `[data-chats]`; 503: one outbox item/message |
| Home-screen identity + app root | `WizardAppIdentity` (`web/core/app-identity.js`), loaded by SDK | per-app manifest injectors | manifest wins; frames untouched |
| Own chat-box input: paste, drop, Enter | `WizardApp.composer.bind` (Chats' `web/core/composer-input.js`) | own paste/drop/Enter | `qa-composer-input.cjs` |
| File chip before send | `WizardApp.attachChip.node` (Chats' tray, `core/attach-chip.js`) | own chip | `qa-attach-chip.cjs` |
| Open a photo/video full screen (pinch zoom, swipe) | `WizardApp.media.view(items, i)` = Chats' `WosChat.viewer` | own lightbox | Messenger `photo_viewer_browser.cjs` |
| Bound same-app companion | `WizardApp.shell.openCompanion` → `WizCompanionPane` (`web/core/companion-pane.js`); [API](shared-app-services-host.md) | app-specific desks/relays | `qa-companion-pane.cjs`: nested Back |
| Back in app; leave on dismiss | `WizardApp.back.register/push`, `nav.back()`; `WizOpenApp(id,path)` validates repair app URL + origin | guards, 2nd tap | nested Back stays; repair → source chat |
| Skin, tokens, light/dark | `WizardApp.theme.get / onChange`, `--wz-*` roles | theme storage, own dark mode, literal colours | two skins + a live skin change keep app state |
| Native Android skin | `WizardLook` (`android/app/src/main/java/ai/wizards/os/WizardLook.java`): saved roles, Nebula fallback | literal colours in native screens |
| Native offline/connect | `ReachScreen` / `ReachPolicy`, `ConnectActivity` / `ServerSettings` (same native package as `WizardLook`) | duplicate offline/address UI |
| Transcribe audio | `WizardApp.voice.transcribe(blob, {language})` → `{text}` / `{unavailable:true}`; verified frame, 25 MB; `WizConfig.transcribe` | app transcriber | stale/foreign denied; unavailable explicit |
| Share out (people → apps → Other apps) | `WizardApp.share.text / file` | own picker | cancel ≠ shared |
| Receive shares | `WizardApp.share.receive({accepts, targets, receive}) / targets / check` (`docs/SHARE-SHEET.md`) | own inbound route | pending until accepted, ack once |
| Mic, camera, screen capture | `WizardApp.capture.start / pending / ack`, `WizardApp.voiceInput.register` | `getUserMedia`, `MediaRecorder`, mic AudioContext | pending survives Back; ack once |
| Title-bar tools | `WizardApp.titlebar.set(tools)` | an app header repeating the title | tools appear in the shell title bar |
| Fingerprint app secret | `WizardApp.vault` (`VaultBridge`, 2-slot `VaultSlots`) | own ports | cancel keeps old |
| Protect unsaved work from updates | `WizardApp.update.hold` | app service worker, forced reload | released only after save+readback |
| App reading place | `WizAppReadingPosition` (`web/core/app-reading-position.js`), automatic | app-local scroll store | reopen lands at the saved place |
| Motion, haptics, press feel | `WizardMotion` (`/wizard-os-home/motion/wizard-motion.js`) | own spring/haptic helpers | — |
| App kit: rows, sections, empty/add field | `WizardApp`: live `web/kit/wizard-ui.css` + `--wz-*`, then active skin (core/package/My skin) | kit forks; `.wz-field-row` chat; literal colours | two skins + My skin restyle `.wz-*` rows |

## Shell (`web/core/`): both shells and all agents; per-kind variants must EXTEND.

| Need | Use | Never hand-roll |
|---|---|---|
| Chats: Focus, Filter, search, composer, files, read state, Copy/Share; Novairecito Recall/Done | `WizCore` Chats (`web/core/chats.js`, `web/core/chats.css`); All/main Ready inbox + Home count; `setFocus`/`migrateChatsFocus`; `WizLive` data/stream/tools; Sign in diagnosis; revision cache | second Chats/Focus parser; per-agent/shell routing |
| Chats list variant | `WizChatsHost` view slot (`web/core/chats-view.js`) | a forked Chats |
| Bound-view handle; first three appearances glow | `WosSkinHost` built-in (`web/core/edge-peek.js`), host storage | skin-local duplicate |
| Repaint a live view without flicker (only changed nodes move) | `WosMorph.morph` (`web/core/dom-morph.js`) | whole-view `innerHTML` on every live tick |
| Models, retry, composer mic, receipts, reading place | `WosChatPower` (`web/core/chat-power.js`: anchor/offset/atBottom; repair; viewport-bound picker, keyboard room/cleanup) + `WosModels` (`web/core/chat-models.js`; pooled Claude first; fresh; model-aware Sign in, no Retry), `WosErrors` (`web/core/chat-errors.js`), `WosWork` (`web/core/chat-work.js`: expandable history + live tools) | model/error/reading-place forks; duplicate diagnosis notice or parallel live steps list |
| Markdown, drafts, inline/bottom media | `WosChat` (`chat-kit.js`: `helm`, `md`, `copyRich`, `viewer`); Chats `mediaBlock` | own parser/viewer |
| Spaces / Focus | `WizCore` Chats (`web/core/chats.js`), `WizLive.prefOps` (`spaces`); one naming form; `WizLive.spaceSessions(ids)` hydrates; `winAgent`/`modelRoute` route new chats; `WosOutbox.onNew` joins front Space; restored Focus awaits census; hidden agents accept explicit routes; scoped Spaces tool; `WosAgents.colour`/`distinctHues` + `--ch-agent-hue` | automatic subject tabs, separate collection store, per-shell Focus routing or section implementations |
| Pinned threads (synced) | `WosChatPins` (`web/core/chat-pins.js`) | device-local pin lists |
| Snooze thread/message: Later today · Tomorrow · In 2/3/5 days · Next week · Someday; Other date… last; success returns via threadBack like Done | `WosBoomerang` (`web/core/scheduled-reminders.js`) on the one scheduler; Settings → Schedules `WosSchedules` (`web/core/schedules.js`) | own timers or reminder stores |
| Thread topic emoji | `WosTopicEmoji` (`web/core/chat-topic-emojis.js`, data `WosTopicEmojiData`) | — |
| Durable send; >6h held in thread/list for Send/Discard | `WosOutbox`, `WosCarry` (`web/outbox.js`) | own queue |
| Cancelled-recording keep | `WosCancelled` (`web/core/cancelled.js`) | — |
| Share to Wizard | `WizShareWizard` (`web/core/share-wizard.js`) | one sheet; `share.wizard` |
| Uploads of any size | `WizUploads` (`web/core/uploads.js`) | single-fetch uploads |
| Files browse, preview, attach | `WosFiles` (`web/core/files.js`) | own picker |
| Settings in both shells | `WosSettings.register` (`web/core/settings.js`), `focus(id)`, `WosFeatures`; Reply style note; `WizConfig.responseStyle` | shell-only pages |
| Agent identity, glyph, hue; which agents an app joins (`appAgents`: privacy, needs_private_agent) | `WosAgents` (`web/core/agents.js`) | hard-coded agent names or colours |
| App source labels, `wizard://install` | `sourceLabel`, `parseInstallLink` (`web/store/`) | own badges |
| App agent routing, private-app note + setup (incl. Store) | `WosAppRoute` (`web/core/app-route.js`) | — |
| App glyph tiles | `WizSigil` (`web/core/sigils.js`, `web/core/sigils.css`) | PNG/emoji icons |
| Launcher policy | `WizLauncher`, `WizLauncherDefaults` (`core/launcher*.js`); synced prefs + legacy defaults | lists |
| App groups | `WosAppKinds` (`web/core/app-kinds.js`) | forks |
| Brand hat | `WizBrand` (`web/core/brand.js`) | redrawn logos |
| Links: sheet/window (`asWindow`), images, long-press browser/Download/Copy | `WizLinks` (`web/core/links.js`; Android: `WizardOSNative.openInBrowser` / `download`) | `window.open`, own iframe sheet, own link menu |
| Text-selection actions | `WosSelMenu` (`web/core/sel-menu.js`) | own context menu |
| Share sheet, receivers, pending handoffs | `WosShareSheet` (`web/core/share-sheet.js`), entered only via `WosChat.sharePayload` | a second share picker, sending for an app |
| Agent screen context | `WizScreen` (`web/core/screen-text.js`) | own DOM scrape |
| Dictation into a focused field | `WizCore` focused field (`web/core/focused-field.js`); voice `WizCore` (`web/core/voice.js`); mic choice `WosMic` (`web/core/mic.js`) | own recorder/transcriber |
| Local commands | `WosCommands` (`web/core/commands.js`) | a second command parser |
| Screen capture | `WosScreenCapture` (`web/core/screen-capture.js`), `WosCaptureTools` (`web/core/capture-tools.js`) | — |
| Update banners/card/pop-up | `WizWebUpdate`, `WizAppUpdates` (`web/core/web-update.js`), `WizAppVersions` (`web/core/app-versions.js`), `WosUpdates` (`web/core/os-updates.js`: `card`/`popup`) | own reload timers, a second card |
| Provider login (Claude, ChatGPT) for agents and apps | the installed login apps (`wizard-claude`, `wizard-chatgpt`; skill `app-owned-codex-connections`) | setup-tokens or bespoke auth flows |
| Native phone mic recording (voice notes, orb takes, dictation) | `NoteRecorder` (`audio/NoteRecorder.java`) over `MicRoute` (`audio/MicRoute.java`: `MicRoute.start`: `MicRoute.NOTE_SOURCES` for notes, `MicRoute.SOURCES` for STT) | `new MediaRecorder`, `AudioRecord` or `setAudioSource` outside `audio/` | `MicRouteTest`, `NoteRecorderTest` |
| Android shell capabilities | `WosDevicePort` (`web/core/device-port.js`), `WosDeviceRecording` (`web/core/device-recording.js`), `WosDeviceOrb` (`web/core/device-orb.js`); `wizardDevicePort` v1 (`device/DeviceMessageProtocol.java`) | another envelope, recorder/store or feature `@JavascriptInterface`; ack before durable custody |
| Add an app to the home screen | `WizHomeScreenApps.attach / offer / canOffer` (`web/core/home-screen-apps.js`): native pin/guide, dedup echoes, resume retry; `WosExperience` arrange; docs/pwa-app-install.md | second pin menu/sheet |
| Long screenshot, text selection | WebView document scroll, `SelectionWebView`, `ScrollCaptureCrashGuard` (`docs/android-document-scroll.md`) | second capture path | long Chats capture |

## Visual (drawn/animated: side-by-side screenshot under `Visual:`)

| Need | Use | Never hand-roll |
|---|---|---|
| The orb, any size | `Orb.create(canvas, fallback, {R})` (`web/orb.js`, icon/core); Android `android/app/src/main/assets/assist/everywhere.html` | PNG + CSS spin, Lottie, SVG |
| Skins, backgrounds, scenery, skin switches (`--wos-orb-swipe-up`, `--wos-reply-regenerate`) | `WosSkin` (`web/core/skins.js`: setGlass), `WosSkinHost` (`web/core/skin-host.js`; tweaks: `core/slots.json` incl. `home-main`+`paintHome`, `windowRefresh`, beside, inbox+list, `data.read` resources/app, `back.push`), `WosExperience` (`web/core/experience.js`), `WosMySkin` (`web/core/my-skin.js`), `WosScenery` (`web/core/scenery.js`), `WizAppearance` (`web/core/appearance-host.js`) | own gradients, canvases or colour constants |
| Motion | `WizardMotion` (`web/motion/wizard-motion.js`) | own keyframe sets |
| Tour/help ("Step N of 3": Talk, Reply in Chats, Done), responsive Done, skip/exit; desktop guide `WosTour.desk` ("Step N of 2") | `WosTour` (`web/core/tour.js`) | — |
| Install prompt (banner, held while the tour runs) | `WizardPwaInstall` (`web/pwa-install.js`) | a second `beforeinstallprompt` listener |
| First launch and explicit Setup/tour; VM auto-onboarding; alongside launch starts only the orientation | `WosSetupLaunch` (`web/core/setup-launch.js`); built-in checklist `web/setup/setup.js`; phone: `WizPhoneConnect` (`web/core/phone-connect.js`, Settings + onboarding) | shell-specific first-run checks, a second tour launcher |

## App voice/audio

| Module | Contract |
|---|---|
| `web/core/app-voice.js` (`WosAppVoice`) | Registry names/claims. |
| `web/core/voice-legacy.js` (`WosVoiceLegacy`) | Frozen Music grammar and legacy device schema until APK A; Food owns its grammar. |
| `web/core/background-audio-legacy.js` (`WizBackgroundAudioLegacy`) | Pilot grant/token until APK A. |

## Plumbing (single owner)

`WizCompanionPane` (`web/core/companion-pane.js`), `WizardApp` (`web/core/app-client.js`), `WizAppCapture` (`web/core/app-capture.js`), `WizComposerInput` (`web/core/composer-input.js`), `WizAttachChip` (`web/core/attach-chip.js`), `WosSkinFrame` (`web/core/skin-frame.js`), `WosDevice` (`web/device.js`), `WizAppServices` (`web/core/app-services.js`), `WizCore` (`web/core/core.js`, `bridge.js`), `WizConfig` (`web/core/config.js`), `WizReach` (`web/core/reach.js`), `WizAndroidRelay` (`web/core/android-relay.js`), `WizBackgroundAudio` (`web/core/background-audio.js`), `WizHomeScreenPolicy` (`web/core/home-screen-policy.js`), `WosOwnViews` (`web/core/own-views.js`), `WosOrbHandoff` (`web/core/orb-handoff.js`), `WosShareSheet` (`web/core/share-sheet.js`), `WosBell` (`web/core/notif-bell.js`, items), `WosResources` (`web/core/resources.js`), `WosUsage` (`web/core/usage.js`), `WizPhotosRelay` (`web/core/photos-relay.js`), `WosMusic`, `WizDeviceLegacy` (`web/core/voice-legacy.js`), openers `WizAppOpen`, `WizCanOpen`, `WizOpenApp`, `WizOpenAgentChats` (`web/app.js`), `WosBoundView` (`web/core/bound-view.js`), `WosWorkspaceSync` (`web/core/workspace-sync.js`, rig).

Devices (James approved 29 Oct): EXTEND `WizPhoneConnect` with #648’s QR/checklist/Done flow; Jan’s #677 owns Settings management. REUSE `web/kit/controls.css` from the Wizard kit. Setup + Mac onboarding share it.
