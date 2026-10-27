import UIKit
import WebKit
import AVFoundation
import Capacitor

/// The Wizard this app talks to. An iPhone can't run Wizard OS, so the app is a client of a Wizard running elsewhere
/// (like the Android app): it opens that Wizard's `/wizard-os-home/` and Wizard UX picks its phone shell from the
/// iPhone user agent.
enum WizardAddress {
    static let key = "wizardOrigin"
    static let shellPath = "wizard-os-home/"

    /// Built in at compile time (`WIZARD_ORIGIN` build setting → Info.plist `WizardOrigin`). May be empty.
    static var bundled: String {
        (Bundle.main.object(forInfoDictionaryKey: "WizardOrigin") as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The address saved in the app (Connect / Change Wizard), else the built-in one.
    static var current: URL? { normalized(UserDefaults.standard.string(forKey: key) ?? bundled) }

    static var home: URL? { current.flatMap { URL(string: shellPath, relativeTo: $0)?.absoluteURL } }

    /// Saved or built-in value → `https://host[:port]/`. Same rules as Android (WizardOrigin); older saves had a slash.
    static func normalized(_ raw: String) -> URL? {
        WizardOrigin.typed(raw).flatMap { URL(string: $0 + "/") }
    }

    /// Only an address that passed the shell check is saved (WizardProbe; Android CONNECT.md).
    static func save(origin: String) {
        UserDefaults.standard.set(origin + "/", forKey: key)
    }

    // A Setup QR code or `wizard://connect` link waiting on the connect screen, and whether that screen should show
    // instead of the Wizard on the next start (Change Wizard, a link while a Wizard is set).
    static var pendingPair: String?
    static var pendingError: String?
    static var showConnect = false

    /// `wizard://connect?origin=…` from the Camera app, Safari or another app. Returns true when it was ours; other
    /// `wizard://` routes (Store install links) return false so Capacitor delivers them to the Wizard's pages.
    @discardableResult
    static func receive(_ url: URL) -> Bool {
        guard WizardOrigin.isConnectLink(url) else { return false }
        if let origin = WizardOrigin.parse(url.absoluteString) { pendingPair = origin; pendingError = nil }
        else { pendingPair = nil; pendingError = "That link isn't a Wizard address." }
        showConnect = true
        return true
    }

    /// True for https pages of this Wizard (same host and port).
    static func isWizard(host: String?, port: Int?, scheme: String?) -> Bool {
        guard let wizard = current, let host, scheme?.lowercased() == "https" else { return false }
        let p = (port == nil || port == 0) ? 443 : port!
        let wp = wizard.port ?? 443
        return host.lowercased() == wizard.host?.lowercased() && p == wp
    }
}

/// Capacitor's bridge view, pointed at the Wizard instead of the bundled `www/`.
///
/// - With an address, the web view opens `https://<wizard>/wizard-os-home/`. Pages of that host are the app; links to
///   other sites open in Safari (Capacitor's navigation rules). Capacitor's plugins (push, share, camera, haptics…)
///   are available to the Wizard's pages as `window.Capacitor.Plugins.*`.
/// - Without one, or when the Wizard can't be reached (`server.errorPath`), the bundled `www/index.html` shows the
///   connect screen, which uses the `WizardShell` plugin below.
///
/// Deliberately no `wizardNative` message handler: Wizard UX treats that name as Wizard for Mac (desktop shell).
final class WizardViewController: CAPBridgeViewController {
    private var mediaGate: MediaGate?
    /// True when this start shows the bundled connect screen (no Wizard yet, Change Wizard, or a pairing link).
    private(set) var connectMode = false
    private var foregroundObserver: NSObjectProtocol?

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        // Mirrors the Android app's `WizardOS-Android/<version>` so Wizard UX can tell the native app from Safari.
        descriptor.appendedUserAgentString = "WizardOS-iOS/\(version)"
        connectMode = WizardAddress.showConnect || WizardAddress.home == nil
        WizardAddress.showConnect = false
        if !connectMode, let home = WizardAddress.home, let host = WizardAddress.current?.host {
            descriptor.serverURL = home.absoluteString
            // Every page of this Wizard (not only /wizard-os-home/) stays in the app, e.g. hosted apps and deep links.
            descriptor.allowedNavigationHostnames = [host]
        }
        return descriptor
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WizardShellPlugin())
        guard let web = webView else { return }

        web.allowsBackForwardNavigationGestures = false // Back belongs to Wizard UX
        // Left-edge swipe = one in-app Back step, what Android's Back does.
        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edgeBack(_:)))
        edge.edges = .left
        web.addGestureRecognizer(edge)

        // Capacitor grants microphone/camera to every origin; only this Wizard's pages (and the bundled screen) get it.
        if let inner = web.uiDelegate {
            let gate = MediaGate(inner: inner)
            mediaGate = gate
            web.uiDelegate = gate
        }

        injectPluginProxies(into: web)

        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.webView?.evaluateJavaScript("window.dispatchEvent(new Event('wos-native-resume'))")
        }
    }

    /// Capacitor's injected bridge only has the low-level `Capacitor.nativePromise`; `Capacitor.registerPlugin` and the
    /// `Capacitor.Plugins.*` proxies come from @capacitor/core, which a Capacitor app normally bundles into its own JS.
    /// The Wizard's pages are remote and don't, so inject core (`www/capacitor-core.js`, copied from node_modules by the
    /// `capacitor:copy:before` hook) into every main-frame page after the bridge, and register a proxy for each native
    /// plugin. The Wizard's pages can then call e.g. `Capacitor.Plugins.Share.share({...})`.
    private func injectPluginProxies(into web: WKWebView) {
        guard let path = Bundle.main.path(forResource: "capacitor-core", ofType: "js", inDirectory: "public"),
              let core = try? String(contentsOfFile: path, encoding: .utf8) else {
            CAPLog.print("⚡️  Wizard: public/capacitor-core.js missing; Capacitor.Plugins will be empty (run npx cap sync ios)")
            return
        }
        let register = """
        ;(function () {
          var C = window.Capacitor;
          if (!C || typeof C.registerPlugin !== 'function') return;
          (C.PluginHeaders || []).forEach(function (h) { if (!C.Plugins[h.name]) C.registerPlugin(h.name); });
        })();
        """
        web.configuration.userContentController.addUserScript(
            WKUserScript(source: core + register, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    deinit {
        if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    @objc private func edgeBack(_ gesture: UIScreenEdgePanGestureRecognizer) {
        guard gesture.state == .ended, let web = webView else { return }
        // Same contract as the Android app: the shell steps back; off the shell, step back in the web view.
        web.evaluateJavaScript("(window.__wosNativeBack ? String(window.__wosNativeBack()) : 'nojs')") { result, _ in
            let r = (result as? String) ?? ""
            if !r.isEmpty && r != "nojs" && r != "null" && r != "undefined" { return }
            if web.canGoBack { web.goBack() }
        }
    }

    /// Start over with the current address (after Connect / Try Again on the bundled screen).
    static func restart(from controller: UIViewController?) {
        restart(in: controller?.view.window)
    }

    static func restart(in window: UIWindow?) {
        window?.rootViewController = WizardViewController()
    }
}

/// Wraps Capacitor's WKUIDelegate: forwards everything, except that microphone/camera capture is granted only to this
/// Wizard's https pages and the app's own bundled pages. iOS still asks the user once (Info.plist usage strings).
final class MediaGate: NSObject, WKUIDelegate {
    private weak var inner: WKUIDelegate?

    init(inner: WKUIDelegate) { self.inner = inner }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (inner?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let inner, inner.responds(to: aSelector) { return inner }
        return super.forwardingTarget(for: aSelector)
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let bundled = origin.protocol == "capacitor" && origin.host == "localhost"
        let wizard = WizardAddress.isWizard(host: origin.host, port: origin.port, scheme: origin.protocol)
        decisionHandler(bundled || wizard ? .grant : .deny)
    }
}

/// `WizardShell` for the bundled connect screen (`www/index.html`): read, scan, check, change and retry the Wizard address.
/// `changeWizard` is also open to the Wizard's own pages (e.g. a Settings button), through `Capacitor.Plugins.WizardShell`.
@objc(WizardShellPlugin)
public class WizardShellPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WizardShellPlugin"
    public let jsName = "WizardShell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "parse", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "changeWizard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelChange", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tailscale", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "check", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openTailscale", returnType: CAPPluginReturnPromise),
    ]

    private var connectMode: Bool { (bridge?.viewController as? WizardViewController)?.connectMode ?? false }

    @objc func info(_ call: CAPPluginCall) {
        let pending = WizardAddress.pendingPair
        call.resolve([
            "address": WizardAddress.current.map { WizardOrigin.host($0.absoluteString) } ?? "",
            "home": WizardAddress.home?.absoluteString ?? "",
            // The bundled screen opened on purpose (Change Wizard or a pairing link), not because the Wizard failed.
            "changing": connectMode && WizardAddress.current != nil,
            "pending": pending ?? "",
            "pendingHost": pending.map(WizardOrigin.host) ?? "",
            "pendingError": WizardAddress.pendingError ?? "",
            "camera": AVCaptureDevice.authorizationStatus(for: .video) == .denied ? "denied" : "ok",
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
        ])
        WizardAddress.pendingError = nil
    }

    /// Opens the camera and resolves `{ text }` with the first QR code it sees. Rejects with code `cancelled`,
    /// `denied` (camera access off for Wizard) or `unavailable` (no camera, e.g. the Simulator).
    @objc func scan(_ call: CAPPluginCall) {
        let present = { [weak self] in
            DispatchQueue.main.async {
                guard let host = self?.bridge?.viewController else { call.reject("No screen to scan from.", "unavailable"); return }
                let scanner = QRScannerViewController()
                scanner.modalPresentationStyle = .fullScreen
                scanner.onFinish = { outcome in
                    switch outcome {
                    case .text(let text): call.resolve(["text": text])
                    case .cancelled: call.reject("Scanning cancelled.", "cancelled")
                    case .unavailable: call.reject("This iPhone's camera isn't available. Paste the address instead.", "unavailable")
                    }
                }
                host.present(scanner, animated: true)
            }
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: present()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                if granted { present() } else { call.reject("Camera access is off for Wizard.", "denied") }
            }
        default: call.reject("Camera access is off for Wizard.", "denied")
        }
    }

    /// `{ text, typed }` → `{ origin, host }`. Scanned and linked text is strict (`WizardOrigin.parse`); typed text may
    /// be a bare host.
    @objc func parse(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        let origin = call.getBool("typed") == true ? WizardOrigin.typed(text) : WizardOrigin.parse(text)
        guard let origin else {
            call.reject(call.getBool("typed") == true ? "That isn't an https Wizard address." : "This QR code isn't a Wizard address.", "invalid")
            return
        }
        call.resolve(["origin": origin, "host": WizardOrigin.host(origin)])
    }

    /// `{ address }` (typed or scanned): check that it opens a Wizard, then save it and open it. Rejects with a message
    /// for the owner; the saved Wizard is untouched on any failure.
    @objc func connect(_ call: CAPPluginCall) {
        guard let raw = call.getString("address"), let origin = WizardOrigin.typed(raw) else {
            call.reject("That isn't an https Wizard address.", "invalid")
            return
        }
        WizardProbe.check(origin) { [weak self] problem in
            if let problem { call.reject(problem, WizardProbe.noAnswer(problem) ? "offline" : "unreachable"); return }
            WizardAddress.save(origin: origin)
            WizardAddress.pendingPair = nil
            call.resolve(["origin": origin])
            WizardViewController.restart(from: self?.bridge?.viewController)
        }
    }

    @objc func retry(_ call: CAPPluginCall) {
        call.resolve()
        DispatchQueue.main.async { [weak self] in WizardViewController.restart(from: self?.bridge?.viewController) }
    }

    /// Show the connect screen to pick another Wizard. The current one stays saved until a new one passes the check.
    @objc func changeWizard(_ call: CAPPluginCall) {
        call.resolve()
        DispatchQueue.main.async { [weak self] in
            WizardAddress.showConnect = true
            WizardViewController.restart(from: self?.bridge?.viewController)
        }
    }

    /// Leave Change Wizard (or a pairing link) and go back to the current Wizard.
    @objc func cancelChange(_ call: CAPPluginCall) {
        WizardAddress.pendingPair = nil
        call.resolve()
        DispatchQueue.main.async { [weak self] in WizardViewController.restart(from: self?.bridge?.viewController) }
    }

    /// `{ on }`: whether Tailscale's VPN is running on this iPhone (TailscaleNet). The guide's first line only.
    @objc func tailscale(_ call: CAPPluginCall) {
        call.resolve(["on": TailscaleNet.isOn()])
    }

    /// `{ address }` → `{ ok, problem }`: the same check as `connect`, without saving or opening anything. The guide asks
    /// this every few seconds and on return to the app, then connects once the Wizard answers.
    @objc func check(_ call: CAPPluginCall) {
        guard let raw = call.getString("address"), let origin = WizardOrigin.typed(raw) else {
            call.reject("That isn't an https Wizard address.", "invalid")
            return
        }
        WizardProbe.check(origin) { problem in
            call.resolve(["ok": problem == nil, "offline": problem.map(WizardProbe.noAnswer) ?? false, "problem": problem ?? ""])
        }
    }

    /// Tailscale's App Store page: Get, or Open when it is already installed (iOS has no supported way to open
    /// another app directly).
    @objc func openTailscale(_ call: CAPPluginCall) {
        call.resolve()
        DispatchQueue.main.async {
            if let url = URL(string: "https://apps.apple.com/app/tailscale/id1470499037") { UIApplication.shared.open(url) }
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        call.resolve()
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        }
    }
}
