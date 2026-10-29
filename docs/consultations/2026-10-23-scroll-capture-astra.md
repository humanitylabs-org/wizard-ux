1. **Yes: you have identified the immediate blocker.** This Samsung attempt uses the standard capture search; returning an empty rectangle explicitly excludes your WebView. That explains “unsupported,” although successful subsequent capture remains unproven. [Callback contract](https://developer.android.com/reference/android/view/ScrollCaptureCallback)

   AOSP ranking considers inclusion hints, ancestry and area, with additional occlusion handling in newer code; it is not simply “largest wins.” Nothing here establishes a Samsung-specific minimum area. Your 80 CSS-pixel threshold is your own. Thirteen milliseconds is fine. Return a nonempty rectangle within the visible WebView. Samsung’s separate toolbar cannot itself become a DOM `elementFromPoint()` result. [AOSP selection](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/view/ScrollCaptureSearchResults.java)

2. **I’d ship an explicit capture viewport, with (b) as fallback and selective overlay hiding.** Have the shell identify the active thread scroller directly. Lay out headers/composer outside its scrollport; mark decorative controls explicitly for capture-time hiding.

   Search should intersect the scrollport with ancestor clipping, the visual viewport and native local-visible bounds. Keep search nonmutating. For overlapping chrome, derive a stable uncovered rectangle from overlay geometry; reject a genuine modal, not an entire thread because one sample fails.

   Center/majority sampling is useful evidence, insufficient protection against repeated overlays. Hit testing also misses `pointer-events:none` visuals and can flag transparent hit targets. Never blanket-hide fixed/absolute elements: those can contain actual messages or essential layout.

   Freeze the selected element, rectangle and overlay plan through start/image requests. **Change `bounds()`, `start()` and `valid()` together.** Otherwise search succeeds and start repeats the rejection.

   Cropping introduces an endpoint trap: content behind excluded top/bottom strips may never enter the capture band at scroll limits. Prefer fixing layout; otherwise provide temporary padding/reflow and adjust coordinates, testing first/last messages.

3. **Remove the scroll-proxy overrides and synthetic host accessibility scrolling.** Keep the explicit callback and inclusion hint. Your evidence gives neither experiment a role in this path, and both misrepresent WebView behavior. Preserve normal Chromium accessibility; evaluate accessibility improvements independently.

4. **My ranked remaining risks, inferred from this code:**

   **Highest — self-abort/lifecycle.** `document.hidden` rejects start/check, and `visibilitychange` immediately restores. Focus loss does not necessarily imply hidden state; record both. During an OS-owned session, visibility alone should not terminate capture. Preserve cancellation, navigation/detachment, renderer failure and watchdog cleanup.

   **Next — changing content/geometry.** Streaming text, image loading and shell updates trigger your mutation observer or exact geometry comparisons. Queue content updates during capture; report precisely which invariant changed.

   **Next — stale frames/timeouts.** Your 1800 ms timer covers the entire request, not merely JS. Two `postOnAnimation` callbacks are not two completed draws. `postVisualStateCallback` guarantees readiness for a subsequent draw; request invalidation and await a committed frame before PixelCopy. Instrument stages before changing deadlines. [WebView contract](https://developer.android.com/reference/android/webkit/WebView#postVisualStateCallback(long,%20android.webkit.WebView.VisualStateCallback))

   **Then — coordinate errors.** Native clipping and DPR checks currently occur during search, so they are not post-success failures unless geometry changes. Intersect legitimate clipping instead of rejecting it; retain scale validation. Test fractional density and partial/end tiles.

   **Lower — PixelCopy/session surface.** PixelCopy reads your window’s buffer, so Samsung’s separate toolbar should not be stamped into it; stale buffers remain possible. Record copy status and surface-post exceptions. [PixelCopy contract](https://developer.android.com/reference/android/view/PixelCopy)

5. **Next-build diagnostics, in priority order:**

   **First:** per-candidate rejection details and all failed sample coordinates; bounded element/ancestor tag, class, rect, position, z-index, opacity, visibility, pointer-events and transform. Include `elementsFromPoint()` stacks. Preserve reason codes; omit message text.

   **Second:** one capture/request ID across native and JS; timestamps for search, start, move, visual callback, draw/commit, PixelCopy, buffer post, completion, cancellation and restoration. Log every `end()` cause, including mutation target/type.

   **Third:** CSS/native rectangles, visual viewport offsets/scale, DPR, insets, window location, lifecycle/focus/visibility, requested versus actual scrollTop, returned tile bounds, canvas dimensions and surface validity. Record explicit successful buffer submission. This separates rejection, lifecycle abort, frame stall and output failure in one attempt.