# Shared components

[Full contracts, prohibited duplicates and proof pointers](component-contract-details.md).

[Style guide](https://github.com/humanitylabs-org/wizard-os/blob/main/style/APP-DESIGN-RULES.md).

One owner per capability: [gate](app-reuse-gate.md).

| Search | `WizCore.chatSearch` (`web/core/chat-search.js`); coverage, relevance × recency; flat paged hits |

| QA | `tools/qa-synthetic-fence.cjs` +startup/census |

| Temporary chat | `WizCore.incognitoChats` / `incognitoOptIn`; strict capability + opt-in (off) |

## Apps (`WizardApp`: `/wizard-os-home/core/app-client.js`)

| Need | Use |
|---|---|
| Owner signatures | `WizardApp.identity.*` → `wizardDevicePort` |
| Agent chat | `WizardApp.nav.openThread(sessionId, {reply})`, `nav.openContextDraft` |
| App identity/root | `WizardAppIdentity` (`web/core/app-identity.js`), loaded by SDK |
| Composer input | `WizardApp.composer.bind` (Chats' `web/core/composer-input.js`) |
| File chip before send | `WizardApp.attachChip.node` (Chats' tray, `core/attach-chip.js`) |
| Photo/video viewer | `WizardApp.media.view(items, i)` = Chats' `WosChat.viewer` |
| Same-app companion | `WizardApp.shell.openCompanion` → `WizCompanionPane` (`web/core/companion-pane.js`); [API](shared-app-services-host.md) |
| Back in app; leave on dismiss | `WizardApp.back.register/push`, `nav.back()`; `WizOpenApp(id,path)` validates repair app URL + origin |
| Skin/tokens/mode | `WizardApp.theme.get / onChange`, `--wz-*` roles |
| Native Android skin | `WizardLook` (`android/app/src/main/java/ai/wizards/os/WizardLook.java`): saved roles, Nebula fallback |
| Connect | `ReachScreen/ReachPolicy/TailscaleGuide`, `ConnectActivity/ServerSettings`; web `WizReach` (local help/checks) |
| Transcribe audio | `WizardApp.voice.transcribe(blob, {language})` → `{text}` / `{unavailable:true}`; verified frame, 25 MB; `WizConfig.transcribe` (rechecks) |
| Share out (people → apps → Other) | `WizardApp.share.text / file` |
| Receive shares | `WizardApp.share.receive({accepts, targets, receive}) / targets / check` (`docs/SHARE-SHEET.md`) |
| Mic, camera, screen capture | `WizardApp.capture.start / settle / pending / ack`, `WizardApp.voiceInput.register` |
| Duck Music; orb app button | `WizardApp.audio.duck(on)`; `.orb.claim/release` (two-orb) |
| Title-bar tools | `WizardApp.titlebar.set(tools)` |
| Fingerprint app secret | `WizardApp.vault` (`VaultBridge`, `VaultSlots`); `WizAppServices` focus/legacy |
| Offline replica, durable edits | `WizOffline.create` (`core/offline-kit.js`) |
| Protect unsaved work from updates | `WizardApp.update.hold` |
| Offline shell | `web/sw.js` |
| App reading place | `WizAppReadingPosition` (`web/core/app-reading-position.js`), automatic |
| Motion/haptics | `WizardMotion` (`/wizard-os-home/motion/wizard-motion.js`) |
| Canonical style admission | `check_style.py` (`wizard-os/style/`), mirrored in WAM |
| App kit: rows/sections/empty/add | `WizardApp`: `web/kit/wizard-ui.css` + `--wz-*`, then core/package/My skin |

## Shell (`web/core/`): both shells/all agents.

| Need | Use |
|---|---|
| Pages: list, viewer, editor, history, bridge | `WosPages` (`pages.js`) |
| Action menu | `WosContextMenu.open`/`.back` (`core/context-menu.js`) |
| App setup | `WosAppSetup` (`app-setup.js`) |
| Chats + opt-in `--wos-new-send-list` | `WizCore` (`chats.js`, `.css`); `WizLive.messages`/`readyRank`; `setFocus`/`migrateChatsFocus`; opt-in `--wos-note-quiet` stack uses shared notification routing/actions; seq resume; provider Errors; Esc → `CHATS.clearFilter(id::list)` |
| Chats disposal | `WizCore.chats`: fence reads, cancel timers |
| Optional Group by day | `WizCore.chats` / `WizLive.groups`: individual `miguel/group-by-day` switch changes grouping only; independent Pins and compact controls remain intact; migration never opts in |
| Chats/Ready | `WizChatsHost` / `WizAppExtensions` (`chats-view.js`); `replyRecorder`; draft admission; single-app host; badge `WizCore.workspaceNav.refreshChats` = `WizLive.visibleUnread(unified())` (Ready separate) |
| Bound-view handle (3 intro glows) | `WosSkinHost` built-in (`edge-peek.js`), host storage |
| Repaint changed nodes without flicker | `WosMorph.morph` (`dom-morph.js`) |
| Composer mic, receipts, retry; keep label clear of draft | `WosChatPower` (`chat-power.js`); `WosModels` (`chat-models.js`); `WosErrors` (`chat-errors.js`); `WosWork` (`chat-work.js`); composer `WizCore` (`chats.js` `fitLabel`, `chat-power.css` `lab-row`) |
| Markdown, drafts, inline/bottom media | `WosChat` (`chat-kit.js`: `helm`, `md`, `copyRich`, `viewer`); Chats `mediaBlock` |
| Spaces / Focus | `WizCore` Chats (`chats.js`), `WizLive.prefOps` (`spaces`; add = move, one Space per chat); `WizLive.spaceSessions(ids)`; `winAgent`/`modelRoute`; `WosOutbox.onNew`; restored Focus awaits census; hidden routes; scoped tool; `WosAgents.colour`/`distinctHues` + `--ch-agent-hue` |
| Pins: menu / opt-in row buttons | `WosChatPins` (`chat-pins.js`) |
| Snooze thread/message: relative dates, Someday, Other date… last; success via threadBack | `WosBoomerang` (`scheduled-reminders.js`) on the one scheduler; Settings → Schedules `WosSchedules` (`schedules.js`) |
| Thread topic emoji | `WosTopicEmoji` (`chat-topic-emojis.js`, data `WosTopicEmojiData`) |
| Durable send, saved Retry, failed Dismiss; >6h hold | `WosOutbox`, `WosCarry` (`web/outbox.js`) |
| Cancelled-recording keep | `WosCancelled` (`cancelled.js`) |
| Send to agent | `WizShareWizard` (`share-wizard.js`); `WizSheetBack` (`sheetback.js`) |
| Uploads of any size | `WizUploads` (`uploads.js`) |
| Files browse, preview, attach | `WosFiles` (`files.js`) |
| Settings in both shells | `WosSettings.register` (`settings.js`: Skin/Colors, Background/Mode, shared About/fail-closed updates, package `hasSystem`), `focus(id)`; desktop same-root Home/AI rehost, no entrance replay; Look/New skin shell filter (retain hidden defaults); narrow-host Back; `WosFeatures`; `WizConfig.responseStyle` |
| Agent identity, glyph, hue; which agents an app joins (`appAgents`: privacy, needs_private_agent) | `WosAgents` (`agents.js`) |
| Store | `storeKind,sourceLabel,parseInstallLink,removeInstalledApp` (`web/store/`) |
| App agent routing, private-app note + setup (incl. Store) | `WosAppRoute` (`app-route.js`) |
| App icons, logos | `WizSigil` (`sigils.js`, `sigils.css`); id aliases; named registry glyphs and HOUSE masks beat cached package pictures; unbranded apps keep package/catalog fallback; pin raster masks contain-fit. Tests: `app-icon-consumers.test.mjs`, `app-icon-harness.test.mjs` |
| Launcher | `WizLauncher`, `WizLauncherDefaults`; 1s boot; `renderLauncher`: unique ids; `WizCore`: native path gate |
| App groups | `WosAppKinds` (`app-kinds.js`) |
| Brand hat | `WizBrand` (`brand.js`) |
| Links: sheet/window (`asWindow`), images, long-press browser/Download/Copy | `WizLinks` (`links.js`; Android: `WizardOSNative.openInBrowser` / `download`) |
| Text-selection actions | `WosSelMenu` (`sel-menu.js`) |
| Share sheet (text/url/image/file), generic cached People recency, Agents and pending handoffs | `WosShareSheet` (`share-sheet.js`), entered via `WosChat.sharePayload`/`shareFile`; hold → tray: `bindSharePress` |
| Agent screen context | `WizScreen` (`screen-text.js`) |
| Dictation into a focused field | `WizCore` focused field (`focused-field.js`); mono voice (`voice.js`); mic choice `WosMic` (`mic.js`) |
| Local commands | `WosCommands` (`commands.js`) |
| Screen capture | `WosScreenCapture` (`screen-capture.js`), `WosCaptureTools` (`capture-tools.js`) |
| Update banners/card/pop-up | `WizWebUpdate`, `WizAppUpdates` (`web-update.js`), `WizAppVersions` (`app-versions.js`), `WosUpdates` (`os-updates.js`: `card`/`popup`) |
| Provider login (Claude, ChatGPT) for agents and apps | the installed login apps (`wizard-claude`, `wizard-chatgpt`; skill `app-owned-codex-connections`) |
| Now playing | `WosMediaWatch` (`web/core/media-watch.js`), `WosSkinHost` `api.media`: same-origin media only, inert until watched |
| Native mic recording | `NoteRecorder` (`audio/NoteRecorder.java`) over `MicRoute` (`audio/MicRoute.java`: `MicRoute.start`: `MicRoute.NOTE_SOURCES` for notes, `MicRoute.SOURCES` for STT) |
| Android shell capabilities | `WosDevicePort` (`device-port.js`), `WosDeviceRecording` (`device-recording.js`), `WosDeviceOrb` (`device-orb.js`); `wizardDevicePort` v1 (`device/DeviceMessageProtocol.java`) |
| Home-screen apps / safe top | `WizHomeScreenApps.attach / offer / canOffer`; host owns cutout, child inset 0 |
| Home-screen declaration | `WizHomeScreenCapabilities` (`web/core/home-screen-capabilities.js`): sanitize/matcher/replicaPrefix |
| Long screenshot, text selection | WebView document scroll, `SelectionWebView`, `ScrollCaptureCrashGuard` (`docs/android-document-scroll.md`) |

| Owner Look sync | `WosLookSync` (`look-sync.js`): logical skin/tweaks/defaults + desktop/phone views; legacy seeds; ordered equality-group causal base + pending ACK overlay for all fields; foreground refresh |

## Visual (drawn/animated: side-by-side screenshot under `Visual:`)

| Need | Use |
|---|---|
| The orb, any size | `Orb.create(canvas, fallback, {R})` (`web/orb.js`, icon/core); Android `android/app/src/main/assets/assist/everywhere.html` |
| Skin, scenery and tweak switches (`--wos-reply-summary`) | `WosSkin` (`web/core/skins.js`: setGlass), `WosSkinHost` (`web/core/skin-host.js`; AI apps: sheet yielding + desktop-only boot guard; Group/Sort and project titles); `api.orb.switcher()` awaits readiness/retry; `api.settings.section(id, 'look', node)` for inline tweak options; `core/slots.json`: `home-main`, `paintHome`, `windowRefresh`, beside, inbox/list/notify, `data.read`, `back.push`; built-in layouts (`api.apps` / `api.desk`; read-only `api.aiUsage` for the AI apps fuel gauge); `WosExperience` (`web/core/experience.js`; error retry), `WosMySkin` (`web/core/my-skin.js`; read-only discovery + explicit recovery; bad `skin.js` → off), `WosScenery` (`web/core/scenery.js`), `WizAppearance` (`web/core/appearance-host.js`; desk geometry) |
| Pins-only orb radial | `WosOrbSwitcher` (`web/core/orb-switcher.js`) |
| Phone orb status dots | `WizCore` (`web/app.js`: `moonAngle`, `renderMoons`); authoritative, screen-relative status state with non-rotating collision gaps for the scrub handle and count badge |

| Motion | `WizardMotion` (`web/motion/wizard-motion.js`) |
| Tour/help, responsive Done, skip/exit; desktop `WosTour.desk` | `WosTour` (`web/core/tour.js`) |
| Install prompt; `hold(on, owner?)` during tours/overlays | `WizardPwaInstall` (`web/pwa-install.js`) |
| First run (Welcome: name, AI, colour, import, hello; Setup) and tour | `WosWelcome` (`web/core/welcome.js`); `WosSetupLaunch` (`web/core/setup-launch.js`); built-in checklist `web/setup/setup.js`; phone: `WizPhoneConnect` (`web/core/phone-connect.js`, Settings + onboarding) |

## App voice/audio

| Module | Contract |
|---|---|
| `web/core/app-voice.js` (`WosAppVoice`) | Registry names/claims. |
| `web/core/voice-legacy.js` (`WosVoiceLegacy`) | Frozen Music/device schema to APK A; Food grammar; ids: `appIdAliases`. |
| `web/core/background-audio-legacy.js` (`WizBackgroundAudioLegacy`) | Pilot grant/token until APK A. |

## Plumbing (single owner; files in `web/core/` unless noted)

`WizCompanionPane` (`companion-pane.js`), `WizardApp` (`app-client.js`), `WizAppCapture` (`app-capture.js`), `WizComposerInput` (`composer-input.js`), `WizAttachChip` (`attach-chip.js`), `WosSkinFrame` (`skin-frame.js`), `WosDevice` (`device.js`), `WizAppServices` (`app-services.js`), `WizCore` (`core.js`, `bridge.js`), `WizConfig` (`config.js`), `WizReach` (`reach.js`), `WizAndroidRelay` (`android-relay.js`), `WizBackgroundAudio` (`background-audio.js`), `WizHomeScreenPolicy` (`home-screen-policy.js`), `WosOwnViews` (`own-views.js`), `WosOrbHandoff` (`orb-handoff.js`), `WosShareSheet` (`share-sheet.js`), `WosBell` (`notif-bell.js`), `WosResources` (`resources.js`), `WosUsage` (`usage.js`), `WizPhotosRelay` (`photos-relay.js`), `WosMusic`, `WizDeviceLegacy` (`voice-legacy.js`), openers `WizAppOpen`, `WizCanOpen`, `WizOpenApp`, `WizOpenAgentChats` (`app.js`), `WosBoundView` (`bound-view.js`), `WosWorkspaceSync` (`workspace-sync.js`), `WosMedia` (`media-watch.js`).

AI usage: EXTEND `WosResources`/`WosUsage` for extra usage; an unknown cap or spend shows as text, never zero or unlimited (`tests/claude-extra-usage.test.mjs`).

Devices: `WizPhoneConnect`, #677 + #648, shared kit. Setup/Mac reuse; +16px tinted Setup action, step-2 green check/Show again, final Done.
