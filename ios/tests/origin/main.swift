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

// Shell check (WizardProbeTest)
if WizardOrigin.looksLikeWizard("<title>Sign in</title>") { failures += 1; print("FAIL: sign-in page passed") }
if WizardOrigin.looksLikeWizard("<title>Wizard OS</title>") { failures += 1; print("FAIL: title alone passed") }
if !WizardOrigin.looksLikeWizard("<title>Wizard OS</title><script src='core/app.js'></script>") { failures += 1; print("FAIL: shell refused") }

// Probe verdicts (fail closed): HTTP 200 + a text/html Content-Type + the shell markers, all required.
let shell = "<title>Wizard OS</title><script src='core/app.js'></script>"
expect(WizardOrigin.probeVerdict(status: 200, contentType: "text/html; charset=utf-8", body: shell, host: "box"), nil, "shell")
expect(WizardOrigin.probeVerdict(status: 200, contentType: nil, body: shell, host: "box"), "box answered, but it isn't a Wizard.", "no Content-Type")
expect(WizardOrigin.probeVerdict(status: 200, contentType: "text/plain", body: shell, host: "box"), "box answered, but it isn't a Wizard.", "text/plain")
expect(WizardOrigin.probeVerdict(status: 200, contentType: "text/html", body: "<title>Sign in</title>", host: "box"), "box answered, but it isn't a Wizard.", "sign-in page")
expect(WizardOrigin.probeVerdict(status: 302, contentType: "text/html", body: shell, host: "box"), "box answered, but didn't open Wizard (HTTP 302).", "redirect")
if WizardOrigin.probeLimit > 1 << 20 { failures += 1; print("FAIL: probe limit above 1 MiB") }
if !WizardOrigin.needsTailscale("https://box.example.ts.net") || WizardOrigin.needsTailscale("https://box.example") {
    failures += 1; print("FAIL: needsTailscale")
}
expect(WizardOrigin.host("https://box.example:8443"), "box.example:8443", "host label")

print(failures == 0 ? "WIZARD_ORIGIN_CHECKS_PASS" : "WIZARD_ORIGIN_CHECKS_FAIL \(failures)")
exit(failures == 0 ? 0 : 1)
