import Foundation

/// Which apps get the iPhone's own media player, and which URLs that player may open (wizard-ux issue 1664).
/// The same rules as the Android app (android/.../audio/AudioPolicy.java, wizard-ux issue 1661), Foundation only so
/// `ios/tests/audio/run.sh` checks it on any Mac (or in a Linux swift container) without Xcode.
enum WizardAudioPolicy {
    static let methods: Set<String> = ["capabilities", "attach", "state", "load", "play", "pause", "seek", "next", "previous", "jump",
                                       "enqueueNext", "removeCurrent", "removeUpcoming", "volume", "detach", "stop"]
    static let music = "wizard-music", podcasts = "wizard-podcasts"
    /// Exactly these apps get the phone's media player, the way only Maps gets location. Never widen this from the registry.
    static let apps: Set<String> = [music, podcasts]

    static func admitted(_ appId: String?) -> Bool { appId.map(apps.contains) ?? false }
    /// Podcasts is spoken word: its own audio mode, and -15/+30 buttons instead of next/previous.
    static func spoken(_ appId: String?) -> Bool { appId == podcasts }
    /// Where a return to the app goes while it plays: the app that owns the playback.
    static func openPath(_ appId: String?) -> String { "/wizard-os-home/?open=" + (admitted(appId) ? appId! : music) }

    static func trackId(_ appId: String?, _ id: String?) -> Bool {
        guard let id else { return false }
        if appId == podcasts { return full(id, "ep:[0-9]{1,12}") }
        return appId == music && full(id, "(?:yt|lib):[A-Za-z0-9_-]{1,40}")
    }

    /// A skip size the app asked for, clamped to 5...120 s; 0 means use next/previous.
    static func skipSeconds(_ seconds: Double?) -> Double {
        guard let seconds, !seconds.isNaN, seconds > 0 else { return 0 }
        return (max(5, min(120, seconds))).rounded()
    }

    /// `/path` on this Wizard becomes `https://wizard/path`; anything else is left for `trusted` to refuse.
    static func absolute(_ raw: String, origin: String) -> String {
        raw.hasPrefix("/") && !raw.hasPrefix("//") ? origin + raw : raw
    }

    /// kind: "stream", "art", "progress" (Podcasts); "stream", "art", "more", "feedback" (Music, its original rules).
    static func trusted(_ url: String?, origin: String, kind: String, app: String) -> Bool {
        guard admitted(app), let url, url.count <= 4096, !url.contains("\\"), !url.contains(".."),
              !url.replacingOccurrences(of: "%3a", with: ":", options: .caseInsensitive).contains("%"),
              !url.contains(where: { $0.isNewline || $0 == " " }),
              let u = URLComponents(string: url), let o = URLComponents(string: origin),
              sameOrigin(u, o), u.fragment == nil else { return false }
        let p = u.percentEncodedPath.replacingOccurrences(of: "%3a", with: ":", options: .caseInsensitive)
        if app == podcasts {
            if u.percentEncodedQuery != nil { return false }
            switch kind {
            case "stream": return full(p, "/\(podcasts)/api/episodes/[0-9]{1,12}/audio")
            case "art": return full(p, "/\(podcasts)/api/(?:episodes|shows)/[0-9]{1,12}/art")
            case "progress": return full(p, "/\(podcasts)/api/episodes/[0-9]{1,12}/progress")
            default: return false
            }
        }
        switch kind {
        case "stream", "art": return u.percentEncodedQuery == nil && full(p, "/\(music)/\(kind)/(?:yt|lib):[A-Za-z0-9_-]{1,40}")
        case "more": return full(p, "/\(music)/api/station/[a-f0-9]{16}/more")
        case "feedback": return u.percentEncodedQuery == nil && p == "/\(music)/api/feedback"
        default: return false
        }
    }

    /// The Wizard shell page itself (main frame): the only page that may drive the player.
    static func shell(_ url: String?, origin: String) -> Bool {
        guard let url, let u = URLComponents(string: url), let o = URLComponents(string: origin), sameOrigin(u, o) else { return false }
        return u.percentEncodedPath.hasPrefix("/wizard-os-home/") && !u.percentEncodedPath.contains("..") && !u.percentEncodedPath.contains("%")
    }

    private static func sameOrigin(_ u: URLComponents, _ o: URLComponents) -> Bool {
        guard let us = u.scheme?.lowercased(), us == o.scheme?.lowercased(), us == "https",
              let uh = u.percentEncodedHost?.lowercased(), !uh.isEmpty, uh == o.percentEncodedHost?.lowercased(),
              u.user == nil, u.password == nil else { return false }
        return (u.port ?? 443) == (o.port ?? 443)
    }

    private static func full(_ s: String, _ pattern: String) -> Bool {
        !s.contains(where: \.isNewline) && s.range(of: "^(?:" + pattern + ")$", options: .regularExpression) != nil
    }
}
