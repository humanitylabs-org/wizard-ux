# Desktop window width

James's 13 Oct request: cap any individual desktop component, center a lone app with scenery visible, tile new apps beside it, and fill available width on narrow windows.

Route: scoped desktop-only Standard implementation by Hermes/Sol; James supplied the layout direction. No new architecture, dependencies, native build, data change, or release to daily. Private staging preview for visual acceptance. Sustained browser QA runs on Thales.

Acceptance:
- Lone Chats and hosted apps are 1200px wide at most, centered; existing vertical height preserved.
- Two apps form a centered adjacent pair, each within the cap. Three-plus preserve master/stack layout with each column capped.
- Narrow/resized windows use available width; shell selection, draft/frame state and focus remain unchanged.
- Closing the neighbour recenters the remaining app; workspace/reload changes recompute layout.
- Explicit immersive fullscreen remains the fullscreen thread's contract; outer Mac fullscreen uses capped normal tiling.

Evidence: same browser regression on baseline and candidate on Thales; staged HTTPS path exercised with writes intercepted/refused, source hashes verified, screenshots inspected. Production awaits visual acceptance.
