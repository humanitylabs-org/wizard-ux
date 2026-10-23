**1. Diagnosis.** Yes. `ScrollCaptureSearchResults` is the AOSP `ViewRootImpl` path, and One UI 8.5 uses it unchanged. The "not supported" toast is Samsung's rendering of a `ScrollCaptureResponse` with no connection. The only hard filters are: the View is VISIBLE, no EXCLUDE hint, the returned rect is non-empty after intersection with the View's local visible rect, and the search completes within 2.5 s. Area only ranks competing targets, and you have none. The focus pattern is informative: Samsung dismisses its toolbar before searching, so the page is live and `document.hidden` is false at search time. Your JS rejected the scroller. Fix the JS and the pipeline proceeds.

**2. Design.** Hit-testing is not paint occlusion. `elementFromPoint` skips `pointer-events:none` overlays that do paint, and flags transparent hit layers that do not. The most likely occluder is a glass header or composer the thread scrolls under, with padding inside the scroller, so the 10% and 90% rows hit chrome. Ship option b plus a narrow option c:

- Column scan at x in {.15, .5, .85}, stepping 8 CSS px vertically. A row is clear if all three hits are inside the scroller or a docked control. Take the longest clear run, require it to be at least max(160 px, 35% of scroller height), and return that band.
- Anything hit inside the chosen band that is neither ancestor nor descendant of the scroller is a floating control. Record it and set `visibility:hidden !important` on it for the session, as you already do for DOCK. Full-width hits touching the band's top or bottom edge are chrome and clip the band instead.
- Disable `position:sticky` inside the scroller via a session class, or sticky date headers get stamped into every tile.
- Keep the transform and zoom guards. Replace `too-small` with the band minimum.

**3.** Drop both. An explicit `setScrollCaptureCallback` shadows `ScrollCaptureInternal`, so AOSP never consults `canScrollVertically` on this View, and your log shows Samsung does not either. The proxy overrides corrupt WebView's own scrollbar and overscroll metrics, and advertising a scrollable accessibility host changes what Bitwarden and the keyboard service see. Pure risk, zero benefit.

**4. Remaining failure points, most to least likely.**

1. Content mutation abort. Any `childList` change inside the scroller ends the session, and `valid()` aborts on any `scrollHeight` change. Lazy images, streaming tokens, virtualized rows and typing indicators all do this as you scroll. Abort only when content above the current `scrollTop` shifts, detected via an anchor element's offset. Re-base when height grows below.
2. Strict `rect(b).equals(session.getScrollBounds())` in start. AOSP clips the rect to the local visible rect and may adjust it. Accept session bounds that are contained in yours, and capture with them.
3. WebView paused. If MainActivity calls `web.onPause()` from `Activity.onPause`, Chromium stops producing frames, `postVisualStateCallback` never fires, `document.hidden` flips, and your handler ends the session. Defer `web.onPause()` while a session is active, and stop ending on `visibilitychange`.
4. Stale buffer. PixelCopy of the window reads the app's own surface, so the Samsung overlay is never in a tile. But if the window is not being composited you copy the previous frame and `check()` still passes. Hash each tile and fail when it equals the previous one.
5. dpr mismatch. Low. Samsung display zoom changes density coherently. Only a visualViewport scale other than 1 breaks it, and you guard that.
6. The 1800 ms timeout and 30 s deadline are fine at roughly 200 ms per tile.

**5. Diagnostics for the next build.**

- Replace the reason whitelist with sanitized passthrough, 64 chars, `[a-z0-9|-]`.
- Per rejected candidate: tag, id, classes, rect, scrollHeight, clientHeight. Per failed sample point: x, y, hit tag#id.class, hit rect, position, z-index, opacity, pointer-events, background-color, and three ancestor tags.
- Viewport: innerWidth and innerHeight, visualViewport width, height, scale and offsetTop, dpr, `document.visibilityState`.
- Java side: `web.getWidth` and `getHeight`, `getLocalVisibleRect`, `getLocationInWindow`, root window insets, `Activity.onPause` and `onResume` timestamps, `session.getScrollBounds()` in start, every image request rect with your reply rect, PixelCopy result code, and VisualStateCallback latency.
- A debug intent, fireable over adb, that runs the same search and start on the live page and dumps all of the above without a screenshot. That turns "one more device attempt" into a ten-second loop James can run repeatedly.
