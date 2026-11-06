# Media viewer: bounded R3 input-oracle repair

No production source changed after dd50859178ca6e0396669914b32a83f8906b2fa6.
R3 heavy_ac07011327fc48c8a1234278a7c47d40 failed only the newly added partial-lift assertion: the passive journal retained two active pointers and no new pointerup after survivor-only touchMove. The 20 focused units (zero skipped) and 10 other browser cases remain attributed to that exact head; they are not rerun by this continuation.

## Exact public Chromium source

The pinned executable SHA256 is 377a9fc07b495c3b8d0ab8ec1fdfd153641759f9756fea34d8dfce4de82f5025. Its embedded version and Playwright browser registry both identify 156.0.8078.4 (Playwright revision 1248).

- [input_handler.cc at 156.0.8078.4](https://github.com/chromium/chromium/blob/156.0.8078.4/content/browser/devtools/protocol/input_handler.cc): lines 1653–1668 select between two implementations.
- Default `CreateWebTouchEvents`, lines 530–544, rejects nonempty **Cancel**, not nonempty End. Lines 582–598 update supplied MOVE IDs without releasing absent IDs, and erase the explicitly supplied **released** ID on End. End with no points releases all (601–613).
- Feature-gated `DispatchSyntheticPointerActionTouch`, lines 1809–1816, rejects nonempty End/Cancel. Its MOVE path releases omitted IDs (1881–1895). This is a different implementation, not a universally valid recipe.
- [content/public/common/content_features.cc](https://github.com/chromium/chromium/blob/156.0.8078.4/content/public/common/content_features.cc), lines 1202–1205: `kSyntheticPointerActions` is disabled by default.
- [Input.pdl](https://github.com/chromium/chromium/blob/156.0.8078.4/third_party/blink/public/devtools_protocol/domains/Input.pdl), lines 209–222: its prose says End must have zero points. That prose does not describe the default implementation's explicit per-ID End handling. Source and observed events decide native acceptance.

## Minimal continuation

Send End with the released finger's ID. Only if Chromium returns the exact alternative-path nonempty-End error, use that implementation's survivor-only MOVE. In either case await actual trusted pointerup and exactly one active pointer before continuing; an ACK is not renderer delivery. Require a real pan delta, all pointers lifted, trusted double-tap reset, gallery swipe/order, cancel/fresh tap, long-press/menu outside, down-dismiss, and fresh measured letterbox dismissal. Do not synthesize DOM events or release capture manually. An input failure remains a retained failure, not a product patch or fabricated pass.

Outside points use the actual menu scrim and measured square-image letterbox; a guessed stage corner on a width-fit image is not necessarily outside ink.

The source inspection establishes a supported per-finger release path. Native execution of this repair is pending parent admission; no new PASS is claimed here. No merge, live activation, physical phone or APK proof is claimed.
