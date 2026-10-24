# Wizard OS components: reuse before build

**One implementation per capability.** Before you build any UI, chat, auth, upload, settings, visual or per-agent-kind logic, find the need below and reuse its entry point. If a row nearly fits, **extend that module** (as PR #338 added `Orb.create` to `web/orb.js`) instead of building beside it. NEW is only for a need no row covers: it lands in `web/core/` with a row here in the same PR, never inside an app.

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
| Owner signatures and private sealing on the phone | `WizardApp.identity.{info,sign,nip44_encrypt,nip44_decrypt}` (`web/core/app-client.js`), forwarded by `WizAppServices` for installed same-origin apps to `WizCore.bridge.call` / `wizardDevicePort` | app-owned keys, custom signer ports, approval descriptions, remembered grants, desktop fake success | `tests/wizard-id-bridge.test.mjs`; Thales `Nip44Test` + `WizardIdFlowTest` |
| Talk to an agent about app content: thread, composer, Stop, retry, outbox, model picker, dictation, attachments | `WizardApp.nav.openThread(sessionId, {reply})`, the real Chats thread over the app (wizard-builder `references/chat.md`) | composer, transcript, streaming client or retry loop in the app; `wizard-ui.css` is look only | the shell shows the `[data-chats]` thread for that session; the app frame has no textarea; a forced 503 leaves exactly one outbox item and one delivered message |
| Back inside the app | `WizardApp.back.register / push / useHistory` | root history guards, CloseWatcher | nested view + Back keeps the app open |
| Skin, tokens, light/dark | `WizardApp.theme.get / onChange`, `--wz-*` roles | theme storage, own dark mode, literal colours | two skins + a live skin change keep app state |
| Share text or a file out | `WizardApp.share.text / file` | `navigator.share` | cancelled is not reported as shared |
| Mic, camera, screen capture | `WizardApp.capture.start / pending / ack` | `getUserMedia`, `MediaRecorder` | pending capture survives Back and is acked once |
| Title-bar tools | `WizardApp.titlebar.set(tools)` | an app header repeating the title | tools appear in the shell title bar |
| Protect unsaved work from updates | `WizardApp.update.hold` | app service worker, forced reload | hold released only after save + readback |
| Reading place in an app document | shell-owned `WizAppReadingPosition` (`web/core/app-reading-position.js`), automatic for registered apps | app-local scroll store | reopen lands at the saved place |
| Motion, haptics, press feel | `WizardMotion` (`/wizard-os-home/motion/wizard-motion.js`) | own spring/haptic helpers | — |
| App look: rows, sections, empty state | the template's `wizard-ui.css` + `--wz-*` | its composer styling as a chat; literal colours | — |

## Shell (`web/core/`, shared by both shells; every row serves every agent kind: main, host-profile, container, restricted; a per-kind variant is a fork, declare it EXTEND)

| Need | Use | Never hand-roll |
|---|---|---|
| Chat list, thread, composer, thread card, read state, reply action row (Copy · Share; Regenerate only when the skin sets `--wos-reply-regenerate: on`) | `WizCore` Chats (`web/core/chats.js`, `web/core/chats.css`); live data `WizLive` (`web/live.js`) | a second thread, composer or per-agent thread logic; extra per-reply buttons on every skin |
| Alternative Chats list | `WizChatsHost` view slot (`web/core/chats-view.js`) | a forked Chats |
| Model picker, errors and retry, composer mic, work receipts, reading place | `WosChatPower` (`web/core/chat-power.js`) + `WosModels` (`web/core/chat-models.js`), `WosErrors` (`web/core/chat-errors.js`), `WosWork` (`web/core/chat-work.js`) | own model list, own error card, own reading-position store |
| Markdown, drafts, rich copy, Bangkok time, media viewer | `WosChat` (`web/core/chat-kit.js`: `md`, `copyRich`, `viewer`) | a markdown library, own lightbox |
| Pinned threads (synced across devices) | `WosChatPins` (`web/core/chat-pins.js`) | device-local pin lists |
| Snooze a thread/message until a time or Someday (existing deferred disposition) | `WosBoomerang` (`web/core/scheduled-reminders.js`) on the one scheduler; Settings → Schedules `WosSchedules` (`web/core/schedules.js`) | own timers or reminder stores |
| Thread topic emoji | `WosTopicEmoji` (`web/core/chat-topic-emojis.js`, data `WosTopicEmojiData`) | — |
| Durable send that survives outages without duplicates | `WosOutbox`, `WosCarry` (`web/outbox.js`) | fetch + retry loop |
| Cancelled-recording keep | `WosCancelled` (`web/core/cancelled.js`) | — |
| Uploads of any size | `WizUploads` (`web/core/uploads.js`) | file input + single fetch |
| Files browse, preview, attach | `WosFiles` (`web/core/files.js`) | own picker |
| Settings entry in both shells | `WosSettings.register` (`web/core/settings.js`); actions/views `WosFeatures` (`web/core/features.js`) | per-feature settings page, shell-only branch |
| Agent identity, glyph, hue | `WosAgents` (`web/core/agents.js`) | hard-coded agent names or colours |
| App routing to an agent | `WosAppRoute` (`web/core/app-route.js`) | — |
| App glyph tiles | `WizSigil` (`web/core/sigils.js`, `web/core/sigils.css`) | PNG/emoji icons |
| Brand hat | `WizBrand` (`web/core/brand.js`) | redrawn logos |
| Links: in-app sheet, image links | `WizLinks` (`web/core/links.js`) | `window.open`, own iframe sheet |
| Text-selection actions | `WosSelMenu` (`web/core/sel-menu.js`) | own context menu |
| Screen context for the agent | `WizScreen` (`web/core/screen-text.js`) | own DOM scrape |
| Dictation into a focused field | `WizCore` focused field (`web/core/focused-field.js`); voice `WizCore` (`web/core/voice.js`); mic choice `WosMic` (`web/core/mic.js`) | own recorder/transcriber |
| Local commands | `WosCommands` (`web/core/commands.js`) | a second command parser |
| Bound views beside a thread | `WosBoundView` (`web/core/bound-view.js`), renderers `WosViews` (`web/core/views.js`) | — |
| Screen capture | `WosScreenCapture` (`web/core/screen-capture.js`), `WosCaptureTools` (`web/core/capture-tools.js`) | — |
| Update banners | `WizWebUpdate`, `WizAppUpdates` (`web/core/web-update.js`), `WizAppVersions` (`web/core/app-versions.js`), `WosUpdates` (`web/core/os-updates.js`) | own reload timers |
| Provider login (Claude, ChatGPT) for agents and apps | the installed login apps (`wizard-claude`, `wizard-chatgpt`; skill `app-owned-codex-connections`) | setup-tokens or bespoke auth flows |
| Native Android device capability called from the shell (packages, Wizard ID identity/signing, visible WebP capture; later mic, automation, notifications) | `wizardDevicePort` v1 (`android/app/src/main/java/ai/wizards/os/device/DeviceMessageProtocol.java`; add an adapter and list it in `device.capabilities`; see `docs/android-device-message-port.md`) | feature-named `@JavascriptInterface` methods, a second envelope on `wizardAppsPort`, native feature screens or wording except the explicitly native secret/approval flow in `docs/WIZARD_ID.md` |

## Visual (anything drawn or animated: attach a side-by-side screenshot under `Visual:`)

| Need | Use | Never hand-roll |
|---|---|---|
| The orb, any size | `Orb.create(canvas, fallback, {R})` (`web/orb.js`); Android mirror `android/app/src/main/assets/assist/everywhere.html` | PNG + CSS spin, Lottie, SVG |
| Skins, backgrounds, scenery, skin feature switches (`--wos-orb-swipe-up`, `--wos-reply-regenerate`) | `WosSkin` (`web/core/skins.js`), `WosSkinHost` (`web/core/skin-host.js`; `WosSkinHost.builtin` gestures every skin wears, e.g. thread swipe-back in `web/core/thread-swipe-back.js` with `web/core/swipe-intent.js`), `WosMySkin` (`web/core/my-skin.js`), `WosScenery` (`web/core/scenery.js`), `WizAppearance` (`web/core/appearance-host.js`) | own gradients, canvases or colour constants |
| Motion | `WizardMotion` (`web/motion/wizard-motion.js`) | own keyframe sets |
| Tour and help sheet | `WosTour` (`web/core/tour.js`) | — |

## Shell plumbing (owned by one module; never duplicate, rarely called directly)

`WizardApp` (`web/core/app-client.js`), `WizAppCapture` (`web/core/app-capture.js`, behind `WizardApp.capture`), `WosSkinFrame` (`web/core/skin-frame.js`), `WosDevice` (`web/device.js`), `WizAppServices` (`web/core/app-services.js`), `WizCore` (`web/core/core.js`, `web/core/bridge.js`), `WizConfig` (`web/core/config.js`), `WizReach` (`web/core/reach.js`), `WizAndroidRelay` (`web/core/android-relay.js`), `WizBackgroundAudio` (`web/core/background-audio.js`), `WizHomeScreenApps` (`web/core/home-screen-apps.js`), `WizHomeScreenPolicy` (`web/core/home-screen-policy.js`), `WosOwnViews` (`web/core/own-views.js`), `WosOrbHandoff` (`web/core/orb-handoff.js`), `WosSetupLaunch` (`web/core/setup-launch.js`), `WosBell` (`web/core/notif-bell.js`), `WosResources` (`web/core/resources.js`), `WosUsage` (`web/core/usage.js`), `WosPhotos` (`web/core/photos-settings.js`), `WosMusic` (`web/core/music-voice.js`), `WizVideoDesks` (`web/core/video-desks.js`), `WosUsuals` (`web/usuals.js`), phone shell openers `WizAppOpen`, `WizCanOpen`, `WizOpenApp`, `WizOpenAgentChats` (`web/app.js`).
