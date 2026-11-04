# Preserve existing app identities

## Mechanism and provenance

- The approved shared sigil renderer was introduced in `bb432d3891c411c6a995ab8a009ceebc51af3aa8` (10 Oct 2026). Messenger's existing `chats` silhouette and allocated cyan were added in `dff3b59148b10c06dce4bddeb5d4812b0d814b7f` (12 Oct). Artwork has not disappeared from the generator.
- Package-logo precedence was introduced by `e32928e9e1f56029aee37a4c88e6e7f550d3e22f`, merged to the first-parent line as `c01bdf7d9131f2766fcd0a502c25a757509eecce` in PR #767 (1 Nov UTC; owner decision recorded 31 Oct). `of()` calculated a sigil and then unconditionally attached a safe package-logo URL; `html()` returned `sglogo` before glyph/brand handling. Thus a package image—not a new drawing—hid the existing artwork and its shared hover treatment.
- The PR #767 merge comment records a conditional owner decision to keep the recommended package-logo feature. That is evidence of the feature decision, not evidence that James approved replacement artwork app by app. His 3 Nov correction controls: restore already-built approved icons and audit the whole installed set. Do not invent a claim that the earlier merge was unauthorised, or blame its author.
- PR #884 restored Notes and its compatibility alias only. That scope was too narrow: the same resolver still preferred package pictures for Messenger and other existing glyphs/brands. Remove the exception mechanism rather than extending a personal list.
- Closed proposal #776 and open proposal #813 are not shipped authority. This repair does not adopt their new glyphs, name-based inference or replacement of unknown app artwork.

## Owning invariant

Resolve named registered glyph → canonical house/compatibility identity → explicit safe same-origin mask → safe package-logo fallback → existing initial-mask fallback. Existing product-brand masks remain unchanged. A package icon file does not displace a canonical house identity. Preserve explicit registered-glyph choices and their supplied colour. Do not redraw icons or change hover CSS.

Reuse: `WizSigil.of/html/box`, canonical `HOUSE`/aliases/`BRAND`, generator, shared skin hover paint. Extend: precedence and Store's app-icon entrypoint. New: no artwork or rendering subsystem.

## Audit boundary and acceptance

The audit reads only nonsecret shell/install registry and package-logo metadata plus public static image assets. It does not read Messenger messages, runtime databases, credentials/config, app data, or private-agent paths. The owner registry inventory stays outside committed fixtures. Shell and installed-package IDs are reconciled as a deduplicated union, including stopped and compatibility records. Unknown IDs retain their current pictures/fallback; absence of approved art is not permission to design it.

`tests/app-icon-identity.test.mjs` covers every house entry/alias, cached and fresh logo URLs, metadata paths, explicit glyphs/custom masks, brands, unsafe URLs and unknown-app controls. `tests/qa-app-icon-identity.cjs` reuses the real shell/picker on phone and desktop with live Dark/Light switching, every changed icon, white desktop selection outline, contact sheets, cached logos and metadata refresh. All dynamic APIs are synthetic and all mutations are refused before handlers, with exact HTTP-status evidence. Browser and generator execution require an admitted forum job. Store also has dark standalone and unknown-logo controls. Passing preparation or syntax checks is not browser acceptance or activation.
