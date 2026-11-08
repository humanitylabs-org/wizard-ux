# Core pane placement

Reuse: EXTEND Classic desktop split and weighted columns (`WizCore.panes`). AI apps consumes this geometry; it does not own another tiler. Classic keeps its previous split fallback, reservation, rounding and window ordering.

`WizCore.panes.get()/set(patch)/subscribe(fn)` is an internal device-local API. `get` returns a copy; `subscribe` returns teardown. State lives only in `wos.pane-layout.v1` on this browser/device (not shared Look preferences).

AI apps window headers offer Centred, Side by side, Full screen and Back to tiled, plus Chats list. Hold Alt/Option for the labelled shortcuts guide: **Alt+Shift+U**, **Alt+Shift+J**, **Alt+Shift+F**, **Alt+Shift+T** respectively. These shifted chords do not replace the layout's existing plain Alt keys (including Alt+F Wider and Alt+T Tidy). Escape leaves full mode only after recording and transient overlay owners have had their turn in `WizEscapeBack`. The header stays with the retained window during motion; full mode keeps the Chats-list and tiled controls reachable. Mode/focus persist across reload; ratios are not rewritten.

- `slots`: ordered `chats`, `app`, `app2`, de-duplicated.
- `mode`: `tiled` (default, exactly the previous geometry), `centre`, `pair`, or `full`. Invalid/old saved values use `tiled`. Mode changes do not mutate saved ratios, weights, slots or dock: switching back restores the tiled arrangement.
- `focus`: `chats` (default), `app`, or `app2`. If unavailable, use active Chats, then the first active slot. Centre shows only that slot in a floating box centred on the inset viewport, capped at 840px wide with up to 32px margins. Full gives that slot the inset viewport and zero-size dock/sidebar rectangles; the UI adapter owns chrome reachability. Pair fills the normal content stage with the focused slot and first other active slot, in saved slot/side order, using `ratio` (half by default) and hiding any third slot. Pair deliberately ignores tiled weights without overwriting them. Non-tiled modes clamp to the available viewport; inactive slots have empty rectangles. The AI apps adapter renders these modes through the retained desktop host; it does not create a second window manager.
- `ratio`: null preserves the existing AI apps overlay/default sizes exactly. `1/2`, `1/3`, `2/3` or a free fraction (clamped to Classic's .25–.75) tile active slots within the content rectangle. The fraction is Chats' share regardless of its side.
- `weights`: positive per-slot weights, normalized by the shared column allocator. They override ratio shares individually.
- `side`: `start` or `end` moves the sidebar and Chats. Apps keep slot order; Chats moves to end when requested.
- `dock`: `edge` start/end/top/bottom plus physical `insets` (`start`, `end`, `top`, `bottom`, nonnegative pixels). The pure model supports all four edges. **AI apps currently renders top/bottom as end**, retaining the requested saved value: horizontal keyboard/drag interactions are not shipped. Start/end keep the existing vertical tab semantics and adapt resize direction.
- `app2`: ID of another already-open, mounted app desk; include `app2` in slots to show it. This reuses its existing window/iframe. Future controls must open the app through the existing app opener before binding the slot. No app creation, new toolbar or picker is added.

Example for a future control:

```js
WizCore.panes.set({ ratio: '1/3', side: 'end', dock: { edge: 'start' } });
// Existing opener first, then bind an already-open second app:
WizCore.panes.set({ slots: ['app', 'app2'], app2: 'notes', weights: { app: 2, app2: 1 } });
```

`geometry(model, {width,height}, environment)` is pure. Environment supplies existing rail/resized widths, active slots and wide mode. Its rectangles feed AI apps' `--aad-pane-*` custom properties. The shell's 44px title-row offset is applied by the adapter/CSS; the model does not own window chrome or lifecycle. Default Home intentionally retains its old background/overlay arrangement; explicit tiled ratios have no overlapping active panes.

Proof: `tests/pane-layout.test.mjs` exercises pure geometry/persistence; `tests/qa-pane-layout.cjs` compares actual default pane boxes with pinned pre-change production files, then asserts ratio/side/dock placement on the real shell using synthetic data and refused writes. CI uploads dark/light in-shell screenshots. No owner history, messages or `/v1/runs` are used.
