# Shared components


[Appearance rules](https://github.com/humanitylabs-org/wizard-os/blob/main/style/APP-DESIGN-RULES.md).

**One implementation per capability.** NEW: `web/core/` + row, never an app.

CI: [reuse gate](app-reuse-gate.md).

```
Reuse:
- chat: REUSE WizardApp.nav.openThread
- orb: EXTEND Orb.create (row updated)
- streak: NEW web/core/streaks.js + row
```

`Reuse: n/a (reason)` requires no `web/` or `android/` changes.

## Apps (`WizardApp`)

| Need | Use | Never hand-roll | Test the shared path by |
|---|---|---|---|
| Owner signatures | `WizardApp.identity.*` → `wizardDevicePort` | app keys | `wizard-id-bridge.test.mjs` |
| Agent chat | `WizardApp.nav.openThread(sessionId, {reply})`, `nav.openContextDraft` | own chat UI/retries | shell `[data-chats]`; 503: one outbox item/message |
| Home-screen identity + app root | `WizardAppIdentity` (`web/core/app-identity.js`), loaded by SDK | per-app manifest injectors | manifest wins; frames untouched |
| Own chat-box input: paste, drop, Enter | `WizardApp.composer.bind` (Chats' `web/core/composer-input.js`) | own paste/drop/Enter | `qa-composer-input.cjs` |
| File chip before send | `WizardApp.attachChip.node` (Chats' tray, `core/attach-chip.js`) | own chip | `qa-attach-chip.cjs` |
| Media | `WizardApp.media.view(items, i)` = `WosChat.viewer` | own lightbox | `photo_viewer_browser.cjs` |
| Same-app companion | `WizardApp.shell.openCompanion` → `WizCompanionPane` (`web/core/companion-pane.js`); [API](shared-app-services-host.md) | own desks/relays | `qa-companion-pane.cjs` |
| Back/dismiss | `WizardApp.back.register/push`, `nav.back()`; `WizOpenApp(id,path)` validates URL/origin | guards, 2nd tap | nested Back; repair returns |
| Skin, tokens, light/dark | `WizardApp.theme.get / onChange`, `--wz-*` roles | theme storage, own dark mode, literal colours | two skins + live change keep state |
| Android skin | `WizardLook` (`android/app/src/main/java/ai/wizards/os/WizardLook.java`): saved roles/Nebula | literal colours |
| Offline/connect | `ReachScreen` / `ReachPolicy`, `TailscaleGuide`, `ConnectActivity` / `ServerSettings`; web `WizReach` | duplicate UI |
| Transcribe | `WizardApp.voice.transcribe(blob, {language})` → `{text}` / `{unavailable:true}`; verified frame, 25 MB; `WizConfig.transcribe` recheck | app transcriber | stale/foreign denied |
| Share out (agents → apps → Other) | `WizardApp.share.text / file` | own picker | cancel ≠ shared |
| Receive shares | `WizardApp.share.receive({accepts, targets, receive}) / targets / check` (`docs/SHARE-SHEET.md`) | own route | pending → accepted, ack once |
| Mic, camera, screen capture | `WizardApp.capture.start / current / settle / pending / ack`, `WizardApp.voiceInput.register` | `getUserMedia`, `MediaRecorder`, mic AudioContext | pending survives Back; ack once |
| Duck Music; orb app button | `WizardApp.audio.duck(on)`; `.orb.claim/release` (two-orb) | own volume/FAB | off on close |
| Title-bar tools | `WizardApp.titlebar.set(tools)` | repeated header | icons/dot in shell bar |
| Fingerprint app secret | `WizardApp.vault` (`VaultBridge`, 2-slot `VaultSlots`) | own ports | cancel keeps old |
| Offline replica/edits | `WizOffline.create` / `.presentation` (`core/offline-kit.js`); Wisdom pin snapshots | app outbox/position DB | recoverable fail; commit before boot |
| Protect unsaved work from updates | `WizardApp.update.hold` | app SW, forced reload | release after save+readback |
| Offline shell | `WizOfflineSession` (`web/core/offline-session.js`), `web/sw.js`, `core/offline-session-config.js`; Wisdom-only `core/offline-apps.js` | app shell / broad API cache | pin reload; sibling caches survive |
| App reading place | `WizAppReadingPosition` (`web/core/app-reading-position.js`), automatic | app-local scroll store | reopen lands at the saved place |
| Motion/haptics | `WizardMotion` (`/wizard-os-home/motion/wizard-motion.js`) | own springs/haptics | — |
| Canonical style admission | `check_style.py` (`wizard-os/style/`), mirrored in WAM | per-app lint forks | legacy warns; changed lines fail |
| App kit | `WizardApp`: `web/kit/wizard-ui.css` + `--wz-*`, then core/package/My skin | kit forks, chat `.wz-field-row`, literals | two skins + My skin |

## Shell (`web/core/`): shared; per-kind variants EXTEND.

| Need | Use | Never hand-roll |
|---|---|---|
| Pages: list, viewer, editor, history, bridge | `WosPages` (`pages.js`) | app powers |
| Action menu | `WosContextMenu.open`/`.back` (`core/context-menu.js`) | local menus |
| App setup | `WosAppSetup` (`app-setup.js`) | app-local setup |
| Chats: Focus/search, composer/files/read, Copy/Share, Recall/Archive | `WizCore` (`chats.js`, `.css`); `WizMorningWrite` Morning writes/held-list paint, stale-poll fence; paint first; alert hold; `WizLive.readyRank`/seq resume; `setFocus`/`migrateChatsFocus`; provider Errors; send/cache; desktop new-send list return; Esc `CHATS.clearFilter(id::list)`; search: Archive last, `c.sOpen` only | duplicate Chats/Focus |
| Chats list variant | `WizChatsHost` view slot (`chats-view.js`) | a forked Chats |
| Bound-view handle; first three appearances glow | `WosSkinHost` built-in (`edge-peek.js`), host storage | skin-local duplicate |
| Repaint without flicker | `WosMorph.morph` (`dom-morph.js`); changed nodes only | whole-view `innerHTML` on live ticks |
| Models/retry, composer mic, receipts, reading place; label clear of draft text | `WosChatPower` (`chat-power.js`); `WosModels` (`chat-models.js`); `WosErrors` (`chat-errors.js`); `WosWork` (`chat-work.js`); composer `WizCore` (`chats.js` `fitLabel`, `chat-power.css` `lab-row`) | forks; model controls over editable text |
| Markdown, drafts, inline/bottom media | `WosChat` (`chat-kit.js`: `helm`, `md`, `copyRich`, `viewer`); Chats `mediaBlock` | own parser/viewer |
| Spaces / Focus | `WizCore` (`chats.js`), `WizLive.prefOps` (`spaces`; add=move); shared form; `WizLive.spaceSessions(ids)`; `winAgent`/`modelRoute`; `WosOutbox.onNew`; restore awaits census; explicit hidden-agent routes; `WosAgents.colour`/`distinctHues`, `--ch-agent-hue` | tabs, second store, per-shell Focus |
| Incognito | `WizCore.incognitoChats` (`incognito-chat.js`); `WizLive.openRunStream`, RAM Retry | durable state or forks |
| Pinned threads (synced) | `WosChatPins` (`chat-pins.js`) | device-local pin lists |
| Snooze thread/message (presets; Other date… last; success returns via threadBack like Done) | `WosBoomerang` (`scheduled-reminders.js`) on the one scheduler; Settings → Schedules `WosSchedules` (`schedules.js`) | own timers or reminder stores |
| Thread topic emoji | `WosTopicEmoji` (`chat-topic-emojis.js`, data `WosTopicEmojiData`) | — |
| Durable send, saved Retry, failed Dismiss; >6h held Send/Discard | `WosOutbox`, `WosCarry` (`web/outbox.js`) | own queue |
| Cancelled-recording keep | `WosCancelled` (`cancelled.js`) | — |
| Share to Wizard | `WizShareWizard` (`share-wizard.js`); Back guard `WizSheetBack` (`sheetback.js`) | one opaque sheet; `share.wizard`; `durable`; own double-Back timer |
| Uploads of any size | `WizUploads` (`uploads.js`) | single-fetch uploads |
| Files browse, preview, attach | `WosFiles` (`files.js`) | own picker |
| Settings (shared pages/versions), instant Appearance receipt | `WosSettings.register/focus`, `lookAction` (rounded art + inline busy), `hasSystem`, `WosFeatures` | shell-only pages |
| Agent identity, glyph, hue; Chats headers follow `WizCore.chats.titleAgent` (thread route or Focus), registry refresh preserves that route; which agents an app joins (`appAgents`: privacy, needs_private_agent) | `WosAgents` (`agents.js`) | hard-coded agent names or colours |
| Store | `storeKind,sourceLabel,parseInstallLink,removeInstalledApp` (`web/store/`) | type ≠ UX |
| App agent routing, private-app note + setup (incl. Store) | `WosAppRoute` (`app-route.js`) | — |
| App icons, logos | `WizSigil` (`sigils.js`, `sigils.css`); Store identity | PNG/emoji icons |
| Desktop frame shortcuts | `watchFrame → onKey` (`desktop/desktop.js`); same-origin window capture + keyup/blur cleanup; no nested/opaque-frame relay | second dispatcher or postMessage key forwarding |
| Launcher policy | `WizLauncher`, `WizLauncherDefaults` (`core/launcher*.js`); synced prefs+defaults, 1s boot cap | lists |
| App groups | `WosAppKinds` (`app-kinds.js`) | forks |
| Brand hat | `WizBrand` (`brand.js`) | redrawn logos |
| Links: sheet/window (`asWindow`), images, long-press browser/Download/Copy | `WizLinks` (`links.js`; Android: `WizardOSNative.openInBrowser` / `download`) | `window.open`, own iframe sheet, own link menu |
| Text-selection actions | `WosSelMenu` (`sel-menu.js`) | own context menu |
| Share sheet, receivers, Agents | `WosShareSheet` (`share-sheet.js`) via `WosChat.sharePayload`/`shareFile`; hold: `bindSharePress`; agents: `WizOpenAgentChats` + `insertText`/`addFiles` | 2nd picker, sending for them |
| Agent screen context | `WizScreen` (`screen-text.js`) | own DOM scrape |
| Dictation into a focused field | `WizCore` focused field (`focused-field.js`); voice `WizCore` (`voice.js`); mic choice `WosMic` (`mic.js`) | own recorder/transcriber |
| Local commands | `WosCommands` (`commands.js`) | a second command parser |
| Screen capture | `WosScreenCapture` (`screen-capture.js`), `WosCaptureTools` (`capture-tools.js`) | — |
| Update banners/card/pop-up | `WizWebUpdate`, `WizAppUpdates` (`web-update.js`), `WizAppVersions` (`app-versions.js`), `WosUpdates` (`os-updates.js`: `card`/`popup`) | own reload timers, a second card |
| Provider login (Claude, ChatGPT) for agents and apps | the installed login apps (`wizard-claude`, `wizard-chatgpt`; skill `app-owned-codex-connections`) | setup-tokens or bespoke auth flows |
| Native mic (notes, orb, dictation) | `NoteRecorder` (`audio/NoteRecorder.java`), `MicRoute` (`audio/MicRoute.java`): `MicRoute.start`; `MicRoute.NOTE_SOURCES` notes, `MicRoute.SOURCES` STT | `new MediaRecorder`, `AudioRecord`, `setAudioSource` outside `audio/` | `MicRouteTest`, `NoteRecorderTest` |
| Android shell capabilities | `WosDevicePort` (`device-port.js`), `WosDeviceRecording` (`device-recording.js`), `WosDeviceOrb` (`device-orb.js`); `wizardDevicePort` v1 (`device/DeviceMessageProtocol.java`) | another envelope, recorder/store or feature `@JavascriptInterface`; ack before durable custody |
| Home-screen apps / safe top | `WizHomeScreenApps.attach / offer / canOffer`; `single-app-session.js`, `home-screen-apps.css`: host status/cutout, child inset 0; `WizChatsHost.openHosted` → `WizardApp.nav.openThread`; `WizChatsHost.replyRecorder` → `WizAppCapture` + `sendVoiceTo`/outbox; Back saves take before return; docs/pwa-app-install.md | app insets, nested shell/chat, recorder fork |
| Long screenshot, text selection | WebView document scroll, `SelectionWebView`, `ScrollCaptureCrashGuard` (`docs/android-document-scroll.md`) | second capture path | long Chats capture |

## Visual (drawn/animated: side-by-side screenshot under `Visual:`)

| Need | Use | Never hand-roll |
|---|---|---|
| The orb, any size | `Orb.create(canvas, fallback, {R})` (`web/orb.js`, icon/core); Android `android/app/src/main/assets/assist/everywhere.html` | PNG + CSS spin, Lottie, SVG |
| Skins/scenery (`--wos-orb-swipe-up`, `--wos-reply-regenerate`) | `WosSkin` (`web/core/skins.js`: setGlass), `WosSkinHost` (`web/core/skin-host.js`; `api.orb.switcher()`: lazy-ready + one fresh-URL retry; `core/slots.json`: `home-main`/`paintHome`, `windowRefresh`, beside, inbox/list, `data.read`, `back.push`), `WosExperience` (`web/core/experience.js`), `WosMySkin` (`web/core/my-skin.js`; palette-safe legacy layer; read-only discovery; keep previews), `WosScenery` (`web/core/scenery.js`), `WizAppearance` (`web/core/appearance-host.js`) | own palettes/canvases |
| Pins-only orb radial | `WosOrbSwitcher` (`web/core/orb-switcher.js`) | desk wedges |
| Motion | `WizardMotion` (`web/motion/wizard-motion.js`) | own keyframe sets |
| Tour/help, responsive Done, skip/exit; desktop `WosTour.desk` | `WosTour` (`web/core/tour.js`) | — |
| Install prompt; `hold(on, owner?)` during tours/overlays | `WizardPwaInstall` (`web/pwa-install.js`) | own `beforeinstallprompt` listener |
| First run: name, AI, colour, hello; Setup/tour | `WosWelcome` (`web/core/welcome.js`); `WosSetupLaunch` (`web/core/setup-launch.js`); `web/setup/setup.js`; `WizPhoneConnect` (`web/core/phone-connect.js`, Settings/onboarding) | per-shell first-run checks/tours |

## App voice/audio

| Module | Contract |
|---|---|
| `web/core/app-voice.js` (`WosAppVoice`) | Registry names/claims. |
| `web/core/voice-legacy.js` (`WosVoiceLegacy`) | Frozen Music grammar and legacy device schema until APK A; Food owns its grammar. |
| `web/core/background-audio-legacy.js` (`WizBackgroundAudioLegacy`) | Pilot grant/token until APK A. |

## Plumbing (single owner; files in `web/core/` unless noted)

`WizCompanionPane` (`companion-pane.js`), `WizardApp` (`app-client.js`), `WizAppCapture` (`app-capture.js`), `WizComposerInput` (`composer-input.js`), `WizAttachChip` (`attach-chip.js`), `WosSkinFrame` (`skin-frame.js`), `WosDevice` (`web/device.js`), `WizAppServices` (`app-services.js`), `WizCore` (`core.js`, `bridge.js`), `WizConfig` (`config.js`), `WizReach` (`reach.js`), `WizAndroidRelay` (`android-relay.js`), `WizBackgroundAudio` (`background-audio.js`), `WizHomeScreenPolicy` (`home-screen-policy.js`), `WosOwnViews` (`own-views.js`), `WosOrbHandoff` (`orb-handoff.js`), `WosShareSheet` (`share-sheet.js`), `WosBell` (`notif-bell.js`, items), `WosResources` (`resources.js`), `WosUsage` (`usage.js`), `WizPhotosRelay` (`photos-relay.js`), `WosMusic`, `WizDeviceLegacy` (`voice-legacy.js`), openers `WizAppOpen`, `WizCanOpen`, `WizOpenApp`, `WizOpenAgentChats` (`web/app.js`), `WosBoundView` (`bound-view.js`), `WosWorkspaceSync` (`workspace-sync.js`, rig).

AI usage: EXTEND `WosResources`/`WosUsage`; unknown ≠ zero/unlimited (`tests/claude-extra-usage.test.mjs`).

Devices: `WizPhoneConnect`, #677/#648, shared Setup/Mac kit; +16px tinted Setup, step-2 check/Show again, final Done.
