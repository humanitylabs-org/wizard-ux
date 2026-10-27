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
| Agent chat | `WizardApp.nav.openThread(sessionId, {reply})`, `nav.openContextDraft` | own composer/transcript/retries | shell `[data-chats]`; 503: one outbox item/message |
| Top-level home-screen name, icon and app root | `WizardAppIdentity` (`web/core/app-identity.js`), loaded by SDK | per-app manifest injectors | app-owned manifest wins; frames untouched |
| Own chat-box input: paste, drop, Enter | `WizardApp.composer.bind` (Chats' `web/core/composer-input.js`) | own paste/drop/Enter | `qa-composer-input.cjs` |
| File chip before send | `WizardApp.attachChip.node` (Chats' tray, `core/attach-chip.js`) | own chip | `qa-attach-chip.cjs` |
| Open a photo/video full screen (pinch zoom, swipe) | `WizardApp.media.view(items, i)` = Chats' `WosChat.viewer` | own lightbox | Messenger `photo_viewer_browser.cjs` |
| Bound same-app companion | `WizardApp.shell.openCompanion` → `WizCompanionPane` (`web/core/companion-pane.js`); [API](shared-app-services-host.md) | app-specific desks/relays | `qa-companion-pane.cjs`: nested Back |
| Back in app; leave on dismiss | `WizardApp.back.register/push`, `nav.back()`; `WizOpenApp(id,path)` validates repair app URL + origin | guards, 2nd tap | nested Back stays; repair → originating chat |
| Skin, tokens, light/dark | `WizardApp.theme.get / onChange`, `--wz-*` roles | theme storage, own dark mode, literal colours | two skins + a live skin change keep app state |
| Native Android screens in the worn skin | `WizardLook` (`android/app/src/main/java/ai/wizards/os/WizardLook.java`): saved shell roles, Nebula fallback | literal colours in native screens |
| Native offline/connect | `ReachScreen` / `ReachPolicy`, `ConnectActivity` / `ServerSettings` (same native package as `WizardLook`) | duplicate offline/address UI |
| Transcribe audio | `WizardApp.voice.transcribe(blob, {language})` → `{text}` / `{unavailable:true}`; verified frame, 25 MB; `WizConfig.transcribe` | app transcriber | stale/foreign denied; unavailable explicit |
| Share out (people → apps → Other apps) | `WizardApp.share.text / file` | own picker | cancel ≠ shared |
| Receive shares | `WizardApp.share.receive({accepts, targets, receive}) / targets / check` (`docs/SHARE-SHEET.md`) | own inbound route | pending until accepted, ack once |
| Mic, camera, screen capture | `WizardApp.capture.start / pending / ack`, `WizardApp.voiceInput.register` | `getUserMedia`, `MediaRecorder`, mic AudioContext | pending survives Back; ack once |
| Title-bar tools | `WizardApp.titlebar.set(tools)` | an app header repeating the title | tools appear in the shell title bar |
| Protect unsaved work from updates | `WizardApp.update.hold` | app service worker, forced reload | released only after save+readback |
| Reading place in an app document | shell-owned `WizAppReadingPosition` (`web/core/app-reading-position.js`), automatic for registered apps | app-local scroll store | reopen lands at the saved place |
| Motion, haptics, press feel | `WizardMotion` (`/wizard-os-home/motion/wizard-motion.js`) | own spring/haptic helpers | — |
| App look: rows, sections, empty state, single-line add field | `WizardApp`: live `web/kit/wizard-ui.css` + `--wz-*`, then active skin (core/package/My skin) | forked kit; `.wz-field-row` chat composer; literal colours | two skins + My skin restyle `.wz-*` rows |

## Shell (`web/core/`): both shells and all agents; per-kind variants must EXTEND.

| Need | Use | Never hand-roll |
|---|---|---|
| Chats: agent/Space Focus, Filter, sections, search, composer, files, read state, Copy/Share; Novairecito Recall/Done | `WizCore` Chats (`web/core/chats.js`, `web/core/chats.css`); `setFocus` persists `w.focus`; `migrateChatsFocus` migrates; `WizLive` owns data, stream + tool steps; diagnosis: Sign in; revision invalidates cache | second Chats/Focus parser; per-agent/shell routing |
| Alternative Chats list | `WizChatsHost` view slot (`web/core/chats-view.js`) | a forked Chats |
| Bound-view handle; first three appearances glow | `WosSkinHost` built-in (`web/core/edge-peek.js`), host storage | skin-local duplicate |
| Repaint a live view without flicker (only changed nodes move) | `WosMorph.morph` (`web/core/dom-morph.js`) | whole-view `innerHTML` on every live tick |
| Models, retry, composer mic, receipts, reading place | `WosChatPower` (`web/core/chat-power.js`: per-thread anchor/offset/atBottom; repair workflow) + `WosModels` (`web/core/chat-models.js`; pooled Claude first, fresh on open; diagnosed variant: model-aware Sign in, no Retry), `WosErrors` (`web/core/chat-errors.js`), `WosWork` (`web/core/chat-work.js`: one expandable activity group: timed history + live tool previews) | model/error/reading-place forks; duplicate diagnosis notice or parallel live steps list |
| Markdown, drafts, inline/bottom media | `WosChat` (`chat-kit.js`: `helm`, `md`, `copyRich`, `viewer`); Chats `mediaBlock` | own parser/viewer |
| Owner-created Spaces / Focus | `WizCore` Chats (`web/core/chats.js`), `WizLive.putPrefs` (`spaces`); one Space naming form; `WizLive.spaceSessions(ids)` hydrates focused members; `winAgent` / `modelRoute` drive every new-chat adapter; new threads join the Space in front (`WosOutbox.onNew`); restored Focus waits for a complete agent census, hidden agents stay explicit-route targets, New Space fills use the scoped Spaces tool for main and routed agents; `WosAgents.colour` / `distinctHues` drive tab identity and `--ch-agent-hue` | automatic subject tabs, separate collection store, per-shell Focus routing or section implementations |
| Pinned threads (synced across devices) | `WosChatPins` (`web/core/chat-pins.js`) | device-local pin lists |
| Snooze thread/message: Later today · Tomorrow · In 2/3/5 days · Next week · Someday; Other date… last; success returns via threadBack like Done | `WosBoomerang` (`web/core/scheduled-reminders.js`) on the one scheduler; Settings → Schedules `WosSchedules` (`web/core/schedules.js`) | own timers or reminder stores |
| Thread topic emoji | `WosTopicEmoji` (`web/core/chat-topic-emojis.js`, data `WosTopicEmojiData`) | — |
| Durable send: survives outages, no duplicates | `WosOutbox`, `WosCarry` (`web/outbox.js`) | fetch + retry loop |
| Cancelled-recording keep | `WosCancelled` (`web/core/cancelled.js`) | — |
| Share to Wizard | `WizShareWizard` (`web/core/share-wizard.js`) | Native/app input → one phone/desktop sheet; `share.wizard` |
| Uploads of any size | `WizUploads` (`web/core/uploads.js`) | file input + single fetch |
| Files browse, preview, attach | `WosFiles` (`web/core/files.js`) | own picker |
| Settings in both shells | `WosSettings.register` (`web/core/settings.js`), `focus(id)`, `WosFeatures`; Response style: `WizConfig.responseStyle`, owner PUT + GET | shell-only pages |
| Agent identity, glyph, hue; which agents an app joins (`appAgents`: privacy, needs_private_agent) | `WosAgents` (`web/core/agents.js`) | hard-coded agent names or colours |
| App source labels, `wizard://install` | `sourceLabel`, `parseInstallLink` (`web/store/`) | own badges |
| App agent routing, private-app note + setup (incl. Store) | `WosAppRoute` (`web/core/app-route.js`) | — |
| App glyph tiles | `WizSigil` (`web/core/sigils.js`, `web/core/sigils.css`) | PNG/emoji icons |
| Launcher policy | `WizLauncher`, `WizLauncherDefaults` (`core/launcher*.js`); synced prefs + old-service defaults | lists |
| App groups | `WosAppKinds` (`web/core/app-kinds.js`) | forks |
| Brand hat | `WizBrand` (`web/core/brand.js`) | redrawn logos |
| Links: phone sheet, desktop window (`asWindow`), images, long-press browser / Download / Copy | `WizLinks` (`web/core/links.js`; Android: `WizardOSNative.openInBrowser` / `download`) | `window.open`, own iframe sheet, own link menu |
| Text-selection actions | `WosSelMenu` (`web/core/sel-menu.js`) | own context menu |
| Share sheet, receivers, pending handoffs | `WosShareSheet` (`web/core/share-sheet.js`), entered only via `WosChat.sharePayload` | a second share picker, sending for an app |
| Screen context for the agent | `WizScreen` (`web/core/screen-text.js`) | own DOM scrape |
| Dictation into a focused field | `WizCore` focused field (`web/core/focused-field.js`); voice `WizCore` (`web/core/voice.js`); mic choice `WosMic` (`web/core/mic.js`) | own recorder/transcriber |
| Local commands | `WosCommands` (`web/core/commands.js`) | a second command parser |
| Screen capture | `WosScreenCapture` (`web/core/screen-capture.js`), `WosCaptureTools` (`web/core/capture-tools.js`) | — |
| Update banners, Settings card, Home pop-up | `WizWebUpdate`, `WizAppUpdates` (`web/core/web-update.js`), `WizAppVersions` (`web/core/app-versions.js`), `WosUpdates` (`web/core/os-updates.js`: `card`/`popup`) | own reload timers, a second card |
| Provider login (Claude, ChatGPT) for agents and apps | the installed login apps (`wizard-claude`, `wizard-chatgpt`; skill `app-owned-codex-connections`) | setup-tokens or bespoke auth flows |
| Native mic recording on the phone (voice notes, orb takes, live dictation) | `NoteRecorder` (`android/app/src/main/java/ai/wizards/os/audio/NoteRecorder.java`) over `MicRoute` (`audio/MicRoute.java`: `MicRoute.start` with `MicRoute.NOTE_SOURCES` for notes people listen to, `MicRoute.SOURCES` for speech-to-text) | `new MediaRecorder`, `AudioRecord` or `setAudioSource` outside `audio/` | `MicRouteTest`, `NoteRecorderTest` |
| Android shell capabilities | `WosDevicePort` (`web/core/device-port.js`), `WosDeviceRecording` (`web/core/device-recording.js`), `WosDeviceOrb` (`web/core/device-orb.js`); `wizardDevicePort` v1 | another envelope or recorder/store; ack before durable custody |
| Add an app to the home screen | `WizHomeScreenApps.attach / offer / canOffer` (`web/core/home-screen-apps.js`): native pin or direct-link guide; pins self-refresh; optional `WosExperience` arrange/download tweak; docs/pwa-app-install.md | a second long-press menu or pin sheet per surface |
| Android long-screenshot (scroll capture) and text selection in the WebView | `ScrollAccessibilityProvider`, `ChatScrollCapture` + `android/app/src/main/assets/scroll-capture.js`, `SelectionWebView` (`android/app/src/main/java/ai/wizards/os/`) | a second accessibility provider or capture path | capture of a long Chats thread on a real device |

## Visual (drawn/animated: side-by-side screenshot under `Visual:`)

| Need | Use | Never hand-roll |
|---|---|---|
| The orb, any size | `Orb.create(canvas, fallback, {R})` (`web/orb.js`); Android mirror `android/app/src/main/assets/assist/everywhere.html` | PNG + CSS spin, Lottie, SVG |
| Skins, backgrounds, scenery, skin switches (`--wos-orb-swipe-up`, `--wos-reply-regenerate`) | `WosSkin` (`web/core/skins.js`), `WosSkinHost` (`web/core/skin-host.js`; tweaks: `core/slots.json` incl. `home-main` + `paintHome`, `windowRefresh`, beside, inbox, `data.read` resources/app, `back.push`), `WosExperience` (`web/core/experience.js`), `WosMySkin` (`web/core/my-skin.js`), `WosScenery` (`web/core/scenery.js`), `WizAppearance` (`web/core/appearance-host.js`) | own gradients, canvases or colour constants |
| Motion | `WizardMotion` (`web/motion/wizard-motion.js`) | own keyframe sets |
| Tour/help ("Step N of 3": Talk, Reply in Chats, Done), responsive Done, skip/exit; desktop guide `WosTour.desk` ("Step N of 2") | `WosTour` (`web/core/tour.js`) | — |
| Install prompt (banner, held while the tour runs) | `WizardPwaInstall` (`web/pwa-install.js`) | a second `beforeinstallprompt` listener |
| First launch and explicit Setup/tour; VM auto-onboarding; alongside launch starts only the orientation | `WosSetupLaunch` (`web/core/setup-launch.js`); built-in checklist `web/setup/setup.js` distinguishes ready-to-open from phone-connected | shell-specific first-run checks, a second tour launcher |

## App voice/audio

| Module | Contract |
|---|---|
| `web/core/app-voice.js` (`WosAppVoice`) | Registry names/claims. |
| `web/core/voice-legacy.js` (`WosVoiceLegacy`) | Frozen Music grammar and legacy device schema until APK A; Food owns its grammar. |
| `web/core/background-audio-legacy.js` (`WizBackgroundAudioLegacy`) | Pilot grant/token until APK A. |

## Plumbing (single owner)

`WizCompanionPane` (`web/core/companion-pane.js`), `WizardApp` (`web/core/app-client.js`), `WizAppCapture` (`web/core/app-capture.js`), `WizComposerInput` (`web/core/composer-input.js`), `WizAttachChip` (`web/core/attach-chip.js`), `WosSkinFrame` (`web/core/skin-frame.js`), `WosDevice` (`web/device.js`), `WizAppServices` (`web/core/app-services.js`), `WizCore` (`web/core/core.js`, `web/core/bridge.js`), `WizConfig` (`web/core/config.js`), `WizReach` (`web/core/reach.js`), `WizAndroidRelay` (`web/core/android-relay.js`), `WizBackgroundAudio` (`web/core/background-audio.js`), `WizHomeScreenApps` (`web/core/home-screen-apps.js`), `WizHomeScreenPolicy` (`web/core/home-screen-policy.js`), `WosOwnViews` (`web/core/own-views.js`), `WosOrbHandoff` (`web/core/orb-handoff.js`), `WosSetupLaunch` (`web/core/setup-launch.js`), `WosShareSheet` (`web/core/share-sheet.js`), `WosBell` (`web/core/notif-bell.js`), `WosResources` (`web/core/resources.js`), `WosUsage` (`web/core/usage.js`), `WizPhotosRelay` (`web/core/photos-relay.js`), `WosMusic`, `WizDeviceLegacy` (`web/core/voice-legacy.js`), openers `WizAppOpen`, `WizCanOpen`, `WizOpenApp`, `WizOpenAgentChats` (`web/app.js`), `WosBoundView` (`web/core/bound-view.js`), `WosWorkspaceSync` (`web/core/workspace-sync.js`).
