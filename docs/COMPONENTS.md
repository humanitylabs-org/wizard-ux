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
| Talk to an agent about app content: thread, composer, Stop, retry, outbox, model picker, dictation, attachments | `WizardApp.nav.openThread(sessionId, {reply})`, the real Chats thread over the app (wizard-builder `references/chat.md`) | composer, transcript, streaming client or retry loop in the app; `wizard-ui.css` is look only | the shell shows the `[data-chats]` thread for that session; the app frame has no textarea; a forced 503 leaves exactly one outbox item and one delivered message |
| Top-level home-screen name, icon and app root | `WizardAppIdentity` (`web/core/app-identity.js`), loaded by SDK | per-app manifest injectors | app-owned manifest wins; frames untouched |
| Own human-messaging composer input: paste a screenshot/file, dictation-safe text paste (Wispr Flow), empty-paste hint, file drag highlight + drop, Enter / Shift+Enter / Ctrl·Cmd+Enter / IME | `WizardApp.composer.bind(root, {field, zone, onFiles, onSubmit, notice})` → unbind, `WizardApp.composer.insertText`; the same `WizComposerInput` (`web/core/composer-input.js`) Chats uses. App decides what a file becomes in `onFiles`; styles `.is-file-drag` with its tokens | paste/drop/Enter listeners, clipboard reads, own Enter rule | `qa-composer-input.cjs`; app test pastes text + image, drops a file, Ctrl+Enter |
| Back in app; leave on dismiss | `WizardApp.back.register/push`, `nav.back()` | guards, 2nd tap | nested Back stays; dismiss → prior screen |
| Skin, tokens, light/dark | `WizardApp.theme.get / onChange`, `--wz-*` roles | theme storage, own dark mode, literal colours | two skins + a live skin change keep app state |
| Transcribe an existing audio file (EXTEND) | `WizardApp.voice.transcribe(blob, {language})` → `{text}` or `{unavailable:true}`; verified installed frame, 25 MB cap, shell `WizConfig.transcribe` | app/provider transcriber, container-to-Voice-Core request | stale/foreign frame denied; unavailable endpoint is explicit |
| Share text or a file out | `WizardApp.share.text / file` | `navigator.share` | cancelled is not reported as shared |
| Native Android screens in the worn skin | `WizardLook` (`android/app/src/main/java/ai/wizards/os/WizardLook.java`: shell `--wz-*` roles saved natively, Nebula fallback) | literal colours in native screens |
| Native "can't reach your Wizard" screen and the Connect / edit-address screen | `ReachScreen` (`android/app/src/main/java/ai/wizards/os/ReachScreen.java`, rules in `ReachPolicy`; Try again is the only primary, the address is a quiet Edit address line), `ConnectActivity` (`android/app/src/main/java/ai/wizards/os/ConnectActivity.java`, address in `ServerSettings`) | a second offline overlay, a WebView error page, another address editor |
| Share text or a file out (Wizard's share sheet first: people → Wizard apps → Other apps…) | `WizardApp.share.text / file` | `navigator.share`, an own share picker | cancelled is not reported as shared |
| Receive shares from other Wizard apps and the chats (people as direct targets) | `WizardApp.share.receive({accepts, targets, receive}) / targets / check` (`docs/SHARE-SHEET.md`) | own inbound share route, URL-fragment payloads | the item stays pending until `receive` returns true, then is acked once |
| Mic, camera, screen capture | `WizardApp.capture.start / pending / ack` | `getUserMedia`, `MediaRecorder` | pending capture survives Back and is acked once |
| Title-bar tools | `WizardApp.titlebar.set(tools)` | an app header repeating the title | tools appear in the shell title bar |
| Keep an app readable offline, with durable ordered edits | `WizOffline.create` in `core/offline-kit.js` + `core/offline-sw.js` (opt-in config, per-app cache/IDB prefix) | app-specific replica/outbox implementation | pending failures stay recoverable; server idempotency required; never force-reload |
| Open a reviewed Android home-screen app session offline | `core/offline-apps.js` (registry opt-in) + `core/offline-session.js`, `sw.js` config of shared `offline-sw.js`; existing single-app host | second reader, workspace/private-media cache, global WebView network override | exact pin URL cold-reloads with all routes aborted; iframe worker remains registered; chapter/root Back stays |
| Protect unsaved work from updates | `WizardApp.update.hold` | app service worker, forced reload | hold released only after save + readback |
| Reading place in an app document | shell-owned `WizAppReadingPosition` (`web/core/app-reading-position.js`), automatic for registered apps | app-local scroll store | reopen lands at the saved place |
| Motion, haptics, press feel | `WizardMotion` (`/wizard-os-home/motion/wizard-motion.js`) | own spring/haptic helpers | — |
| App look: rows, sections, empty state | the template's `wizard-ui.css` + `--wz-*` | its composer styling as a chat; literal colours | — |

## Shell (`web/core/`, shared by both shells; every row serves every agent kind: main, host-profile, container, restricted; a per-kind variant is a fork, declare it EXTEND)

| Need | Use | Never hand-roll |
|---|---|---|
| Chat list, bottom Focus strip (one agent: All/Spaces/＋; no Spaces: none; multiple agents: All/agent → owned Spaces), nested Filter, shared section collapse, search, thread, composer, attachments, read state and Copy/Share | `WizCore` Chats (`web/core/chats.js`, `web/core/chats.css`); `setFocus` persists `w.focus`; `migrateChatsFocus` folds legacy agent windows; `WizLive` owns data; historical sections appear only when populated | second thread/composer/Focus parser; per-agent or per-shell routing |
| Alternative Chats list | `WizChatsHost` view slot (`web/core/chats-view.js`) | a forked Chats |
| Repaint a live view without flicker (only changed nodes move) | `WosMorph.morph` (`web/core/dom-morph.js`) | whole-view `innerHTML` on every live tick |
| Models, retry, composer mic, receipts, reading place | `WosChatPower` (`web/core/chat-power.js`: one per-thread anchor/offset/atBottom) + `WosModels` (`web/core/chat-models.js`), `WosErrors` (`web/core/chat-errors.js`), `WosWork` (`web/core/chat-work.js`) | model/error/reading-place forks |
| Chats composer paste, drop, Enter | `WizComposerInput.bind` (`web/core/composer-input.js`), shared with apps as `WizardApp.composer` | inline paste/drop/keydown handlers |
| Markdown, drafts, rich copy, Bangkok time, media viewer | `WosChat` (`web/core/chat-kit.js`: `md`, `copyRich`, `viewer`) | a markdown library, own lightbox |
| Owner-created Spaces / Focus | `WizCore` Chats (`web/core/chats.js`), `WizLive.putPrefs` (`spaces` in box-wide ui-preferences); shared Space naming form from the ＋ chip or thread-row Add to a Space picker (including zero Spaces); `WizLive.spaceSessions(ids)` hydrates missing focused members outside global list windows (memory-only, four concurrent reads); `winAgent` / `modelRoute` drive every new-chat adapter; new threads join the Space in front (`WosOutbox.onNew`); `WosAgents.colour` / `distinctHues` drive tab identity and `--ch-agent-hue` list tint | automatic subject tabs, separate collection store, per-shell Focus routing or section implementations |
| Pinned threads (synced across devices) | `WosChatPins` (`web/core/chat-pins.js`) | device-local pin lists |
| Snooze a thread/message until a time or Someday (existing deferred disposition); one-tap presets Later today · Tomorrow · In 2/3/5 days · Next week · Someday, exact picker last as "Other date…"; a successful thread Snooze goes back like Done (threadBack) | `WosBoomerang` (`web/core/scheduled-reminders.js`) on the one scheduler; Settings → Schedules `WosSchedules` (`web/core/schedules.js`) | own timers or reminder stores |
| Thread topic emoji | `WosTopicEmoji` (`web/core/chat-topic-emojis.js`, data `WosTopicEmojiData`) | — |
| Durable send that survives outages without duplicates | `WosOutbox`, `WosCarry` (`web/outbox.js`) | fetch + retry loop |
| Cancelled-recording keep | `WosCancelled` (`web/core/cancelled.js`) | — |
| Share to Wizard | `WizShareWizard` (`web/core/share-wizard.js`) | Native/app input → one phone/desktop sheet |
| Uploads of any size | `WizUploads` (`web/core/uploads.js`) | file input + single fetch |
| Files browse, preview, attach | `WosFiles` (`web/core/files.js`) | own picker |
| Settings entry in both shells | `WosSettings.register` (`web/core/settings.js`); actions/views `WosFeatures` (`web/core/features.js`) | per-feature settings page, shell-only branch |
| Agent identity, glyph, hue | `WosAgents` (`web/core/agents.js`) | hard-coded agent names or colours |
| App routing to an agent | `WosAppRoute` (`web/core/app-route.js`) | — |
| Per-app Connection Router checklist, install follow-through, required-needs open gate | `WosAppSetup` (`web/core/app-setup.js`, `web/core/app-setup.css`); REUSE `routerNeeds`/`routerApprove` and EXTEND `serviceRow` in `web/store/store-router.js`, Store transaction `installRelease` (`web/store/store-install.js`), `WosAppRoute` for private agents, `WizLinks` for connect pages | app-local setup gates or install clients |
| App glyph tiles | `WizSigil` (`web/core/sigils.js`, `web/core/sigils.css`) | PNG/emoji icons |
| App groups | `WosAppKinds` (`web/core/app-kinds.js`) | forks |
| Brand hat | `WizBrand` (`web/core/brand.js`) | redrawn logos |
| Links: in-app sheet, image links | `WizLinks` (`web/core/links.js`) | `window.open`, own iframe sheet |
| Text-selection actions | `WosSelMenu` (`web/core/sel-menu.js`) | own context menu |
| Share sheet, receivers, pending handoffs | `WosShareSheet` (`web/core/share-sheet.js`), via `WosChat.sharePayload / shareFile`; hold bypass: `WosChat.bindSharePress` | a second share picker, sending for an app |
| Screen context for the agent | `WizScreen` (`web/core/screen-text.js`) | own DOM scrape |
| Dictation into a focused field | `WizCore` focused field (`web/core/focused-field.js`); voice `WizCore` (`web/core/voice.js`); mic choice `WosMic` (`web/core/mic.js`) | own recorder/transcriber |
| Local commands | `WosCommands` (`web/core/commands.js`) | a second command parser |
| Screen capture | `WosScreenCapture` (`web/core/screen-capture.js`), `WosCaptureTools` (`web/core/capture-tools.js`) | — |
| Update banners, Settings card, Home pop-up | `WizWebUpdate`, `WizAppUpdates` (`web/core/web-update.js`), `WizAppVersions` (`web/core/app-versions.js`), `WosUpdates` (`web/core/os-updates.js`: `card`/`popup`) | own reload timers, a second card |
| Provider login (Claude, ChatGPT) for agents and apps | the installed login apps (`wizard-claude`, `wizard-chatgpt`; skill `app-owned-codex-connections`) | setup-tokens or bespoke auth flows |
| Native mic recording on the phone (voice notes, orb takes, live dictation) | `NoteRecorder` (`android/app/src/main/java/ai/wizards/os/audio/NoteRecorder.java`) over `MicRoute` (`audio/MicRoute.java`: `MicRoute.start` with `MicRoute.NOTE_SOURCES` for notes people listen to, `MicRoute.SOURCES` for speech-to-text) | `new MediaRecorder`, `AudioRecord` or `setAudioSource` outside `audio/` | `MicRouteTest`, `NoteRecorderTest` (source order, bitrate, every recorder goes through `MicRoute`) |
| Android shell capabilities | `WosDevicePort` (`web/core/device-port.js`), `WosDeviceRecording` (`web/core/device-recording.js`), `WosDeviceOrb` (`web/core/device-orb.js`); `wizardDevicePort` v1 | another envelope or recorder/store; ack before durable custody |
| Add an app to the home screen | `WizHomeScreenApps.attach / offer / canOffer` (`web/core/home-screen-apps.js`): native pin or direct-link guide; optional `WosExperience` arrange/download tweak; docs/pwa-app-install.md | a second long-press menu or pin sheet per surface |
| Android long-screenshot (scroll capture) and text selection in the WebView | `ScrollAccessibilityProvider`, `ChatScrollCapture` + `android/app/src/main/assets/scroll-capture.js`, `SelectionWebView` (`android/app/src/main/java/ai/wizards/os/`) | a second accessibility provider or capture path | capture of a long Chats thread on a real device |

## Visual (anything drawn or animated: attach a side-by-side screenshot under `Visual:`)

| Need | Use | Never hand-roll |
|---|---|---|
| The orb, any size | `Orb.create(canvas, fallback, {R})` (`web/orb.js`); Android mirror `android/app/src/main/assets/assist/everywhere.html` | PNG + CSS spin, Lottie, SVG |
| Skins, backgrounds, scenery, skin feature switches (`--wos-orb-swipe-up`, `--wos-reply-regenerate`) | `WosSkin` (`web/core/skins.js`), `WosSkinHost` (`web/core/skin-host.js`; tweaks on `core/slots.json`; `.builtin` gestures, `api.gesture.intent`), `WosExperience` (`web/core/experience.js`: a family's tweaks), `WosMySkin` (`web/core/my-skin.js`), `WosScenery` (`web/core/scenery.js`), `WizAppearance` (`web/core/appearance-host.js`) | own gradients, canvases or colour constants |
| Motion | `WizardMotion` (`web/motion/wizard-motion.js`) | own keyframe sets |
| Tour and help sheet | `WosTour` (`web/core/tour.js`) | — |

## Shell plumbing (owned by one module; never duplicate, rarely called directly)

`WizardApp` (`web/core/app-client.js`), `WizAppCapture` (`web/core/app-capture.js`, behind `WizardApp.capture`), `WosSkinFrame` (`web/core/skin-frame.js`), `WosDevice` (`web/device.js`), `WizAppServices` (`web/core/app-services.js`), `WizCore` (`web/core/core.js`, `web/core/bridge.js`), `WizConfig` (`web/core/config.js`), `WizReach` (`web/core/reach.js`), `WizAndroidRelay` (`web/core/android-relay.js`), `WizBackgroundAudio` (`web/core/background-audio.js`), `WizHomeScreenApps` (`web/core/home-screen-apps.js`), `WizHomeScreenPolicy` (`web/core/home-screen-policy.js`), `WosOwnViews` (`web/core/own-views.js`), `WosOrbHandoff` (`web/core/orb-handoff.js`), `WosSetupLaunch` (`web/core/setup-launch.js`), `WosShareSheet` (`web/core/share-sheet.js`), `WosBell` (`web/core/notif-bell.js`), `WosResources` (`web/core/resources.js`), `WosUsage` (`web/core/usage.js`), `WizPhotosRelay` (`web/core/photos-relay.js`), `WosMusic` (`web/core/music-voice.js`), `WizVideoDesks` (`web/core/video-desks.js`), `WosUsuals` (`web/usuals.js`), phone shell openers `WizAppOpen`, `WizCanOpen`, `WizOpenApp`, `WizOpenAgentChats` (`web/app.js`), `WosBoundView` (`web/core/bound-view.js`, bound-thread feedback lifecycle), `WosWorkspaceSync` (`web/core/workspace-sync.js`, same desks across devices).
