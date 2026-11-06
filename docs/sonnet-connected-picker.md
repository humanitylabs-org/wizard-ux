# Connected Claude: approved Sonnet stays selectable

Recommended fix: the Claude login app reports a native account as `connected`, but the shared picker admitted only `ready`, `ok`, `exhausted` and `rate_limited`. With the global default on Sol, this hid the authenticated Anthropic catalogue and left only legacy Sonnet 5. The production change admits that existing successful status; no model approval, default, account, configuration or backend change.

Reuse:
- model choices: REUSE WosModels (`web/core/chat-models.js`), existing native-account predicate and provider normalization.
- picker interaction: REUSE WizCore Chats and WosModels.popHtml, through the real phone and desktop composer.
- browser QA: REUSE `qa-model-picker-bounds.cjs` boot, source transport and opaque-panel pixel method; focused companion `qa-sonnet-connected-picker.cjs` keeps the same shell/entrypoints rather than constructing another picker.

## Focused acceptance (prepared, not claimed executed)

- Same harness against exact serving baseline and live-based candidate; four cases each: phone Android-UA/touch 412×892 and desktop 1440×960, Nebula and actual Light ID `obsidian-light`.
- Open an unsent draft, click the real model label and More models, assert exact `anthropic/claude-sonnet-5-5`, click it and read the resulting draft route. The baseline must fail only `connected-native-sonnet` once in each case; any setup or unrelated failure rejects the red proof.
- Keep global `openai-codex/gpt-6.1-sol`, the legacy Sonnet 5 option and the typed draft; switch the existing document to the second skin. Retain expanded/selected screenshots and opaque-panel loud/blank pixel pairs.
- Service workers blocked, synthetic bootstrap/setup/models/accounts/empty sessions, every non-GET/HEAD refused 403 before handlers, no inference and no real API/network pass-through. Request journals separate source-static, synthetic APIs and refused writes.
- Run focused native-picker, model-refresh/revalidation, agent-default and component-inventory unit checks in the same parent-admitted forum runner. Main-based source is a separate minimal port, not the serving bundle.

Visual: no markup/style/token change. Browser screenshots are pending parent admission; synthetic UA/touch is not physical-device acceptance. Parent must inspect the actual resulting screenshots before activation. Production defaults and accounts are not changed by QA.

## Delivery custody

Live source starts at exact serving `03fa4ee793cec2e1b1d31c44d4f323a1448b1455`. Shared main is reconciled separately by draft PR; do not replace live with main. Parent owns heavy-job submission, acceptance judgment and any live promotion. No merge or activation is authorized to the preparation helper.
