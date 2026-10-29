# CDP notification disconnect: diagnosis only

Parent: `5a9f93cf26060231622ab4c88bbd5b6274a19cae`.
No Android/web product changes, no removed screenshot, no Send retry, no timeout
increase, no new dependency, no full emulator acceptance requested.

## Established boundary, not an established root cause

The retained first-notification traceback reaches `_recv -> _need(2) -> recv`
and gets empty bytes (`RuntimeError: ws closed`). This is TCP EOF while waiting
for the next frame header. It is not the JSON decoding error the client emits
for the synthetic ping/close frames below; nor is it a socket timeout. The old
trace has no opcode, close status, CDP detach event, socket identity or native
process start identity at that moment. Empty crash.txt does not rule out renderer
or target/session loss. An earlier failure at Debugger.enable and this one at
Page.captureScreenshot do not establish either method as the cause.

The actual notification path is synchronous: connect_page closes its prior Page,
constructs a replacement, observes readiness, takes the native screencap and
activity dump, and requests the compositor screenshot on the replacement Page.
`Rig.sh` is direct argv subprocess execution; `Rig.sx` is adb -s <serial> shell.
The forward maps one host TCP port to webview_devtools_remote_<app pid>; replacing
the mapping does not by itself prove closure of an already-established TCP
connection. There is no second Page owner in this call path. Tests establish
close-before-replace, not the absence of another external DevTools client.
Native screenshot is adb exec-out screencap + dumpsys; it contains no explicit
Page.close or reconnect. Its causal role remains unknown.

## Offline evidence

Run `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tools/test_qa_cdp_transport.py -v`.
The actual Page class is AST-loaded without SDK import-time discovery. Real
loopback TCP peer tests exercise the constructor handshake and frame transport;
only Android commands and HTTP target listing are fixtures.

Eight characterization tests pass on BOTH the unchanged parent and diagnostics:
masked outgoing small/16-bit/64-bit lengths, large plain fragmented replies,
coalesced unsolicited event+response, clean EOF, partial-large-frame EOF,
ping handling, interleaved control frames, close handling, and invalid upgrade
acceptance (some tests cover multiple subcases). The last protocol defects are
asserted AS DEFECTS, not presented as RFC compliance. The diagnostic head adds
three tests for bounded/redacted metadata, close/detach/local-close events, and
the one-notification stop/no-second-Send boundary. Total: 11 tests. Existing
controller and notification lifecycle suites also remain required.

Specifically, the custom client does not validate status/accept, uses a fixed
handshake nonce, parses control frames as JSON, and cannot handle control frames
interleaved with a fragmented message. The handshake loop also has no EOF guard
(source inspection; not a historical reproduction). None is shown to have caused
the retained EOF. Ordinary fragmentation and large-frame lengths work in these
tests. A ping may require a pong to keep a peer alive, but the historical record
contains no evidence of a ping deadline. Do not claim that as the root cause.

The VPS has `websockets`; forum's Python has none of websocket/websockets/wsproto.
No dependency was installed. Once the cause is bounded, prefer an explicitly
pinned maintained transport over expanding this minimal client into an RFC stack.

## Smallest next observation, parent-only admission

`qa_share_transport_diagnostic.py` validates a separate diagnostic seal and the
unchanged notification runner/source/reuse seal. It enables observation only,
executes the first synthetic share and first notification capture, then raises a
sentinel BEFORE second share/Send. Both original native and compositor captures
remain mandatory. An original failure is preserved unchanged. The inner receipt
is always nonpassing; the separate receipt says REVIEW_REQUIRED_DIAGNOSTIC_ONLY,
full_acceptance=false, cause_established=false. This is not normal acceptance.
It retains the existing exact-serial teardown and hash/inventory/APK reuse gates.

Opt-in `WIZARD_QA_CDP_DIAGNOSTIC=1` records at most 96 recent metadata events per
Page: monotonically numbered call method/id, send/result/error class/errno,
frame opcode/FIN/mask/length, EOF buffered/needed, peer close code,
Inspector.detached with a fixed reason enum (unknown text becomes `other`), local
close, socket ports and bounded identity snapshots before connect/after handshake/
on error. The three identity snapshots survive event-ring rollover. Identity includes pid plus
/proc start ticks and only the exact serial/host-port forwarding row. Each adb
identity command has a 3s cap; read timeouts and input policy are unchanged.
Params, expressions, result bodies, close reason and raw errors are excluded.
There is no automatic reconnect, replay or protocol behavior repair. Observer
files are diagnostic evidence, not a replacement for the compositor screenshot.

If it fails: distinguish a peer close frame from bare TCP EOF/reset; correlate
socket IDs with local close/reconnect, compare process start ticks and forward
mapping, inspect retained detach events/logcat/crash and activity evidence.
If it reaches the sentinel: review the real first artifacts and transport log;
do not label it a fix or automatically queue another acceptance. Snapshotting can
perturb timing; absence of a symptom once is not causality. Host memory pressure,
other DevTools clients and renderer lifecycle remain unexcluded without their
own evidence. Do not change product code based on this packet alone.

Admission still requires a fresh duplicate-registry check and free space at least
200 GiB reserve PLUS 3 GiB scoped peak budget. Preserve historic evidence/APKs and
384 passed JVM tests; never rebuild/sign/publish/deploy from this diagnostic.
