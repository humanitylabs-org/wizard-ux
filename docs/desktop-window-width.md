# Desktop window width

James's 13 Oct request: cap any individual desktop component, center a lone app with scenery visible, tile new apps beside it, and fill available width on narrow windows.

Route: scoped desktop-only Standard implementation by Hermes/Sol; James supplied the layout direction. No new architecture, dependencies, native build, data change, or release to daily. Private staging preview for visual acceptance. Sustained browser QA runs on Thales.

Acceptance:
- Lone Chats and hosted apps are 1200px wide at most, centered; existing vertical height preserved.
- Two apps form a centered adjacent pair, each within the cap. Three-plus preserve master/stack layout with each column capped.
- Narrow/resized windows use available width; shell selection, draft/frame state and focus remain unchanged.
- Closing the neighbour recenters the remaining app; workspace/reload changes recompute layout.
- Explicit immersive fullscreen remains the fullscreen thread's contract; outer Mac fullscreen uses capped normal tiling.

Evidence on Thales: original baseline 32 pass/10 fail → exact staged candidate 42/42. Both JS/CSS hashes are taken from browser-loaded response bodies and compared with expected source files; APIRequestContext is never used for overridden-asset provenance. Integrated fullscreen parity 22/22, fresh review entry + real Wisdom app + unchanged phone shell 11/11. The same delivered HTTPS link loads a 1200px Chats window at x=360 in a 1920px viewport; closing Wisdom recenters it. Writes are refused by the isolated gateway; candidate source is a detached exact SHA with enabled restartable preview and read-only app-route tunnel services. Independent source reviewer found no layout blockers; its provenance fix is applied and reverified. Production remains unchanged pending James's visual acceptance.

Historical preview: `/wizard-os-home/?shell=desktop&open=chats` on the retired custom domain.

Verification limit: viewport resize/large desktop browser dimensions were tested, rather than the physical Mac green-button transition. James judges whether the 1200px width feels right on his desktop. Explicit app immersive fullscreen remains full-viewport.

Evidence root: `$WIZARD_WORK_ROOT/wizard-os/desktop-window-width-20261013` on Thales. Small receipt copies: `$HERMES_HOME/data/releases/desktop-window-width/evidence`. Preview home: `$HOME/.local/share/wizard-stage/desktop-width`. Approve/ship then integrate the latest daily into the candidate and rerun decisive geometry/fullscreen before production activation.
