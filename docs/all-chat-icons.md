# App identity across Chats

James accepted the Topics MVP and authorized production rollout across all applicable apps together (14 Oct 2026, Chat icons thread).

## Shared contract

`wizard_app_id` normalizes into `appId`. `WizCore.threadApp(id)` resolves explicit provenance against the same installed app registry/sigil record as the launcher. Native built-ins such as Food (`usuals`) use their existing house sigil. Unknown/malformed IDs and app mentions in a title/body do not acquire branding. Topics retains its exact legacy roundup ID compatibility.

Primary app identity remains visible in every state. Working/approval/error/needs-you/check/deferred signals retain their existing corner glyphs; Done/FYI words and unread weight remain independent. App-registry repaint respects held rename/actions sheets and touch scrolling on both shells, including desktop synthetic `::list` hosts. Open-thread draft contents survive registry reload. No native APK changes are needed.

Production removes the Topics-only allowlist and both preview-entry HTML tags. `preview-topic-icons.js` is deleted; production never autofilters Chats to Topics.

## Producer contract

Backend companion supplies provenance from a validated final status `app_id` or the latest assistant publisher's explicit `display_metadata.app_id`, while preserving status stripping, subject/title behavior and newest-request freshness. It teaches the agent to label actual app output with the installed app ID. Merely discussing an app is insufficient. Native Food is supported alongside dynamically registered apps.

Topics and Signal scheduled publishers add `app_id` to their existing metadata. Their message body, frozen-report semantics and idempotency are preserved. The focused publisher contract checks use real disposable SessionDB state and never publish a live test report.

## Verification before production

- VPS pure-render/normalization contracts: 28 checks over the ten explicitly named apps.
- Thales real HTTPS all-app UI fixture suite: 156/156; every currently installed renderable app plus native Food (23 app IDs), both phone/desktop, five status badges for each of the ten named apps; zero page errors and no application mutations.
- Thales real-session interaction suite: 35/35; exact served assets, real Topics thread → Back, reload, unsaved rename/actions sheets, actual touch scroll, draft contents and narrow viewport.
- Bounded publisher probes: five real disposable SessionDB checks; Topics idempotency and Signal frozen metadata preserved.
- Remote evidence directory: `/Volumes/ThalesMedia/WizardQA/all-chat-icons-20261014/`.
- Parent evidence mirror: `/home/telos/.hermes/data/releases/all-chat-icons/`.

Backend implementation review/full-suite receipt and post-deployment verification are separate remaining gates. Historical Topics preview remains isolated until release is verified.
