# Standard desktop shell view

AI apps (designed by Miguel) is a built-in renderer, not a personal tweak dependency.
Settings > Look offers Desks, AI apps, Orb and Apps on desktop. Phone rendering and switches remain unchanged.
The existing `manifest.view` optionally names its built-in `layout`, for legacy choice migration and the compatible tweak switch.

`wos.desktop-view.v1` is a device-local fallback/cache, never a shared-intent seed. The live causal Look synchronizer is unchanged: explicit `state.views.desktop` wins (including empty-string Desks), then a supported legacy shared view; only a genuinely unchosen desktop receives AI apps. Explicit picker taps emit the existing `wos:view-choice` event and share the canonical tweak ID (or empty string), preserving the phone field and built-in defaults. The cache records the effective local layout, including explicit `classic` (Desks). On first migration, preserve an enabled legacy view or a legacy `wos.layout`; any explicit true/false view entry with none enabled means Desks. An unrelated tweak / preset without a view is not a shell-view choice and gets the desktop default. Snapshot explicit switches (including legacy carry/off and recipe choices) before flattening legacy profiles, because flattening drops false entries. Retain a pending snapshot across concurrent refreshes and interrupted loads until the one-shot choice is committed. An old flattened empty mix with no remaining choice marker is indistinguishable from never choosing; treat that as unchosen. Never seed the new desktop default into the shared tweak set or the legacy `wos.layout` key (which phone also reads), or change the phone's default.

Core `setStandardLayout` gives the built-in renderer a stable owner independently of personal tweak lifetimes; `api.layout.use` remains compatible and idempotent. Desktop built-in views load no personal view scripts. Later edits to a personal experiment cannot change the standard desktop setup. The renderer itself remains the shared layout source.

Reuse: REUSE core/usage.js and core/resources.js as AI usage owners; reuse the built-in AI apps layout and shared Settings controls.
Reuse: EXTEND core/experience.js device-choice migration and core/skin-host.js layout lifetime ownership.
Reuse: NEW none.

Staging only. Production promotion requires James's approval after trying the preview.
