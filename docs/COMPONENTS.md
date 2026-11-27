# Shared components

Back: `WizEscapeBack`, `WosBack`; `WizChatsHost.registerBack`/back.push share recency. `WosSkinHost` boots AI apps (`wos.desktop-view.v1`, `html[data-layout]`, `data-chats-owner`, `chatsClaimed()`); ownList excludes legacy lists. `WizAppServices.back` keeps root apps; unowned frames yield.

[Contracts](component-contract-details.md). [Style guide](https://github.com/humanitylabs-org/wizard-os/blob/main/style/APP-DESIGN-RULES.md). [Reuse gate](app-reuse-gate.md).

| Search | `WizCore.chatSearch` (`chat-search.js`); ranked paged hits |

| QA | `tools/qa-synthetic-fence.cjs` +startup/census |

| Temporary chat | `WizCore.incognitoChats`/`incognitoOptIn`; strict capability + opt-in (off) |

## Apps (`WizardApp`: `/wizard-os-home/core/app-client.js`)

| Need | Use |
|---|---|
| Owner signatures | `WizardApp.identity.*`→`wizardDevicePort` |
| Agent chat | `WizardApp.nav.openThread(sessionId, {reply})`, `nav.openContextDraft` |
| App identity/root | `WizardAppIdentity` (`web/core/app-identity.js`), loaded by SDK |
| Composer input | `WizardApp.composer.bind` (Chats' `web/core/composer-input.js`) |
| File chip before send | `WizardApp.attachChip.node` (Chats' tray, `core/attach-chip.js`) |
| Photo/video viewer | `WizardApp.media.view(items, i)` = Chats' `WosChat.viewer` |
| Same-app companion | `WizardApp.shell.openCompanion`→`WizCompanionPane` (`web/core/companion-pane.js`); [API](shared-app-services-host.md) |
| Back in app; leave on dismiss | `WizardApp.back.register/push`, `nav.back/onHome`; `WizOpenApp(id,path)` validates repair app URL + origin |
| Skin/tokens/mode | `WizardApp.theme.get/onChange`, `--wz-*` (`--wz-owner-message`); fresh: `view.onRefresh` |
| Native Android skin | `WizardLook` (`android/app/src/main/java/ai/wizards/os/WizardLook.java`): saved roles, Nebula fallback |
| Connect | `ReachScreen/ReachPolicy/TailscaleGuide`, `ConnectActivity/ServerSettings`; web `WizReach` (help/check/direct, sandboxed; pill/auto-open) |
| Switch/edit Wizards | `WizardSwitch` via `WizardOSNative.switchWizard`, from `WizWorkspaces` (+move/restore) |
| Refuse an Android Wizard switch while work is unfinished | `ServerSwitchGuard` (`android/app/src/main/java/ai/wizards/os/ServerSwitchGuard.java`) |
| Transcribe audio | `WizardApp.voice.transcribe(blob, {language})` → `{text}`/`{unavailable:true}`; verified frame, 25 MB; `WizConfig.transcribe` (rechecks) |
| Share out (people → apps → Other) | `WizardApp.share.text / file` |
| Receive shares | `WizardApp.share.receive({accepts, targets, receive})/targets/check` (`docs/SHARE-SHEET.md`) |
| Mic, camera, screen capture | `WizardApp.capture.start/settle/pending / ack`, `WizardApp.voiceInput.register` |
| Duck Music; orb app button | `WizardApp.audio.duck(on)`; `.orb.claim/release` (unused) |
| Tools | `WizardApp.titlebar.set`; `WizAppServices.titlebar.render` |
| Fingerprint app secret | `WizardApp.vault` (`VaultBridge`, `VaultSlots`); `WizAppServices` focus/legacy |
| Offline replica, durable edits | `WizOffline.create` (`core/offline-kit.js`) |
| Draft holds/keep (1.5s) | `WizardApp.update.hold` |
| Offline shell | `web/sw.js` |
| App reading place | `WizAppReadingPosition` (`web/core/app-reading-position.js`), automatic |
| Motion/haptics | `WizardMotion` (`/wizard-os-home/motion/wizard-motion.js`) |
| Canonical style admission | `check_style.py` (`wizard-os/style/`), mirrored in WAM |
| App kit: rows/sections/empty/add | `WizardApp`: `web/kit/wizard-ui.css` + `--wz-*`, then core/package/My skin |

## Shell (`web/core/`): both shells/all agents.

| Need | Use |
|---|---|
| Pages: list, viewer, editor, history, bridge | `WosPages` (`pages.js`) |
| Action/attach menu | `WosContextMenu` (`context-menu.js`; open/attach) |
| App setup | `WosAppSetup` (`app-setup.js`) |
| Chats | `WizCore` (`chats.js`/`.css`); desktop `keepThreadOpen`; `WizConfig.chatAfterAction` (phone); Archive/Snooze→`archiveOrder`, `leaveFinishedThread`; `WizLive.messages`/`firstMessages`/`readyRank`; `setFocus`/`migrateChatsFocus`; `--wos-note-quiet` alerts; Esc→`CHATS.clearFilter(id::list)`; `inboxIds` |
| Chats list model | `WizChatsListModel` (`chats-list-model.js`): `executionStatus`/`isListWorking`; `workingSort`; stalled waits Ready, `background` stays Working; running helper keeps failed Working; `WizLive.workingOrder`; `activityList` (Activity), `placeOf`; Ready's `orderBar` |
| Pane placement | `WizCore.panes` (`pane-layout.js`): Classic split/cols; tiled/centre/pair/full geometry/focus/ratios/dock (<1100px bar); AI keys/Back; local |
| Desktop lifecycle | `WizDesktop.host` (`core/desktop-host.js`): snapshots, retained frames/readiness/tools, open/focus/close, onChange, panes; chats(id), settings, placements() |
| Chat time | `WizCore.ago` (`core.js`): hours <24h, then owner day |
| Chat state | `WizLive`: rename/read fence, `chanStore`/`chanDaily`/`agentInbox`; `WizCore.chats` dispose |
| Group by day | `WizCore.chats`/`WizLive.groups`: `--wos-chats-group-switch` hook; Pins/compact independent |
| Chats/Ready | `WizChatsHost`/`WizAppExtensions` (`chats-view.js`): surface/(views.)mount, placement, `replyRecorder`, draft admission; host `keepNewOpen(id)` keeps docked New open on send (`WosSkinHost.routeShows`); pills: `workspaceNav.chatsCount/refreshChats`; subgroups: `WizChatsListModel.unreadCount`; counts: `.unreadThreads` |
| Bound-view handle (3 intro glows) | `WosSkinHost` built-in (`edge-peek.js`), host storage |
| Repaint changed nodes without flicker | `WosMorph.morph` |
| Mic, retry, model, place/follow | `WosChatPower` (`chat-power.js`;`chanOwnPost`/`chanModel`/`landAt`/`paintJump`); `voice.reply/onTap`→`recordReply`; `WosModels` (`foreignApp`,`reconnect`); `WosErrors`; `WosWork`; composer `WizCore` (`chats.js` `fitLabel`,`.css` `lab-row`) |
| Text/media | `WosChat` (`chat-kit.js`: `helm`, `tweakIds`, `actionIds`/`buttonGroups`→`WosActionCards`, `md`, `copyRich`, `viewer`, `saveFile`, `drafts.keys`) |
| Spaces / Focus | `WizCore` Chats (`chats.js`), `WizLive.prefOps` (`spaces`; add = move, one Space per chat); `WizLive.spaceSessions(ids)`; `winAgent`/`modelRoute`; `WosOutbox.onNew`; hidden routes; AI apps pills (`.aad-agents`): `focusRows`, `agents.focus`; `WosAgents.colour`/`distinctHues` + `--ch-agent-hue` |
| Pins: menu / opt-in row buttons | `WosChatPins` (`chat-pins.js`) |
| Snooze thread/message: relative dates, Someday, Other date… last; action setting | `WosBoomerang` (`scheduled-reminders.js`) on one scheduler; Settings → Schedules `WosSchedules` (`schedules.js`) |
| Thread topic emoji | `WosTopicEmoji` (`chat-topic-emojis.js`, data `WosTopicEmojiData`) |
| Thread tracker | `WosThreadTracker` (`thread-tracker.js`): groups/dots/Seen; open count; stopped dots/rows via list model+repaint; green dwell/send-pinned versions; amber manual; Resume stopped (`sendChat`); answered rule ([details](component-contract-details.md)); quote Reply; opaque panel; Dismiss/Seen never archive; main agent only. |
| Durable send, saved Retry/failed Dismiss, >6h hold; refused-steer back-off ([details](component-contract-details.md)) | `WosOutbox`, `WosCarry` (`web/outbox.js`) |
| Cancelled-recording keep | `WosCancelled` (`cancelled.js`) |
| Send to agent | `WizShareWizard` (`share-wizard.js`); `WizSheetBack` (`sheetback.js`) |
| Uploads of any size | `WizUploads` (`uploads.js`) |
| Files browse, preview, attach | `WosFiles` (`files.js`) |
| Settings in both shells | `WosSettings.register` (`settings.js`: Skin/Colors, Background/Mode, shared About/fail-closed updates, package `hasSystem`), `focus(id)`; same-HTML `refresh()` no-op; Home/AI rehost; Look/New skin shell filter (keeps hidden defaults); reply tweak `tweakCard`; narrow Back; `WosFeatures`; `WizConfig.responseStyle`; Try new features |
| Agent identity, glyph, hue; default-agent route (`routeAgent`); app's agents (`appAgents`) | `WosAgents` (`agents.js`) |
| Store | `storeKind,sourceLabel,parseInstallLink,removeInstalledApp,githubSheet` |
| App agent routing, private-app note + setup (incl. Store); private mode (Settings › Privacy) | `WosAppRoute` (`app-route.js`, `openAgents`); `WosPrivacy`, `WosPrivateRoute` |
| App icons, logos | `WizSigil` (`sigils.js`, `sigils.css`): aliases, registry/HOUSE glyphs first; unbranded fallback; `orb(node)` white glyphs; contain-fit pins. Tests: `app-icon-*.test.mjs` |
| Launcher | `WizLauncher`, `WizLauncherDefaults`; 1s boot; `renderLauncher`: unique ids; `WizCore`: native path gate, `whenOpenable`, `installs` |
| App tiles | `WosAppKinds` |
| Brand hat | `WizBrand` |
| Links: outside→panel (Android; `links.panel:false`=off)/browser/`links.reader`; sheet/win/hold; `data-wizard-browse`=original | `WizLinks` (`links.js`; `openIn*`/`follow`/`popup`) |
| Downloads: in-app “Downloaded · Open” banner + recent-downloads sheet (Android only; inert without `wizardDownloadsPort`); Settings → Phone → Downloads | `WosDownloads` (`downloads.js`, `downloads.css`); native `downloads/*.java` (names, quiet DownloadManager; docs/android-downloads-port.md) |
| Selection actions, AI Look up | `WosSelMenu`, `WosLookup` (`lookup-pop.js`) |
| Share sheet (text/url/image/file), generic cached People recency, Agents and pending handoffs | `WosShareSheet` (`share-sheet.js`), entered via `WosChat.sharePayload`/`shareFile`; hold → tray: `bindSharePress` |
| Agent screen context | `WizScreen` |
| Dictation into a focused field | `WizCore` (`focused-field.js`, sandboxed too); native `WizardKeyboardService.insertText`; voice.js; `WosMic` (`mic.js`) |
| Local commands | `WosCommands` |
| Screen capture | `WosScreenCapture`(`screen-capture.js`),`WosCaptureTools`; `ScreenMode`/`screen.html` |
| Screen | `ScreenMode`: picture caption placement (`screen.html`); independent picture-read executor (`ScreenMode.java`) |
| Reload notices/keep | `WizWebUpdate`, `WizAppUpdates` (`web-update.js`), `WizAppVersions`, `WosUpdates`/`WosUpdateFlow` (`os-updates.js`, `wos:channel`; APK `UpdatePolicy`); `WizAppCapture.rescueTake`/`pageAudioFree` |
| Provider login (Claude, ChatGPT) for agents and apps | installed login apps (`wizard-claude`, `wizard-chatgpt`; skill `app-owned-codex-connections`) |
| Now playing | `WosMediaWatch` (`media-watch.js`), `WosSkinHost` `api.media`: same-origin media only, inert until watched |
| Native mic/meeting | `NoteRecorder`, `MicRoute` (`audio/*.java`): `NOTE_SOURCES` notes / `SOURCES` STT; `MeetingRecorderService`: update/death pause/resume/rollback; `ProcessExits`/`HangWatch` |
| Android shell capabilities | `WosDevicePort`, `WosDeviceRecording`, `WosDeviceOrb` (`device-{port,recording,orb}.js`); `wizardDevicePort` v1 (`device/DeviceMessageProtocol.java`); page Camera `PageCamera` |
| Home-screen apps / safe top | `WizHomeScreenApps.attach/offer/canOffer/pinWidget`; host: cutout, child inset 0 |
| Home-screen declaration | `WizHomeScreenCapabilities` (`home-screen-capabilities.js`): sanitize/matcher/replicaPrefix |
| Long screenshot, text selection | WebView document scroll, `SelectionWebView`, `ScrollCaptureCrashGuard` (`docs/android-document-scroll.md`). The pinned thread composer sits above the bottom strip: no orb column, re-measures on resume / dock animation end (`qa-orb-doc-scroll-composer.cjs`) |

| Owner Look sync | `WosLookSync` (`look-sync.js`): skin/tweaks/defaults, desktop backdrop + views; legacy seeds; ordered equality-group causal base + pending ACK overlay for all fields; foreground refresh; feature switches |

## Visual (drawn/animated: side-by-side screenshot under `Visual:`)

| Need | Use |
|---|---|
| The orb, any size | `Orb.create(canvas, fallback, {R})` (`web/orb.js`, icon/core); Android `assets/assist/everywhere.html` + skin |
| Skin, scenery and tweaks | `WosSkin` (`skins.js`: setGlass), `WosSkinHost` (`skin-host.js`; sheet yield, boot guard, Group/Sort, projects, workspaces); desktop keys (`desktop/desktop.js`, `layouts/ai-apps/desktop.js`): ⌥←/→ pass, E/Z Archive/Snooze, Z Back. `api.settings.section(id, 'look', node)`; `slots.json`: `home-main`, `paintHome`, `windowRefresh`, beside, inbox/list/notify, `data.read`, `back.push`; `api.apps`/`api.desk`, `api.aiUsage`; `WosExperience` (`experience.js`; retry; stable lock), `WosMySkin` (`my-skin.js`; explicit recovery; bad skin off), `WosScenery` (`scenery.js`), `WizAppearance` (`appearance-host.js`; desk geometry); `desktop-chats.js` |
| Pins-only orb radial | `WosCreateOrbSwitcher`/`WosOrbSwitcher` (`web/core/orb-switcher.js`/`.css`), core phone dock default (not desktop/corner orb); saves pins/voice options as before |
| Background image picker/catalogue/scenery | `WosSettings` Background (`settings.js`) + `WosSkin.wallpapers / setWallpaper` (`skins.js`); Mizel shells + Wizard desktop: Files images (wide/tall), cover/scrim, opaque materials |

| Motion | `WizardMotion` (`web/motion/wizard-motion.js`) |
| Tour/help, responsive Done, skip/exit; desktop `WosTour.desk` | `WosTour` (`tour.js`) |
| Install prompt; `hold(on, owner?)` during tours/overlays | `WizardPwaInstall` (`web/pwa-install.js`) |
| First run (Welcome, Setup), tour | `WosWelcome` (`welcome.js`, +reconnect); `WosSetupLaunch`; checklist `web/setup/setup.js`+get-set-up; phone: `WizPhoneConnect` (`phone-connect.js`) |

## App voice/audio

| Module | Contract |
|---|---|
| `web/core/app-voice.js` (`WosAppVoice`) | Registry names/claims. |
| `web/core/voice-legacy.js` (`WosVoiceLegacy`) | Frozen Music/device schema to APK A; Food grammar; ids: `appIdAliases`. |
| `web/core/background-audio-legacy.js` (`WizBackgroundAudioLegacy`) | Pilot grant/token until APK A. |

## Plumbing (single owner; files in `web/core/` unless noted)

`WizCompanionPane`, `WizardApp`, `WizAppCapture`, `WizComposerInput`, `WizAttachChip`, `WosSkinFrame`, `WosDevice`, `WizAppServices` (`app-services.js`; stopped), `WizCore` (`core.js`, `bridge.js`), `WizConfig`, `WosWriteGuard` (write loops), `WizReach`, `WizAndroidRelay` (`android-relay.js`), `WizBackgroundAudio` (`background-audio.js`), `WizHomeScreenPolicy`/`WizPinDoc` (`home-screen-policy.js`), `WosOwnViews` (`own-views.js`), `WosOrbHandoff` (`orb-handoff.js`), `WosShareSheet` (`share-sheet.js`), `WosBell` (`notif-bell.js`), `WosResources` (`resources.js`), `WosUsage`, `WizPhotosRelay` (`photos-relay.js`), `WosMusic`, `WizDeviceLegacy` (`voice-legacy.js`), openers `WizAppOpen`, `WizCanOpen`, `WizOpenApp`, `WizOpenAgentChats` (`app.js`), `WosBoundView` (`bound-view.js`), `WosWorkspaceSync` (`workspace-sync.js`), `WosMedia`, `WizWorkspaces` ([contract](workspaces.md)), `WizShellBoundary`, `WizBrowserBoundary` (keys/layout/wz-keys/svc/skin/link/own-tab/same-origin), `WizBoundaryClient`.

AI usage: EXTEND `WosResources`/`WosUsage`: extra, `signedIn` ([details](component-contract-details.md)).

