import Foundation

/// Wizard addresses, parsed exactly like the Android app (`android/.../ServerOrigin.java`, `android/CONNECT.md`):
/// fail-closed, HTTPS only, an origin and nothing else. Foundation only, so `ios/tests/origin` can run it on a Mac.
enum WizardOrigin {
    /// A Setup QR code or `wizard://` link: `wizard://connect?origin=<percent-encoded https origin>`, or a plain https
    /// origin (`https://host[:port]`, optionally ending in `/` or `/wizard-os-home/`).
    /// Returns `https://host[:port]` (port 443 dropped, host lower-cased) or nil.
    static func parse(_ text: String) -> String? {
        guard text.utf8.count <= 4096 else { return nil }
        let input = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if input.lowercased().hasPrefix("wizard:") {
            guard printable(input), let c = URLComponents(string: input), c.scheme == "wizard", c.host == "connect",
                  c.percentEncodedUser == nil, c.percentEncodedPassword == nil, c.port == nil,
                  c.percentEncodedPath.isEmpty, c.percentEncodedFragment == nil,
                  let query = c.percentEncodedQuery, query.hasPrefix("origin="), !query.contains("&"),
                  let decoded = String(query.dropFirst("origin=".count)).removingPercentEncoding else { return nil }
            return https(decoded)
        }
        return https(input)
    }

    /// What someone types into the address field: also a bare host (`wizard.example.ts.net`, `host:8443`), which gets
    /// `https://` in front. Never http.
    static func typed(_ text: String) -> String? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let origin = parse(t) { return origin }
        guard !t.isEmpty, !t.contains("://"), !t.lowercased().hasPrefix("wizard:") else { return nil }
        return parse("https://" + t)
    }

    /// Tailscale addresses only answer when Tailscale is on in the phone, so errors say so.
    static func needsTailscale(_ origin: String) -> Bool {
        URLComponents(string: origin)?.host?.lowercased().hasSuffix(".ts.net") ?? false
    }

    static func host(_ origin: String) -> String {
        guard let c = URLComponents(string: origin), let host = c.host else { return origin }
        return c.port.map { "\(host):\($0)" } ?? host
    }

    /// The current Wizard shell: the Wizard OS title plus its core scripts. A login page or any other site doesn't pass.
    static func looksLikeWizard(_ html: String) -> Bool {
        html.contains("Wizard OS") && (html.contains("core/") || html.contains("__wosNativeBack"))
    }

    private static func https(_ input: String) -> String? {
        guard printable(input), input.lowercased().hasPrefix("https://"),
              let c = URLComponents(string: input), c.scheme?.lowercased() == "https",
              c.percentEncodedUser == nil, c.percentEncodedPassword == nil,
              c.percentEncodedQuery == nil, c.percentEncodedFragment == nil,
              let rawHost = c.percentEncodedHost, !rawHost.isEmpty,
              ["", "/", "/wizard-os-home", "/wizard-os-home/"].contains(c.percentEncodedPath) else { return nil }
        // "https://host:" (an empty port) and ports outside 1…65535.
        let authority = input.dropFirst("https://".count).prefix { $0 != "/" }
        if authority.hasSuffix(":") { return nil }
        if let port = c.port, port < 1 || port > 65535 { return nil }
        var host = rawHost.lowercased()
        if host.hasSuffix(".") || host.contains("%") { return nil }
        if host.contains(":") && !host.hasPrefix("[") { host = "[\(host)]" } // IPv6 literal
        let port = (c.port == nil || c.port == 443) ? "" : ":\(c.port!)"
        return "https://\(host)\(port)"
    }

    /// Visible ASCII only: URLComponents accepts things a strict URI parser refuses (spaces, newlines, control bytes).
    private static func printable(_ s: String) -> Bool {
        !s.isEmpty && s.unicodeScalars.allSatisfy { $0.value > 0x20 && $0.value < 0x7f }
    }
}

/// Read-only, bounded check that an address serves the Wizard shell before the app saves it (Android `WizardProbe`).
/// Never follows a redirect and never bypasses TLS. This is not authentication: the Wizard's owner check still applies.
final class WizardProbe: NSObject, URLSessionTaskDelegate {
    private var session: URLSession?

    /// Calls back on the main queue with nil when `origin` is a Wizard, else a message for the owner.
    static func check(_ origin: String, completion: @escaping (String?) -> Void) {
        let probe = WizardProbe()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 12
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: config, delegate: probe, delegateQueue: nil)
        probe.session = session
        guard let url = URL(string: origin + "/wizard-os-home/") else { completion("That isn't a Wizard address."); return }
        var request = URLRequest(url: url)
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        let host = WizardOrigin.host(origin)
        session.dataTask(with: request) { data, response, error in
            let message: String?
            if let error = error as NSError? {
                message = error.code == NSURLErrorCancelled || WizardOrigin.needsTailscale(origin)
                    ? "Couldn't reach \(host). Make sure Tailscale is on and signed in to the same account as your Wizard."
                    : "Couldn't reach \(host). Check the address and your connection."
            } else if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                message = "\(host) answered, but didn't open Wizard (HTTP \(http.statusCode))."
            } else if let type = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type"), !type.lowercased().contains("text/html") {
                message = "\(host) answered, but it isn't a Wizard."
            } else if let data, WizardOrigin.looksLikeWizard(String(decoding: data.prefix(262_144), as: UTF8.self)) {
                message = nil
            } else {
                message = "\(host) answered, but it isn't a Wizard."
            }
            DispatchQueue.main.async { completion(message) }
            probe.session?.finishTasksAndInvalidate(); probe.session = nil
        }.resume()
    }

    /// Never follow a redirect (a login page or another site must not pass as the Wizard).
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
