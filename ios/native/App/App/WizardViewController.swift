import UIKit
import WebKit
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

    /// The address saved in the app (Change Address), else the built-in one.
    static var current: URL? { normalized(UserDefaults.standard.string(forKey: key) ?? bundled) }

    static var home: URL? { current.flatMap { URL(string: shellPath, relativeTo: $0)?.absoluteURL } }

    /// "wizard.example.ts.net" or "https://wizard.example.ts.net/anything" → "https://wizard.example.ts.net/". https only.
    static func normalized(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        if !s.lowercased().hasPrefix("https://") && !s.lowercased().hasPrefix("http://") { s = "https://" + s }
        guard var c = URLComponents(string: s), c.scheme?.lowercased() == "https", let host = c.host, !host.isEmpty else { return nil }
        c.scheme = "https"; c.path = "/"; c.query = nil; c.fragment = nil; c.user = nil; c.password = nil
        return c.url
    }

    @discardableResult
    static func save(_ raw: String) -> URL? {
        guard let url = normalized(raw) else { return nil }
        UserDefaults.standard.set(url.absoluteString, forKey: key)
        return url
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
    private var foregroundObserver: NSObjectProtocol?

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        // Mirrors the Android app's `WizardOS-Android/<version>` so Wizard UX can tell the native app from Safari.
        descriptor.appendedUserAgentString = "WizardOS-iOS/\(version)"
        if let home = WizardAddress.home, let host = WizardAddress.current?.host {
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

        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.webView?.evaluateJavaScript("window.dispatchEvent(new Event('wos-native-resume'))")
        }
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
        guard let window = controller?.view.window else { return }
        window.rootViewController = WizardViewController()
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

/// `WizardShell` for the bundled connect screen (`www/index.html`): read, change and retry the Wizard address.
@objc(WizardShellPlugin)
public class WizardShellPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WizardShellPlugin"
    public let jsName = "WizardShell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retry", returnType: CAPPluginReturnPromise),
    ]

    @objc func info(_ call: CAPPluginCall) {
        call.resolve([
            "address": WizardAddress.current?.host ?? "",
            "home": WizardAddress.home?.absoluteString ?? "",
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
        ])
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard let raw = call.getString("address"), WizardAddress.save(raw) != nil else {
            call.reject("That isn't an https address.")
            return
        }
        call.resolve()
        DispatchQueue.main.async { [weak self] in WizardViewController.restart(from: self?.bridge?.viewController) }
    }

    @objc func retry(_ call: CAPPluginCall) {
        call.resolve()
        DispatchQueue.main.async { [weak self] in WizardViewController.restart(from: self?.bridge?.viewController) }
    }
}
