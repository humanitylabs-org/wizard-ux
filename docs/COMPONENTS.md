# Shared components

**Appearance:** [Wizard app style guide](https://github.com/humanitylabs-org/wizard-os/blob/main/style/APP-DESIGN-RULES.md). Inventory.

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
| Full-screen photo/video | `WizardApp.media.view(items, i)` = Chats' `WosChat.viewer` | own lightbox | Messenger `photo_viewer_browser.cjs` |
| Bound same-app companion | `WizardApp.shell.openCompanion` → `WizCompanionPane` (`web/core/companion-pane.js`); [API](shared-app-services-host.md) | app-specific desks/relays | `qa-companion-pane.cjs`: nested Back |
| Back in app; leave on dismiss | `WizardApp.back.register/push`, `nav.back()`; `WizOpenApp(id,path)` validates repair app URL + origin | guards, 2nd tap | nested Back stays; repair → source chat |
| Skin, tokens, light/dark | `WizardApp.theme.get / onChange`, `--wz-*` roles | theme storage, own dark mode, literal colours | two skins + live change keep state |
| Native Android skin | `WizardLook` (`android/app/src/main/java/ai/wizards/os/WizardLook.java`): saved roles, Nebula fallback | literal colours in native screens |
| Native offline/connect | `ReachScreen` / `ReachPolicy`, `ConnectActivity` / `ServerSettings` (same package) | duplicate offline/address UI |
| Transcribe audio | `WizardApp.voice.transcribe(blob, {language})` → `{text}` / `{unavailable:true}`; verified frame, 25 MB; `WizConfig.transcribe` | app transcriber | stale/foreign denied; unavailable explicit |
| Share out (people → apps → Other) | `WizardApp.share.text / file` | own picker | cancel ≠ shared |
| Receive shares | `WizardApp.share.receive({accepts, targets, receive}) / targets / check` (`docs/SHARE-SHEET.md`) | own inbound route | pending until accepted, ack once |
| Mic, camera, screen capture | `WizardApp.capture.start / pending / ack`, `WizardApp.voiceInput.register` | `getUserMedia`, `MediaRecorder`, mic AudioContext | pending survives Back; ack once |
| Duck Music; orb app button | `WizardApp.audio.duck(on)`; `.orb.claim/release` (two-orb) | own volume/FAB | off on close |
| Title-bar tools | `WizardApp.titlebar.set(tools)` | repeated title header | tools in the shell bar |
| Fingerprint app secret | `WizardApp.vault` (`VaultBridge`, 2-slot `VaultSlots`) | own ports | cancel keeps old |
| Offline replica, durable edits | `WizOffline.create` (`core/offline-kit.js`) | app outbox | recoverable failures |
| Protect unsaved work from updates | `WizardApp.update.hold` | app SW, forced reload | release after save+readback |
| Offline shell | `web/sw.js` | caching `/wizard/*` | `shell-offline-sw.test.mjs` |
| App reading place | `WizAppReadingPosition` (`web/core/app-reading-position.js`), automatic | app-local scroll store | reopen lands at the saved place |
| Motion, haptics, press feel | `WizardMotion` (`/wizard-os-home/motion/wizard-motion.js`) | own spring/haptic helpers | — |
| Canonical style admission | `check_style.py` (`wizard-os/style/`), mirrored in WAM | per-app lint forks | legacy warns; changed lines fail |
| App kit: rows, sections, empty/add field | `WizardApp`: live `web/kit/wizard-ui.css` + `--wz-*`, then active skin (core/package/My skin) | kit forks; `.wz-field-row` chat; literal colours | two skins + My skin restyle `.wz-*` rows |

## Shell (`web/core/`): both shells and all agents; per-kind variants must EXTEND.

| Need | Use | Never hand-roll |
|---|---|---|
| Pages: list, viewer, editor, history, bridge | `WosPages` (`pages.js`) | app powers |
| Action menu | `WosContextMenu.open`/`.back` (`core/context-menu.js`) | local menus |
| App setup | `WosAppSetup` (`app-setup.js`) | app-local setup |
| Chats: Focus/Filter/search, composer/files/read, Copy/Share, Recall/Done | `WizCore` (`chats.js`, `.css`); Ready/Home/original alerts; `setFocus`/`migrateChatsFocus`; `WizLive`; provider-access Errors; source-bound send release; cache | duplicate Chats/Focus |
| Chats list variant | `WizChatsHost` view slot (`chats-view.js`) | a forked Chats |
| Bound-view handle; first three appearances glow | `WosSkinHost` built-in (`edge-peek.js`), host storage | skin-local duplicate |
| Repaint a live view without flicker (only changed nodes move) | `WosMorph.morph` (`dom-morph.js`) | whole-view `innerHTML` on every live tick |
| Models, retry, composer mic, receipts, reading place | `WosChatPower` (`chat-power.js`: reading anchor, repair, viewport/keyboard cleanup); `WosModels` (`chat-models.js`: pooled Claude first, provider-access Error + Retry/Choose another model, acknowledged source-bound retry); `WosErrors` (`chat-errors.js`); `WosWork` (`chat-work.js`: history/live tools) | model/error/reading-place forks; duplicate diagnosis/live steps |
| Markdown, drafts, inline/bottom media | `WosChat` (`chat-kit.js`: `helm`, `md`, `copyRich`, `viewer`); Chats `mediaBlock` | own parser/viewer |
| Spaces / Focus | `WizCore` Chats (`chats.js`), `WizLive.prefOps` (`spaces`; add = move, one Space per chat); one naming form; `WizLive.spaceSessions(ids)` hydrates; `winAgent`/`modelRoute` route new chats; `WosOutbox.onNew` joins front Space; restored Focus awaits census; hidden agents accept explicit routes; scoped Spaces tool; `WosAgents.colour`/`distinctHues` + `--ch-agent-hue` | automatic subject tabs, separate collection store, per-shell Focus routing or section implementations |
| Pinned threads (synced); tweaks swap | `WosChatPins` (`chat-pins.js`) in `WosParts` | device-local pin lists |
| Snooze thread/message: Later today · Tomorrow · In 2/3/5 days · Next week · Someday; Other date… last; success returns via threadBack like Done | `WosBoomerang` (`scheduled-reminders.js`) on the one scheduler; Settings → Schedules `WosSchedules` (`schedules.js`) | own timers or reminder stores |
| Thread topic emoji | `WosTopicEmoji` (`chat-topic-emojis.js`, data `WosTopicEmojiData`) | — |
| Durable send, saved Retry, failed Dismiss; >6h hold | `WosOutbox`, `WosCarry` (`web/outbox.js`) | own queue |
| Cancelled-recording keep | `WosCancelled` (`cancelled.js`) | — |
| Share to Wizard | `WizShareWizard` (`share-wizard.js`) | one sheet; `share.wizard`; native `durable` |
| Uploads of any size | `WizUploads` (`uploads.js`) | single-fetch uploads |
| Files browse, preview, attach | `WosFiles` (`files.js`) | own picker |
| Settings in both shells | `WosSettings.register` (`settings.js`), `focus(id)`, `WosFeatures`; Reply style note; `WizConfig.responseStyle` | shell-only pages |
| Agent identity, glyph, hue; which agents an app joins (`appAgents`: privacy, needs_private_agent) | `WosAgents` (`agents.js`) | hard-coded agent names or colours |
| App source labels, `wizard://install` | `sourceLabel`, `parseInstallLink` (`web/store/`) | own badges |
| App agent routing, private-app note + setup (incl. Store) | `WosAppRoute` (`app-route.js`) | — |
| App glyph tiles | `WizSigil` (`sigils.js`, `sigils.css`) | PNG/emoji icons |
| Launcher policy | `WizLauncher`, `WizLauncherDefaults` (`core/launcher*.js`); synced prefs + legacy defaults | lists |
| App groups | `WosAppKinds` (`app-kinds.js`) | forks |
| Brand hat | `WizBrand` (`brand.js`) | redrawn logos |
| Links: sheet/window (`asWindow`), images, long-press browser/Download/Copy | `WizLinks` (`links.js`; Android: `WizardOSNative.openInBrowser` / `download`) | `window.open`, own iframe sheet, own link menu |
| Text-selection actions | `WosSelMenu` (`sel-menu.js`) | own context menu |
| Share sheet (text/url/image/file), receivers, pending handoffs | `WosShareSheet` (`share-sheet.js`), entered via `WosChat.sharePayload`/`shareFile`; hold → tray: `bindSharePress` | a second share picker, sending for an app |
| Agent screen context | `WizScreen` (`screen-text.js`) | own DOM scrape |
| Dictation into a focused field | `WizCore` focused field (`focused-field.js`); voice `WizCore` (`voice.js`); mic choice `WosMic` (`mic.js`) | own recorder/transcriber |
| Local commands | `WosCommands` (`commands.js`) | a second command parser |
| Screen capture | `WosScreenCapture` (`screen-capture.js`), `WosCaptureTools` (`capture-tools.js`) | — |
| Update banners/card/pop-up | `WizWebUpdate`, `WizAppUpdates` (`web-update.js`), `WizAppVersions` (`app-versions.js`), `WosUpdates` (`os-updates.js`: `card`/`popup`) | own reload timers, a second card |
| Provider login (Claude, ChatGPT) for agents and apps | the installed login apps (`wizard-claude`, `wizard-chatgpt`; skill `app-owned-codex-connections`) | setup-tokens or bespoke auth flows |
| Native phone mic recording (voice notes, orb takes, dictation) | `NoteRecorder` (`audio/NoteRecorder.java`) over `MicRoute` (`audio/MicRoute.java`: `MicRoute.start`: `MicRoute.NOTE_SOURCES` for notes, `MicRoute.SOURCES` for STT) | `new MediaRecorder`, `AudioRecord` or `setAudioSource` outside `audio/` | `MicRouteTest`, `NoteRecorderTest` |
| Android shell capabilities | `WosDevicePort` (`device-port.js`), `WosDeviceRecording` (`device-recording.js`), `WosDeviceOrb` (`device-orb.js`); `wizardDevicePort` v1 (`device/DeviceMessageProtocol.java`) | another envelope, recorder/store or feature `@JavascriptInterface`; ack before durable custody |
| Add an app to the home screen | `WizHomeScreenApps.attach / offer / canOffer` (`home-screen-apps.js`): native pin/guide, dedup echoes, resume retry; `WosExperience` arrange; docs/pwa-app-install.md | second pin menu/sheet |
| Long screenshot, text selection | WebView document scroll, `SelectionWebView`, `ScrollCaptureCrashGuard` (`docs/android-document-scroll.md`) | second capture path | long Chats capture |

## Visual (drawn/animated: side-by-side screenshot under `Visual:`)

| Need | Use | Never hand-roll |
|---|---|---|
| The orb, any size | `Orb.create(canvas, fallback, {R})` (`web/orb.js`, icon/core); Android `android/app/src/main/assets/assist/everywhere.html` | PNG + CSS spin, Lottie, SVG |
| Skins, backgrounds, scenery, skin switches (`--wos-orb-swipe-up`, `--wos-reply-regenerate`) | `WosSkin` (`web/core/skins.js`: setGlass), `WosSkinHost` (`web/core/skin-host.js`; tweaks: `core/slots.json` incl. `home-main`+`paintHome`, `windowRefresh`, beside, inbox+list, `data.read` resources/app/sessions, `back.push`), `WosExperience` (`web/core/experience.js`), `WosMySkin` (`web/core/my-skin.js`; bad `skin.js` → off), `WosScenery` (`web/core/scenery.js`), `WizAppearance` (`web/core/appearance-host.js`) | own gradients, canvases or colour constants |
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

## Plumbing (single owner; files in `web/core/` unless noted)

`WizCompanionPane` (`companion-pane.js`), `WizardApp` (`app-client.js`), `WizAppCapture` (`app-capture.js`), `WizComposerInput` (`composer-input.js`), `WizAttachChip` (`attach-chip.js`), `WosSkinFrame` (`skin-frame.js`), `WosDevice` (`web/device.js`), `WizAppServices` (`app-services.js`), `WizCore` (`core.js`, `bridge.js`), `WizConfig` (`config.js`), `WizReach` (`reach.js`), `WizAndroidRelay` (`android-relay.js`), `WizBackgroundAudio` (`background-audio.js`), `WizHomeScreenPolicy` (`home-screen-policy.js`), `WosOwnViews` (`own-views.js`), `WosOrbHandoff` (`orb-handoff.js`), `WosShareSheet` (`share-sheet.js`), `WosBell` (`notif-bell.js`, items), `WosResources` (`resources.js`), `WosUsage` (`usage.js`), `WizPhotosRelay` (`photos-relay.js`), `WosMusic`, `WizDeviceLegacy` (`voice-legacy.js`), openers `WizAppOpen`, `WizCanOpen`, `WizOpenApp`, `WizOpenAgentChats` (`web/app.js`), `WosBoundView` (`bound-view.js`), `WosWorkspaceSync` (`workspace-sync.js`, rig).

AI usage: EXTEND `WosResources`/`WosUsage` for extra usage; an unknown cap or spend shows as text, never zero or unlimited (`tests/claude-extra-usage.test.mjs`).

Devices: `WizPhoneConnect`, #677 + #648, shared kit. Setup/Mac reuse; +16px tinted Setup action, step-2 green check/Show again, final Done.
