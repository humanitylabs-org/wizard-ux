// Address-parsing checks for the iOS app, using the Android app's test cases
// (android/app/src/test/java/ai/wizards/os/ServerOriginTest.java). Runs on any Mac with the Command Line Tools:
//   ios/tests/origin/run.sh
import Foundation

var failures = 0
func expect(_ actual: String?, _ expected: String?, _ input: String, line: Int = #line) {
    if actual != expected {
        failures += 1
        print("FAIL line \(line): \(input.debugDescription) → \(actual.debugDescription), expected \(expected.debugDescription)")
    }
}

// Accepted, normalised (ServerOriginTest)
for value in ["https://Box.example/", " https://box.example:443 ", "https://box.example/wizard-os-home/"] {
    expect(WizardOrigin.parse(value), "https://box.example", value)
}
expect(WizardOrigin.parse("https://box.example:8443/"), "https://box.example:8443", "https://box.example:8443/")
expect(WizardOrigin.parse("https://[::1]:8443"), "https://[::1]:8443", "https://[::1]:8443")
expect(WizardOrigin.parse("https://box.example/wizard-os-home"), "https://box.example", "no trailing slash")
expect(WizardOrigin.parse("wizard://connect?origin=https%3A%2F%2Fbox.example.ts.net"), "https://box.example.ts.net", "QR")
expect(WizardOrigin.parse("wizard://connect?origin=https%3A%2F%2Fbox.example%3A443%2F"), "https://box.example", "QR :443/")

// Refused (ServerOriginTest)
for value in ["", "box.example", "http://box.example", "https://user:password@box.example", "https://box.example/other",
              "https://box.example?x=1", "https://box.example/#secret", "https://box.example:", "https://box.example:0",
              "https://box.example:65536", "https://box.example./", "https://box.example/%2f", "https://***@evil.test",
              "https://box.example\n.evil.test", "wizard://evil?origin=https%3A%2F%2Fbox.example",
              "wizard://connect?origin=https%3A%2F%2Fbox.example&origin=https%3A%2F%2Fevil.test",
              "wizard://connect?origin=https%253A%252F%252Fbox.example", "wizard://connect?origin=http%3A%2F%2Fbox.example",
              "wizard://connect?origin=%zz"] {
    expect(WizardOrigin.parse(value), nil, value)
}
// Refused (iOS extras)
for value in ["https://box.example/wizard-os-home/x", "wizard://connect/path?origin=https%3A%2F%2Fbox.example",
              "wizard://connect?origin=https%3A%2F%2Fbox.example#x", "wizard://user@connect?origin=https%3A%2F%2Fbox.example",
              "javascript:alert(1)", "https://box.exa mple", String(repeating: "a", count: 5000)] {
    expect(WizardOrigin.parse(value), nil, value)
}

// Typed into the address field: a bare host is fine, http never is
expect(WizardOrigin.typed("wizard.example.ts.net"), "https://wizard.example.ts.net", "bare host")
expect(WizardOrigin.typed(" Wizard.Example.ts.net:8443 "), "https://wizard.example.ts.net:8443", "bare host:port")
expect(WizardOrigin.typed("https://wizard.example.ts.net/"), "https://wizard.example.ts.net", "full")
expect(WizardOrigin.typed("wizard://connect?origin=https%3A%2F%2Fbox.example"), "https://box.example", "pasted QR text")
for value in ["", "http://box.example", "ftp://box.example", "box.example/other", "wizard://evil", "box example"] {
    expect(WizardOrigin.typed(value), nil, value)
}

// Response headers (fail-closed: the shell is always 200 text/html)
if WizardProbe.headerProblem(status: 200, contentType: nil, host: "h") == nil { failures += 1; print("FAIL: missing Content-Type passed") }
if WizardProbe.headerProblem(status: 200, contentType: "application/json", host: "h") == nil { failures += 1; print("FAIL: JSON passed") }
if WizardProbe.headerProblem(status: 302, contentType: "text/html", host: "h") == nil { failures += 1; print("FAIL: redirect status passed") }
if WizardProbe.headerProblem(status: 200, contentType: "text/html; charset=utf-8", host: "h") != nil { failures += 1; print("FAIL: shell headers refused") }
if WizardProbe.headerProblem(status: 200, contentType: "application/x-text/html-data", host: "h") == nil { failures += 1; print("FAIL: text/html substring passed") }
if WizardProbe.headerProblem(status: 200, contentType: "TEXT/HTML ; charset=utf-8", host: "h") != nil { failures += 1; print("FAIL: TEXT/HTML refused") }
// Only wizard://connect is consumed by the app; other wizard:// routes (Store install links) pass through
if !WizardOrigin.isConnectLink(URL(string: "wizard://connect?origin=https%3A%2F%2Fbox.example")!) { failures += 1; print("FAIL: connect link not ours") }
if !WizardOrigin.isConnectLink(URL(string: "WIZARD://Connect?origin=x")!) { failures += 1; print("FAIL: connect link case") }
if WizardOrigin.isConnectLink(URL(string: "wizard://install?repo=github.com%2Fa%2Fb&commit=abc")!) { failures += 1; print("FAIL: install link swallowed") }
if WizardOrigin.isConnectLink(URL(string: "https://connect/")!) { failures += 1; print("FAIL: https consumed") }
// Shell check (WizardProbeTest)
if WizardOrigin.looksLikeWizard("<title>Sign in</title>") { failures += 1; print("FAIL: sign-in page passed") }
if WizardOrigin.looksLikeWizard("<title>Wizard OS</title>") { failures += 1; print("FAIL: title alone passed") }
if !WizardOrigin.looksLikeWizard("<title>Wizard OS</title><script src='core/app.js'></script>") { failures += 1; print("FAIL: shell refused") }
if !WizardOrigin.needsTailscale("https://box.example.ts.net") || WizardOrigin.needsTailscale("https://box.example") {
    failures += 1; print("FAIL: needsTailscale")
}
expect(WizardOrigin.host("https://box.example:8443"), "box.example:8443", "host label")

// Failures: a name that doesn't exist (not on the Wizard's network) vs nothing answering (Wizard off or asleep)
let ts = "https://wizard.tail1234.ts.net"
for code in [NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed] {
    let m = WizardProbe.failure(code: code, origin: ts)
    if !WizardProbe.notFound(m) || !WizardProbe.noAnswer(m) { failures += 1; print("FAIL: not-found \(code): \(m)") }
}
for code in [NSURLErrorTimedOut, NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost, NSURLErrorCancelled] {
    let m = WizardProbe.failure(code: code, origin: ts)
    if WizardProbe.notFound(m) || !WizardProbe.noAnswer(m) { failures += 1; print("FAIL: no-answer \(code): \(m)") }
}
if WizardProbe.noAnswer("box answered, but it isn't a Wizard.") { failures += 1; print("FAIL: a non-Wizard counted as no answer") }

// Tailscale detection: a utun with a 100.64.0.0/10 address (TailscaleNet)
func v4(_ a: UInt32, _ b: UInt32, _ c: UInt32, _ d: UInt32) -> UInt32 { a << 24 | b << 16 | c << 8 | d }
if !TailscaleNet.isTailscale(interface: "utun4", ipv4: v4(100, 101, 2, 3)) { failures += 1; print("FAIL: tailscale utun refused") }
if !TailscaleNet.isTailscale(interface: "utun0", ipv4: v4(100, 64, 0, 1)) || !TailscaleNet.isTailscale(interface: "utun0", ipv4: v4(100, 127, 255, 254)) { failures += 1; print("FAIL: CGNAT edges") }
if TailscaleNet.isTailscale(interface: "utun4", ipv4: v4(100, 128, 0, 1)) || TailscaleNet.isTailscale(interface: "utun4", ipv4: v4(100, 63, 255, 255)) { failures += 1; print("FAIL: outside 100.64/10 passed") }
if TailscaleNet.isTailscale(interface: "en0", ipv4: v4(100, 101, 2, 3)) { failures += 1; print("FAIL: Wi-Fi CGNAT counted as Tailscale") }
if TailscaleNet.isTailscale(interface: "utun2", ipv4: v4(10, 8, 0, 2)) { failures += 1; print("FAIL: another VPN counted as Tailscale") }
print("tailscale on this Mac: \(TailscaleNet.isOn())")

print(failures == 0 ? "WIZARD_ORIGIN_CHECKS_PASS" : "WIZARD_ORIGIN_CHECKS_FAIL \(failures)")
exit(failures == 0 ? 0 : 1)
