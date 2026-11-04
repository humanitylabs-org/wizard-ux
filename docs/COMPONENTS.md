# Shared components

[Style guide](https://github.com/humanitylabs-org/wizard-os/blob/main/style/APP-DESIGN-RULES.md).

One owner per capability: [gate](app-reuse-gate.md).

| Search | `WizCore.chatSearch` (`web/core/chat-search.js`); coverage, relevance × recency; flat paged hits | duplicate ranking |

| QA | `tools/qa-synthetic-fence.cjs` +startup/census | offline |

| Temporary chat | `WizCore.incognitoChats` / `incognitoOptIn`; strict capability + opt-in (off) | durable transcript/outbox |

## Apps (`WizardApp`: `/wizard-os-home/core/app-client.js`)

| Need | Use | Never hand-roll | Test the shared path by |
|---|---|---|---|
| Owner signatures | `WizardApp.identity.*` → `wizardDevicePort` | app keys | `wizard-id-bridge.test.mjs` |
| Agent chat | `WizardApp.nav.openThread(sessionId, {reply})`, `nav.openContextDraft` | own chat UI/retries | shell `[data-chats]`; 503: one outbox item/message |
| App identity/root | `WizardAppIdentity` (`web/core/app-identity.js`), loaded by SDK | manifest injectors | manifest wins; frames untouched |
| Composer input | `WizardApp.composer.bind` (Chats' `web/core/composer-input.js`) | own paste/drop/Enter | `qa-composer-input.cjs` |
| File chip before send | `WizardApp.attachChip.node` (Chats' tray, `core/attach-chip.js`) | own chip | `qa-attach-chip.cjs` |
| Photo/video viewer | `WizardApp.media.view(items, i)` = Chats' `WosChat.viewer` | own lightbox | Messenger `photo_viewer_browser.cjs` |
| Same-app companion | `WizardApp.shell.openCompanion` → `WizCompanionPane` (`web/core/companion-pane.js`); [API](shared-app-services-host.md) | app-specific desks/relays | `qa-companion-pane.cjs`: nested Back |
| Back in app; leave on dismiss | `WizardApp.back.register/push`, `nav.back()`; `WizOpenApp(id,path)` validates repair app URL + origin | guards, 2nd tap | Back stays; repair → source |
| Skin/tokens/mode | `WizardApp.theme.get / onChange`, `--wz-*` roles | own storage/mode, raw colors | two skins + live change keep state |
| Native Android skin | `WizardLook` (`android/app/src/main/java/ai/wizards/os/WizardLook.java`): saved roles, Nebula fallback | literal colours in native screens |
| Native offline/connect | `ReachScreen` / `ReachPolicy` (+`TailscaleGuide`), `ConnectActivity` / `ServerSettings`; web `WizReach` | duplicate offline/address UI |
| Transcribe audio | `WizardApp.voice.transcribe(blob, {language})` → `{text}` / `{unavailable:true}`; verified frame, 25 MB; `WizConfig.transcribe` (rechecks) | app transcriber | stale/foreign denied; unavailable explicit |
| Share out (people → apps → Other) | `WizardApp.share.text / file` | own picker | cancel ≠ shared |
| Receive shares | `WizardApp.share.receive({accepts, targets, receive}) / targets / check` (`docs/SHARE-SHEET.md`) | own inbound route | pending until accepted, ack once |
| Mic, camera, screen capture | `WizardApp.capture.start / settle / pending / ack`, `WizardApp.voiceInput.register` | `getUserMedia`, `MediaRecorder`, mic AudioContext | pending survives Back; ack once |
| Duck Music; orb app button | `WizardApp.audio.duck(on)`; `.orb.claim/release` (two-orb) | own volume/FAB | off on close |
| Title-bar tools | `WizardApp.titlebar.set(tools)` | repeated header | icons/dot in shell bar |
| Fingerprint app secret | `WizardApp.vault` (`VaultBridge`, `VaultSlots`); `WizAppServices` focus/legacy | bound identity | late/closed denied |
| Offline replica, durable edits | `WizOffline.create` (`core/offline-kit.js`) | app outbox | recoverable failures |
| Protect unsaved work from updates | `WizardApp.update.hold` | app SW, forced reload | release after save+readback |
| Offline shell | `web/sw.js` | API cache | offline reload |
| App reading place | `WizAppReadingPosition` (`web/core/app-reading-position.js`), automatic | app-local scroll store | reopen lands at the saved place |
| Motion/haptics | `WizardMotion` (`/wizard-os-home/motion/wizard-motion.js`) | own springs/haptics | — |
| Canonical style admission | `check_style.py` (`wizard-os/style/`), mirrored in WAM | per-app lint forks | legacy warns; changed lines fail |
| App kit: rows/sections/empty/add | `WizardApp`: `web/kit/wizard-ui.css` + `--wz-*`, then core/package/My skin | kit forks; `.wz-field-row` chat; literals | two skins + My skin restyle `.wz-*` |

## Shell (`web/core/`): both shells/all agents.

| Need | Use | Never hand-roll |
|---|---|---|
| Pages: list, viewer, editor, history, bridge | `WosPages` (`pages.js`) | app powers |
| Action menu | `WosContextMenu.open`/`.back` (`core/context-menu.js`) | local menus |
| App setup | `WosAppSetup` (`app-setup.js`) | app-local setup |
| Chats + opt-in `--wos-new-send-list` | `WizCore` (`chats.js`, `.css`); `WizLive.messages`/`readyRank`; `setFocus`/`migrateChatsFocus`; seq resume; provider Errors; Esc → `CHATS.clearFilter(id::list)` | duplicate Chats/Focus |
| Chats disposal | `WizCore.chats`: fence reads, cancel timers | stale UI |
| Chats/Ready | `WizChatsHost` / `WizAppExtensions` (`chats-view.js`); `replyRecorder`; draft admission; single-app host | domain code in core |
| Bound-view handle (3 intro glows) | `WosSkinHost` built-in (`edge-peek.js`), host storage | skin-local duplicate |
| Repaint changed nodes without flicker | `WosMorph.morph` (`dom-morph.js`) | whole-view `innerHTML` on every live tick |
| Composer mic, receipts, retry; keep label clear of draft | `WosChatPower` (`chat-power.js`); `WosModels` (`chat-models.js`); `WosErrors` (`chat-errors.js`); `WosWork` (`chat-work.js`); composer `WizCore` (`chats.js` `fitLabel`, `chat-power.css` `lab-row`) | forks; model controls over editable text |
| Markdown, drafts, inline/bottom media | `WosChat` (`chat-kit.js`: `helm`, `md`, `copyRich`, `viewer`); Chats `mediaBlock` | own parser/viewer |
| Spaces / Focus | `WizCore` Chats (`chats.js`), `WizLive.prefOps` (`spaces`; add = move, one Space per chat); `WizLive.spaceSessions(ids)`; `winAgent`/`modelRoute`; `WosOutbox.onNew`; restored Focus awaits census; hidden routes; scoped tool; `WosAgents.colour`/`distinctHues` + `--ch-agent-hue` | duplicate Spaces/Focus/sections |
| Pins: menu / opt-in row buttons | `WosChatPins` (`chat-pins.js`) | device-local pin lists |
| Snooze thread/message: relative dates, Someday, Other date… last; success via threadBack | `WosBoomerang` (`scheduled-reminders.js`) on the one scheduler; Settings → Schedules `WosSchedules` (`schedules.js`) | own timers or reminder stores |
| Thread topic emoji | `WosTopicEmoji` (`chat-topic-emojis.js`, data `WosTopicEmojiData`) | — |
| Durable send, saved Retry, failed Dismiss; >6h hold | `WosOutbox`, `WosCarry` (`web/outbox.js`) | own queue |
| Cancelled-recording keep | `WosCancelled` (`cancelled.js`) | — |
| Send to agent | `WizShareWizard` (`share-wizard.js`); `WizSheetBack` (`sheetback.js`) | shared/native import; separate comment, agent + chat; durable |
| Uploads of any size | `WizUploads` (`uploads.js`) | single-fetch uploads |
| Files browse, preview, attach | `WosFiles` (`files.js`) | own picker |
| Settings in both shells | `WosSettings.register` (`settings.js`; separate Skin/Color; shared About version identities; fail-closed update status; package System: `hasSystem`), `focus(id)`, `WosFeatures`; `WizConfig.responseStyle` | shell-only pages |
| Agent identity, glyph, hue; which agents an app joins (`appAgents`: privacy, needs_private_agent) | `WosAgents` (`agents.js`) | hard-coded agent names or colours |
| Store | `storeKind,sourceLabel,parseInstallLink,removeInstalledApp` (`web/store/`) | type ≠ UX |
| App agent routing, private-app note + setup (incl. Store) | `WosAppRoute` (`app-route.js`) | — |
| App icons, logos | `WizSigil` (`sigils.js`, `sigils.css`); id aliases; named registry glyphs and HOUSE masks beat cached package pictures; unbranded apps keep package/catalog fallback; pin raster masks contain-fit. Tests: `app-icon-consumers.test.mjs`, `app-icon-harness.test.mjs` | PNG/emoji icons |
| Launcher | `WizLauncher`, `WizLauncherDefaults`; 1s boot; `renderLauncher`: unique ids; `WizCore`: native path gate | lists |
| App groups | `WosAppKinds` (`app-kinds.js`) | forks |
| Brand hat | `WizBrand` (`brand.js`) | redrawn logos |
| Links: sheet/window (`asWindow`), images, long-press browser/Download/Copy | `WizLinks` (`links.js`; Android: `WizardOSNative.openInBrowser` / `download`) | `window.open`, own iframe sheet, own link menu |
| Text-selection actions | `WosSelMenu` (`sel-menu.js`) | own context menu |
| Share sheet (text/url/image/file), generic cached People recency, Agents and pending handoffs | `WosShareSheet` (`share-sheet.js`), entered via `WosChat.sharePayload`/`shareFile`; hold → tray: `bindSharePress` | a second share picker, sending for an app |
| Agent screen context | `WizScreen` (`screen-text.js`) | own DOM scrape |
| Dictation into a focused field | `WizCore` focused field (`focused-field.js`); voice `WizCore` (`voice.js`); mic choice `WosMic` (`mic.js`) | own recorder/transcriber |
| Local commands | `WosCommands` (`commands.js`) | a second command parser |
| Screen capture | `WosScreenCapture` (`screen-capture.js`), `WosCaptureTools` (`capture-tools.js`) | — |
| Update banners/card/pop-up | `WizWebUpdate`, `WizAppUpdates` (`web-update.js`), `WizAppVersions` (`app-versions.js`), `WosUpdates` (`os-updates.js`: `card`/`popup`) | own reload timers, a second card |
| Provider login (Claude, ChatGPT) for agents and apps | the installed login apps (`wizard-claude`, `wizard-chatgpt`; skill `app-owned-codex-connections`) | setup-tokens or bespoke auth flows |
| Native mic recording | `NoteRecorder` (`audio/NoteRecorder.java`) over `MicRoute` (`audio/MicRoute.java`: `MicRoute.start`: `MicRoute.NOTE_SOURCES` for notes, `MicRoute.SOURCES` for STT) | `new MediaRecorder`, `AudioRecord` or `setAudioSource` outside `audio/` | `MicRouteTest`, `NoteRecorderTest` |
| Android shell capabilities | `WosDevicePort` (`device-port.js`), `WosDeviceRecording` (`device-recording.js`), `WosDeviceOrb` (`device-orb.js`); `wizardDevicePort` v1 (`device/DeviceMessageProtocol.java`) | another envelope, recorder/store or feature `@JavascriptInterface`; ack before durable custody |
| Home-screen apps / safe top | `WizHomeScreenApps.attach / offer / canOffer`; host owns cutout, child inset 0; adaptive pins | app CSS insets |
| Home-screen declaration | `WizHomeScreenCapabilities` (`web/core/home-screen-capabilities.js`): sanitize/matcher/replicaPrefix | per-app offline/storage switches | refresh/revoke |
| Long screenshot, selection | WebView doc scroll, `SelectionWebView`, `ScrollCaptureCrashGuard` (docs/android-document-scroll.md) | second capture path | long Chats capture |

## Visual (drawn/animated: side-by-side screenshot under `Visual:`)

| Need | Use | Never hand-roll |
|---|---|---|
| The orb, any size | `Orb.create(canvas, fallback, {R})` (`web/orb.js`, icon/core); Android `android/app/src/main/assets/assist/everywhere.html` | PNG + CSS spin, Lottie, SVG |
| Skin, scenery and tweak switches | `WosSkin` (`web/core/skins.js`: setGlass), `WosSkinHost` (`web/core/skin-host.js`); `api.orb.switcher()` awaits readiness/retry; `core/slots.json`: `home-main`, `paintHome`, `windowRefresh`, beside, inbox/list, `data.read`, `back.push`; `WosExperience` (`web/core/experience.js`; error retry), `WosMySkin` (`web/core/my-skin.js`; read-only discovery + explicit recovery; bad `skin.js` → off), `WosScenery` (`web/core/scenery.js`), `WizAppearance` (`web/core/appearance-host.js`; desk geometry) | own gradients/canvases/colours |
| Pins-only orb radial | `WosOrbSwitcher` (`web/core/orb-switcher.js`) | desk wedges |

| Motion | `WizardMotion` (`web/motion/wizard-motion.js`) | own keyframe sets |
| Tour/help, responsive Done, skip/exit; desktop `WosTour.desk` | `WosTour` (`web/core/tour.js`) | — |
| Install prompt; `hold(on, owner?)` during tours/overlays | `WizardPwaInstall` (`web/pwa-install.js`) | own `beforeinstallprompt` listener |
| First run (Welcome: name, AI, colour, hello; Setup app) and tour | `WosWelcome` (`web/core/welcome.js`); `WosSetupLaunch` (`web/core/setup-launch.js`); built-in checklist `web/setup/setup.js`; phone: `WizPhoneConnect` (`web/core/phone-connect.js`, Settings + onboarding) | shell-specific first-run checks, a second tour launcher |

## App voice/audio

| Module | Contract |
|---|---|
| `web/core/app-voice.js` (`WosAppVoice`) | Registry names/claims. |
| `web/core/voice-legacy.js` (`WosVoiceLegacy`) | Frozen Music/device schema to APK A; Food grammar; ids: `appIdAliases`. |
| `web/core/background-audio-legacy.js` (`WizBackgroundAudioLegacy`) | Pilot grant/token until APK A. |

## Plumbing (single owner; files in `web/core/` unless noted)

`WizCompanionPane` (`companion-pane.js`), `WizardApp` (`app-client.js`), `WizAppCapture` (`app-capture.js`), `WizComposerInput` (`composer-input.js`), `WizAttachChip` (`attach-chip.js`), `WosSkinFrame` (`skin-frame.js`; heading ink), `WosDevice` (`web/device.js`), `WizAppServices` (`app-services.js`), `WizCore` (`core.js`, `bridge.js`), `WizConfig` (`config.js`), `WizReach` (`reach.js`), `WizAndroidRelay` (`android-relay.js`), `WizBackgroundAudio` (`background-audio.js`), `WizHomeScreenPolicy` (`home-screen-policy.js`), `WosOwnViews` (`own-views.js`), `WosOrbHandoff` (`orb-handoff.js`), `WosShareSheet` (`share-sheet.js`), `WosBell` (`notif-bell.js`, items), `WosResources` (`resources.js`), `WosUsage` (`usage.js`), `WizPhotosRelay` (`photos-relay.js`), `WosMusic`, `WizDeviceLegacy` (`voice-legacy.js`), openers `WizAppOpen`, `WizCanOpen`, `WizOpenApp`, `WizOpenAgentChats` (`web/app.js`), `WosBoundView` (`bound-view.js`), `WosWorkspaceSync` (`workspace-sync.js`, rig).

AI usage: EXTEND `WosResources`/`WosUsage` for extra usage; an unknown cap or spend shows as text, never zero or unlimited (`tests/claude-extra-usage.test.mjs`).

Devices: `WizPhoneConnect`, #677 + #648, shared kit. Setup/Mac reuse; +16px tinted Setup action, step-2 green check/Show again, final Done.
