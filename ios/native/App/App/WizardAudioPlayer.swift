import Foundation
import AVFoundation
import MediaPlayer
import UIKit
import WebKit

/// The iPhone's own media player for Music and Podcasts (wizard-ux issue 1664; Android: issue 1661).
///
/// Switch `wizard/lock-screen-player` (off by default): the shim below gives the Wizard shell a `window.wizardAudioPort`
/// only while the switch is on (or while this player still has something loaded), the same port the Android app
/// exposes, so `web/core/background-audio.js` drives it unchanged. With the switch off the shell sees no port and Music
/// and Podcasts play inside their own pages, as before.
///
/// With it on: playback keeps going with the screen locked (AVAudioSession `.playback`, `UIBackgroundModes: audio`), the
/// lock screen and Control Center show title, artist/show, artwork, a scrubbable progress bar and play/pause
/// (MPNowPlayingInfoCenter / MPRemoteCommandCenter); Podcasts gets back 15 / forward 30, Music next/previous. Calls and
/// other interruptions pause and resume by iOS's rules, unplugging headphones pauses, and Podcasts' place is saved by
/// the player itself (POST to the episode's progress URL every 15 s while playing, on pause, and at the end).
final class WizardAudioBridge: NSObject, WKScriptMessageHandler {
    static let handlerName = "wizardAudio"

    /// Injected at document start in the main frame. Exposes the port only while the switch is on, or while the native
    /// player still has a session loaded or a request unanswered (so turning the switch off mid-play can still stop it).
    // shim:begin
    static let shim = """
    (function () {
      'use strict';
      var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.wizardAudio;
      if (!h || Object.prototype.hasOwnProperty.call(window, 'wizardAudioPort')) return;
      var SWITCH = 'wizard/lock-screen-player', live = false, inflight = {}, waiting = 0;
      // A request still on its way counts as live: turning the switch off before a load answers can still stop it.
      var port = { onmessage: null, postMessage: function (raw) {
        var id = ''; try { id = String(JSON.parse(raw).id || ''); } catch (_) {}
        if (id && !inflight[id]) { inflight[id] = 1; waiting++; }
        h.postMessage(String(raw));
      } };
      function on() { try { return (document.documentElement.dataset.tweaks || '').split(' ').indexOf(SWITCH) >= 0; } catch (_) { return false; } }
      Object.defineProperty(window, '__wizardAudioReply', { value: function (m) {
        if (!m || typeof m !== 'object') return;
        if (typeof m.live === 'boolean') live = m.live;
        if (m.id && inflight[m.id]) { delete inflight[m.id]; waiting--; }
        if (m.id && typeof port.onmessage === 'function') port.onmessage({ data: JSON.stringify(m) });
      } });
      Object.defineProperty(window, 'wizardAudioPort', { configurable: false, get: function () { return on() || live || waiting > 0 ? port : undefined; } });
    })();
    """
    // shim:end

    /// Run in the shell when the app goes to the background while the native player is not playing. The app declares
    /// `UIBackgroundModes: audio` for this player only, so audio playing inside a web page (any app's own player with
    /// the switch off, or an app other than Music and Podcasts with it on) stops on lock as it always has.
    // pause:begin
    static let pauseInPage = """
    (function () {
      var n = 0;
      function stop(doc) {
        if (!doc) return;
        try { Array.prototype.forEach.call(doc.querySelectorAll('audio,video'), function (m) { if (!m.paused) { m.pause(); n++; } }); } catch (_) {}
        try { Array.prototype.forEach.call(doc.querySelectorAll('iframe'), function (f) { try { stop(f.contentDocument); } catch (_) {} }); } catch (_) {}
      }
      stop(document);
      return n;
    })()
    """
    // pause:end

    private weak var web: WKWebView?
    private var loadingObservation: NSKeyValueObservation?
    private var observers: [NSObjectProtocol] = []
    private var backgroundedPlaying = false

    static func install(on web: WKWebView) -> WizardAudioBridge {
        let bridge = WizardAudioBridge()
        bridge.web = web
        let content = web.configuration.userContentController
        content.removeScriptMessageHandler(forName: handlerName)
        content.add(WeakScriptHandler(bridge), name: handlerName)
        content.addUserScript(WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // A reloaded shell learns whether the player still has a session (so it can still stop it with the switch off).
        bridge.loadingObservation = web.observe(\.isLoading, options: [.new]) { [weak bridge] web, _ in
            if !web.isLoading { bridge?.push(nil) }
        }
        let center = NotificationCenter.default
        bridge.observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak bridge] _ in
            guard let bridge else { return }
            bridge.backgroundedPlaying = WizardAudioPlayer.shared.wantsPlaying
            if !bridge.backgroundedPlaying { bridge.web?.evaluateJavaScript(Self.pauseInPage) }
        })
        // Coming back while it played in the background (the lock screen's player, Control Center, or the app icon):
        // open the app that is playing, like Android's notification tap.
        bridge.observers.append(center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak bridge] _ in
            guard let bridge, bridge.backgroundedPlaying, WizardAudioPlayer.shared.hasQueue else { return }
            bridge.backgroundedPlaying = false
            let path = WizardAudioPolicy.openPath(WizardAudioPlayer.shared.owner)
            bridge.web?.evaluateJavaScript("(window.WizCore && WizCore.deeplink && WizCore.deeplink.route) ? String(WizCore.deeplink.route(location.origin + \(Self.jsString(path)))) : 'no'")
        })
        return bridge
    }

    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

    private var origin: String? {
        guard let current = WizardAddress.current?.absoluteString else { return nil }
        return current.hasSuffix("/") ? String(current.dropLast()) : current
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let web, let origin, message.frameInfo.isMainFrame, message.webView === web,
              WizardAddress.isWizard(host: message.frameInfo.securityOrigin.host, port: message.frameInfo.securityOrigin.port,
                                     scheme: message.frameInfo.securityOrigin.protocol),
              WizardAudioPolicy.shell(web.url?.absoluteString, origin: origin),
              let raw = message.body as? String, raw.utf8.count <= 250_000,
              let data = raw.data(using: .utf8),
              let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        let id = String(describing: request["id"] ?? "").prefix(80)
        let method = request["method"] as? String ?? "", app = request["appId"] as? String ?? ""
        guard WizardAudioPolicy.methods.contains(method), (request["v"] as? NSNumber)?.intValue == 1, WizardAudioPolicy.admitted(app) else {
            answer(String(id), nil, "Unknown audio capability"); return
        }
        if method == "capabilities" {
            answer(String(id), ["v": 1, "backgroundAudio": true, "methods": WizardAudioPolicy.methods.sorted(),
                                "apps": WizardAudioPolicy.apps.sorted(), "skip": true, "rate": true, "platform": "ios"], nil)
            return
        }
        // The stream, artwork and progress requests carry this Wizard's login cookies, read fresh from the web view.
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self else { return }
            let player = WizardAudioPlayer.shared
            player.bind(origin: origin)
            player.cookies = cookies
            do {
                try player.command(app: app, method: method, params: request)
                self.answer(String(id), player.snapshot(app: app, known: (request["knownQueueRevision"] as? NSNumber)?.intValue ?? -1), nil)
            } catch let failure as WizardAudioPlayer.Failure {
                self.answer(String(id), nil, failure.message)
            } catch {
                self.answer(String(id), nil, "Music command failed")
            }
        }
    }

    private func answer(_ id: String, _ result: [String: Any]?, _ error: String?) {
        var reply: [String: Any] = ["id": id, "ok": error == nil]
        if let error { reply["error"] = error } else { reply["result"] = result ?? [:] }
        push(reply)
    }

    /// Sends a reply (or, with nil, only the live flag) to the shell's port.
    private func push(_ reply: [String: Any]?) {
        var message = reply ?? [:]
        message["live"] = WizardAudioPlayer.shared.hasQueue
        guard let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.__wizardAudioReply && window.__wizardAudioReply(\(json))")
    }

    static func jsString(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [s]), let json = String(data: data, encoding: .utf8) else { return "''" }
        return String(json.dropFirst().dropLast())
    }
}

/// WKUserContentController keeps its handlers strongly; this keeps the bridge collectable when the app restarts its view.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(c, didReceive: m) }
}

/// One device player (like Android's BackgroundAudioService): the app that last `load`ed owns it; the other admitted
/// app sees an idle player and its control calls are refused. Main thread only.
final class WizardAudioPlayer: NSObject {
    static let shared = WizardAudioPlayer()
    struct Failure: Error { let message: String }

    private(set) var origin = ""
    var cookies: [HTTPCookie] = []
    private(set) var owner = WizardAudioPolicy.music
    var hasQueue: Bool { !tracks.isEmpty }
    var wantsPlaying: Bool { userWant && !tracks.isEmpty }

    private let player = AVPlayer()
    private var tracks: [[String: Any]] = []
    private var index = -1
    private var station: [String: Any]?
    private let sessionId = UUID().uuidString
    private var userWant = false, interruptedWhilePlaying = false
    private var error = "", playEvent = "", reportedPlay = ""
    private var revision = 0, generation = 0, refillAttempts = 0
    private var refilling = false, advanceAfterRefill = false, reporting = false
    private var refillKey = UUID().uuidString
    private var controls = WizardAudioPolicy.controls(back: nil, forward: nil)
    private var volume: Float = 1
    /// The owner app's playback speed (wizard-ux issue 2061); it carries to the next episode and resets when another app takes over.
    private var playbackRate: Float = 1
    private var artwork: (url: String, art: MPMediaItemArtwork)?
    private var progressTimer: Timer?
    private var itemObservations: [NSKeyValueObservation] = []
    private var statusObservation: NSKeyValueObservation?
    private var reports: [[String: Any]] = []
    private static let reportsKey = "wizardAudio.reports"

    private lazy var http: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.timeoutIntervalForRequest = 20
        return URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }()

    private override init() {
        super.init()
        player.automaticallyWaitsToMinimizeStalling = true
        reports = (UserDefaults.standard.array(forKey: Self.reportsKey) as? [[String: Any]]) ?? []
        statusObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.playingChanged() }
        }
        let center = NotificationCenter.default
        let handlers: [(Notification.Name, (WizardAudioPlayer, Notification) -> Void)] = [
            (.AVPlayerItemDidPlayToEndTime, { $0.itemEnded($1) }), (.AVPlayerItemFailedToPlayToEndTime, { $0.itemFailed($1) }),
            (AVAudioSession.interruptionNotification, { $0.interrupted($1) }), (AVAudioSession.routeChangeNotification, { $0.routeChanged($1) }),
        ]
        for (name, handle) in handlers {
            _ = center.addObserver(forName: name, object: nil, queue: nil) { [weak self] note in if let self { handle(self, note) } }
        }
        remoteCommands()
    }

    // MARK: commands from the shell

    /// Change Wizard: nothing of the previous Wizard (queue, track URLs, unsent feedback) ever reaches the new one.
    func bind(origin new: String) {
        guard new != origin else { return }
        if !origin.isEmpty {
            requestPlaying(false); generation += 1; station = nil; advanceAfterRefill = false
            player.replaceCurrentItem(with: nil); tracks.removeAll(); index = -1; revision += 1; error = ""
            owner = WizardAudioPolicy.music; controls = WizardAudioPolicy.controls(back: nil, forward: nil); applyOwner(); artwork = nil
            playbackRate = 1; player.defaultRate = 1; nowPlaying()
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
        origin = new
        reports.removeAll { $0["origin"] as? String != new }
        UserDefaults.standard.set(reports, forKey: Self.reportsKey)
    }

    func command(app: String, method: String, params p: [String: Any]) throws {
        guard WizardAudioPolicy.admitted(app) else { throw Failure(message: "Unknown audio app") }
        let free: Set<String> = ["load", "state", "attach", "detach"]
        if !["load", "state", "attach"].contains(method), p["sessionId"] as? String != sessionId { throw Failure(message: "Stale audio session") }
        // Only the app that owns the player controls it; any admitted app may load (and so take it over).
        if owner != app, !free.contains(method) { throw Failure(message: "Another app owns the player") }
        switch method {
        case "load": try load(app: app, p)
        case "play":
            if currentItemEnded { player.seek(to: .zero) }
            if player.currentItem == nil, index >= 0 { start(at: index, positionMs: 0) }
            requestPlaying(true); maybeRefill()
        case "pause": advanceAfterRefill = false; requestPlaying(false)
        case "seek": seek(seconds: max(0, number(p["positionMs"]) / 1000))
        case "next": next()
        case "previous": previous()
        case "jump":
            let i = Int(number(p["index"], -1))
            if i >= 0, i < tracks.count { start(at: i, positionMs: 0); requestPlaying(true) }
        case "enqueueNext":
            guard var t = p["track"] as? [String: Any] else { throw Failure(message: "Missing track") }
            t = try checked(t, app: owner)
            let id = t["id"] as? String
            var i = tracks.count - 1
            while i > index { if tracks[i]["id"] as? String == id { tracks.remove(at: i) }; i -= 1 }
            tracks.insert(t, at: index + 1); revision += 1
        case "removeCurrent":
            if index >= 0, index < tracks.count {
                report("skipped"); tracks.remove(at: index); revision += 1
                if index < tracks.count { start(at: index, positionMs: 0); requestPlaying(true) }
                else { index = tracks.count - 1; player.replaceCurrentItem(with: nil); advanceAfterRefill = true; userWant = true; maybeRefill() }
            }
        case "removeUpcoming":
            generation += 1; refillKey = UUID().uuidString; refillAttempts = 0
            let drop = Set((p["ids"] as? [Any] ?? []).map { String(describing: $0) })
            var i = tracks.count - 1
            while i > index { if drop.contains(tracks[i]["id"] as? String ?? "") { tracks.remove(at: i); revision += 1 }; i -= 1 }
            maybeRefill()
        case "volume": volume = Float(max(0, min(1, number(p["value"], 1)))); player.volume = volume
        case "rate": setRate(WizardAudioPolicy.rate((p["value"] as? NSNumber)?.doubleValue))
        case "stop":
            saveProgress(completed: false)
            requestPlaying(false); generation += 1; station = nil; tracks.removeAll(); index = -1; revision += 1
            player.replaceCurrentItem(with: nil); nowPlaying()
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        case "attach", "state", "detach": break
        default: throw Failure(message: "Unknown audio method")
        }
    }

    private func load(app: String, _ p: [String: Any]) throws {
        guard p["sessionId"] as? String == sessionId else { throw Failure(message: "Attach before load") }
        guard let q = p["queue"] as? [[String: Any]], !q.isEmpty, q.count <= 100 else { throw Failure(message: "Queue length") }
        let st = p["station"] as? [String: Any]
        if let st, !WizardAudioPolicy.trusted(WizardAudioPolicy.absolute(st["more"] as? String ?? "", origin: origin), origin: origin, kind: "more", app: app) {
            throw Failure(message: "Untrusted continuation")
        }
        let add = try q.map { try checked($0, app: app) }
        if owner != app { adopt(app) }
        let skip = p["skip"] as? [String: Any]
        controls = WizardAudioPolicy.controls(back: (skip?["back"] as? NSNumber)?.doubleValue, forward: (skip?["forward"] as? NSNumber)?.doubleValue)
        applyOwner()
        if let r = p["rate"] as? NSNumber { playbackRate = WizardAudioPolicy.rate(r.doubleValue); player.defaultRate = playbackRate }
        let lo = max(0, index + 1 - 50), hi = min(index, tracks.count - 1)
        let history = index < 0 || lo > hi ? [] : Array(tracks[lo...hi])
        let at = max(0, min(q.count - 1, Int(number(p["index"])))) + history.count
        saveProgress(completed: false)
        tracks = history + add
        station = st.map { var s = $0; s["more"] = WizardAudioPolicy.absolute(s["more"] as? String ?? "", origin: origin); return s }
        generation += 1; revision += 1; refillAttempts = 0; advanceAfterRefill = false; refillKey = UUID().uuidString
        start(at: at, positionMs: max(0, number(p["positionMs"])))
        requestPlaying(true)
    }

    /// The track the app sent, with its URLs made absolute and checked (stream must pass; art/progress dropped if not).
    private func checked(_ raw: [String: Any], app: String) throws -> [String: Any] {
        var t = raw
        let stream = WizardAudioPolicy.absolute(t["stream"] as? String ?? "", origin: origin)
        guard WizardAudioPolicy.trackId(app, t["id"] as? String),
              WizardAudioPolicy.trusted(stream, origin: origin, kind: "stream", app: app) else { throw Failure(message: "Untrusted track") }
        t["stream"] = stream
        for kind in ["art", "progress"] {
            guard let value = t[kind] as? String, !value.isEmpty else { continue }
            let url = WizardAudioPolicy.absolute(value, origin: origin)
            if WizardAudioPolicy.trusted(url, origin: origin, kind: kind, app: app) { t[kind] = url } else { t.removeValue(forKey: kind) }
        }
        return t
    }

    /// Another admitted app starts playing: the one device player becomes its own (the old app's queue is dropped).
    private func adopt(_ app: String) {
        saveProgress(completed: false); requestPlaying(false)
        generation += 1; station = nil; advanceAfterRefill = false
        player.replaceCurrentItem(with: nil); tracks.removeAll(); index = -1; revision += 1; error = ""
        owner = app; controls = WizardAudioPolicy.controls(back: nil, forward: nil); applyOwner()
        playbackRate = 1; player.defaultRate = 1
    }

    func snapshot(app: String, known: Int) -> [String: Any] {
        if owner != app {
            // Another admitted app owns the player: this app sees an idle player it may load into, never the other queue.
            return ["v": 1, "sessionId": sessionId, "appId": app, "index": -1, "playing": false, "wantPlaying": false,
                    "buffering": false, "positionMs": 0, "durationMs": 0, "volume": volume, "rate": 1, "error": "", "station": NSNull(),
                    "queueRevision": -1, "generation": generation, "reporter": "native", "queue": []]
        }
        var o: [String: Any] = ["v": 1, "sessionId": sessionId, "appId": owner, "index": tracks.isEmpty ? -1 : index,
                                "playing": player.timeControlStatus == .playing, "wantPlaying": userWant,
                                "buffering": player.timeControlStatus == .waitingToPlayAtSpecifiedRate,
                                "positionMs": Int(position * 1000), "durationMs": Int(duration * 1000), "volume": volume, "rate": playbackRate,
                                "error": error, "station": station ?? NSNull(), "queueRevision": revision, "generation": generation,
                                "reporter": "native"]
        if known != revision { o["queue"] = tracks }
        return o
    }

    // MARK: playback

    private var position: Double { let s = player.currentTime().seconds; return s.isFinite ? max(0, s) : 0 }
    private var duration: Double { let d = player.currentItem?.duration.seconds ?? 0; return d.isFinite && d > 0 ? d : 0 }
    private var currentItemEnded: Bool { duration > 0 && position >= duration - 0.25 }

    private func start(at i: Int, positionMs: Double) {
        guard i >= 0, i < tracks.count, let url = URL(string: tracks[i]["stream"] as? String ?? "") else { return }
        itemObservations.removeAll()
        let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: cookies(for: url)])
        let item = AVPlayerItem(asset: asset)
        item.audioTimePitchAlgorithm = .timeDomain
        itemObservations.append(item.observe(\.status, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async { if item.status == .readyToPlay { self?.nowPlaying() } else if item.status == .failed { self?.failed(item) } }
        })
        index = i; error = ""; playEvent = UUID().uuidString
        player.replaceCurrentItem(with: item)
        player.volume = volume
        if positionMs > 0 { item.seek(to: CMTime(seconds: positionMs / 1000, preferredTimescale: 1000), completionHandler: nil) }
        nowPlaying(); loadArtwork(); maybeRefill()
    }

    private func requestPlaying(_ want: Bool) {
        userWant = want && !tracks.isEmpty
        if userWant {
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.playback, mode: WizardAudioPolicy.sessionMode(owner) == "spokenAudio" ? .spokenAudio : .default, options: [])
            try? session.setActive(true)
            if player.currentItem == nil, index >= 0, index < tracks.count { start(at: index, positionMs: 0) }
            player.defaultRate = playbackRate
            player.play()
            if player.rate != playbackRate { player.rate = playbackRate }
        } else {
            player.pause()
        }
        nowPlaying()
    }

    /// A new speed applies at once while playing; paused, it waits for the next play (setting `rate` would start playback).
    private func setRate(_ r: Float) {
        playbackRate = r; player.defaultRate = r
        if userWant, player.timeControlStatus != .paused { player.rate = r }
        nowPlaying()
    }

    private func seek(seconds: Double) {
        let d = duration, t = d > 0 ? min(seconds, d) : seconds
        player.seek(to: CMTime(seconds: max(0, t), preferredTimescale: 1000)) { [weak self] _ in DispatchQueue.main.async { self?.nowPlaying() } }
    }

    private func seekBy(_ delta: Double) { seek(seconds: position + delta) }

    private func next() {
        report("skipped")
        if index + 1 < tracks.count { start(at: index + 1, positionMs: 0); requestPlaying(true) }
        else if station != nil { advanceAfterRefill = true; userWant = true; maybeRefill() }
    }

    /// Like Android's player: past the first 4 s, previous restarts the track.
    private func previous() {
        if WizardAudioPolicy.previousRestarts(position: position, index: index) { seek(seconds: 0) } else { start(at: index - 1, positionMs: 0) }
        requestPlaying(true)
    }

    private func playingChanged() {
        if player.timeControlStatus == .playing {
            reportPlayed(); progressTick()
        } else if player.timeControlStatus == .paused {
            progressTimer?.invalidate(); progressTimer = nil
            saveProgress(completed: false)
        }
        nowPlaying()
    }

    private func itemEnded(_ note: Notification) {
        DispatchQueue.main.async { [self] in
            guard (note.object as? AVPlayerItem) === player.currentItem else { return }
            saveProgress(completed: true)
            if index + 1 < tracks.count { start(at: index + 1, positionMs: 0); requestPlaying(userWant) }
            else if station != nil { advanceAfterRefill = true; maybeRefill() }
            else { requestPlaying(false) }
        }
    }

    private func itemFailed(_ note: Notification) {
        DispatchQueue.main.async { [self] in if let item = note.object as? AVPlayerItem { failed(item) } }
    }

    private func failed(_ item: AVPlayerItem) {
        guard item === player.currentItem else { return }
        error = "This track could not be played. Skipping."
        let event = playEvent
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [self] in
            guard event == playEvent, userWant else { return }
            report("skipped")
            if index + 1 < tracks.count { start(at: index + 1, positionMs: 0); requestPlaying(true) }
            else if station != nil { advanceAfterRefill = true; maybeRefill() }
            else { requestPlaying(false) }
        }
    }

    /// Calls, alarms and other apps: iOS pauses us; when it says we should resume and we were playing, we resume.
    private func interrupted(_ note: Notification) {
        let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
        let options = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt
        DispatchQueue.main.async { [self] in
            let began = type == AVAudioSession.InterruptionType.began.rawValue
            switch WizardAudioPolicy.interruption(type: type, options: options, wasPlaying: began ? userWant : interruptedWhilePlaying) {
            case .pause: interruptedWhilePlaying = true; userWant = false; player.pause(); nowPlaying()
            case .resume: interruptedWhilePlaying = false; requestPlaying(true)
            case .nothing: if !began { interruptedWhilePlaying = false }
            }
        }
    }

    /// Headphones or a Bluetooth speaker went away: pause, like every iPhone media app.
    private func routeChanged(_ note: Notification) {
        guard WizardAudioPolicy.pausesOnRouteChange(note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) else { return }
        DispatchQueue.main.async { [self] in requestPlaying(false) }
    }

    // MARK: lock screen and Control Center

    private func remoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in self?.remote { $0.requestPlaying(true) } ?? .commandFailed }
        c.pauseCommand.addTarget { [weak self] _ in self?.remote { $0.requestPlaying(false) } ?? .commandFailed }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in self?.remote { $0.requestPlaying(!$0.userWant) } ?? .commandFailed }
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            guard let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            return self?.remote { $0.seek(seconds: e.positionTime) } ?? .commandFailed
        }
        c.nextTrackCommand.addTarget { [weak self] _ in self?.remote { $0.next() } ?? .commandFailed }
        c.previousTrackCommand.addTarget { [weak self] _ in self?.remote { $0.previous() } ?? .commandFailed }
        c.skipBackwardCommand.addTarget { [weak self] _ in self?.remote { $0.seekBy(-$0.controls.skipBack) } ?? .commandFailed }
        c.skipForwardCommand.addTarget { [weak self] _ in self?.remote { $0.seekBy($0.controls.skipForward) } ?? .commandFailed }
        applyOwner()
    }

    private func remote(_ action: (WizardAudioPlayer) -> Void) -> MPRemoteCommandHandlerStatus {
        guard !tracks.isEmpty else { return .noActionableNowPlayingItem }
        action(self); return .success
    }

    /// Podcasts (asked for skip sizes): back 15 / forward 30 in place of previous/next. Music: previous/next.
    private func applyOwner() {
        let c = MPRemoteCommandCenter.shared(), k = controls
        c.skipBackwardCommand.isEnabled = k.skipBack > 0
        c.skipForwardCommand.isEnabled = k.skipForward > 0
        if k.skipBack > 0 { c.skipBackwardCommand.preferredIntervals = [NSNumber(value: k.skipBack)] }
        if k.skipForward > 0 { c.skipForwardCommand.preferredIntervals = [NSNumber(value: k.skipForward)] }
        c.nextTrackCommand.isEnabled = k.nextPrevious
        c.previousTrackCommand.isEnabled = k.nextPrevious
        c.changePlaybackPositionCommand.isEnabled = k.scrub
    }

    private func nowPlaying() {
        let center = MPNowPlayingInfoCenter.default()
        guard index >= 0, index < tracks.count else { center.nowPlayingInfo = nil; return }
        let t = tracks[index], text = WizardAudioPolicy.nowPlayingText(app: owner, track: t)
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: text.title,
            MPMediaItemPropertyArtist: text.artist,
            MPMediaItemPropertyAlbumTitle: text.album,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: player.timeControlStatus == .playing ? Double(playbackRate) : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: Double(playbackRate),
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPNowPlayingInfoPropertyPlaybackQueueIndex: index,
            MPNowPlayingInfoPropertyPlaybackQueueCount: tracks.count,
        ]
        if let show = text.podcast { info[MPMediaItemPropertyPodcastTitle] = show }
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        if let artwork, artwork.url == t["art"] as? String { info[MPMediaItemPropertyArtwork] = artwork.art }
        center.nowPlayingInfo = info
    }

    private func loadArtwork() {
        guard index >= 0, index < tracks.count, let art = tracks[index]["art"] as? String, artwork?.url != art,
              WizardAudioPolicy.trusted(art, origin: origin, kind: "art", app: owner), let url = URL(string: art) else { return }
        fetch(url, body: nil) { [weak self] data in
            guard let data, data.count <= 5_000_000, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self else { return }
                self.artwork = (art, MPMediaItemArtwork(boundsSize: image.size) { _ in image })
                self.nowPlaying()
            }
        }
    }

    // MARK: Podcasts progress, Music refill and taste feedback

    private func progressTick() {
        progressTimer?.invalidate(); progressTimer = nil
        guard WizardAudioPolicy.spoken(owner) else { return }
        progressTimer = Timer.scheduledTimer(withTimeInterval: WizardAudioPolicy.progressEvery, repeats: true) { [weak self] _ in self?.saveProgress(completed: false) }
    }

    /// Spoken-word apps get their place saved by the player itself, so it keeps saving while the phone is locked.
    private func saveProgress(completed: Bool) {
        guard index >= 0, index < tracks.count, let raw = tracks[index]["progress"] as? String,
              WizardAudioPolicy.trusted(raw, origin: origin, kind: "progress", app: owner), let url = URL(string: raw),
              let body = WizardAudioPolicy.progressBody(app: owner, position: position, duration: duration, completed: completed) else { return }
        fetch(url, body: body) { _ in }
    }

    private func maybeRefill() {
        guard let station, !refilling, tracks.count - index - 1 <= 5, let more = station["more"] as? String,
              WizardAudioPolicy.trusted(more, origin: origin, kind: "more", app: owner),
              let url = URL(string: more + (more.contains("?") ? "&" : "?") + "n=10&requestId=" + refillKey) else { return }
        refilling = true
        let g = generation
        fetch(url, body: nil) { [weak self] data in
            DispatchQueue.main.async {
                guard let self else { return }
                self.refilling = false
                guard g == self.generation else { self.maybeRefill(); return }
                let list = data.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }?["tracks"] as? [[String: Any]]
                guard let list else { self.error = "Could not reach your music right now. Retrying."; self.retryRefill(g, fresh: false); return }
                var known = Set(self.tracks.compactMap { $0["id"] as? String }), accepted: [[String: Any]] = []
                for raw in list.prefix(20) {
                    guard let id = raw["id"] as? String, !known.contains(id), let t = try? self.checked(raw, app: self.owner) else { continue }
                    known.insert(id); accepted.append(t)
                }
                guard !accepted.isEmpty else { self.error = "No playable next tracks yet. Retrying."; self.retryRefill(g, fresh: true); return }
                let old = self.tracks.count
                self.refillAttempts = 0; self.refillKey = UUID().uuidString; self.tracks += accepted; self.revision += 1; self.error = ""
                if self.advanceAfterRefill, self.userWant { self.advanceAfterRefill = false; self.start(at: old, positionMs: 0); self.requestPlaying(true) }
                let trim = self.index - 50
                if trim > 0 { self.tracks.removeFirst(trim); self.index -= trim; self.revision += 1 }
                self.nowPlaying()
            }
        }
    }

    private func retryRefill(_ g: Int, fresh: Bool) {
        if fresh { refillKey = UUID().uuidString }
        let delay = min(60, 2 * pow(2, Double(min(5, refillAttempts))))
        refillAttempts += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, g == self.generation, self.userWant else { return }
            self.maybeRefill()
        }
    }

    private func reportPlayed() {
        guard player.timeControlStatus == .playing, playEvent != reportedPlay else { return }
        report("played"); reportedPlay = playEvent
    }

    /// Music's taste feedback only, kept until the Wizard has it.
    private func report(_ action: String) {
        guard owner == WizardAudioPolicy.music, index >= 0, index < tracks.count, let id = tracks[index]["id"] as? String else { return }
        reports.append(["eventId": sessionId + ":" + playEvent + ":" + action, "id": id, "action": action, "origin": origin])
        if reports.count > 200 { reports.removeFirst(reports.count - 200) }
        UserDefaults.standard.set(reports, forKey: Self.reportsKey)
        drainReports()
    }

    private func drainReports() {
        guard !reporting, let first = reports.first, !origin.isEmpty, first["origin"] as? String == origin,
              let url = URL(string: origin + "/" + WizardAudioPolicy.music + "/api/feedback"),
              WizardAudioPolicy.trusted(url.absoluteString, origin: origin, kind: "feedback", app: WizardAudioPolicy.music) else { return }
        reporting = true
        fetch(url, body: first.filter { $0.key != "origin" }) { [weak self] data in
            DispatchQueue.main.async {
                guard let self else { return }
                self.reporting = false
                if data != nil {
                    self.reports.removeAll { $0["eventId"] as? String == first["eventId"] as? String }
                    UserDefaults.standard.set(self.reports, forKey: Self.reportsKey)
                    self.drainReports()
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in self?.drainReports() }
                }
            }
        }
    }

    // MARK: HTTP (this Wizard only, no redirects, its own login cookies)

    private func cookies(for url: URL) -> [HTTPCookie] {
        guard let host = url.host?.lowercased() else { return [] }
        let path = url.path.isEmpty ? "/" : url.path
        return cookies.filter { c in
            let domain = c.domain.lowercased()
            let hostOk = domain.hasPrefix(".") ? (host == String(domain.dropFirst()) || host.hasSuffix(domain)) : host == domain
            let pathOk = c.path == "/" || path == c.path || path.hasPrefix(c.path.hasSuffix("/") ? c.path : c.path + "/")
            let fresh = c.expiresDate.map { $0 > Date() } ?? true
            return hostOk && pathOk && fresh
        }
    }

    /// GET (body nil) or JSON POST. Calls back with the body of a 200 answer, else nil.
    private func fetch(_ url: URL, body: [String: Any]?, done: @escaping (Data?) -> Void) {
        var request = URLRequest(url: url)
        request.httpShouldHandleCookies = false
        HTTPCookie.requestHeaderFields(with: cookies(for: url)).forEach { request.setValue($1, forHTTPHeaderField: $0) }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("WizardBackgroundAudio/1", forHTTPHeaderField: "User-Agent")
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        http.dataTask(with: request) { data, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            done(ok && (data?.count ?? 0) <= 5_000_000 ? (data ?? Data()) : nil)
        }.resume()
    }

    private func number(_ value: Any?, _ fallback: Double = 0) -> Double {
        guard let n = (value as? NSNumber)?.doubleValue, n.isFinite else { return fallback }
        return n
    }
}

/// Credentials and bytes stay with this Wizard: a redirect is never followed.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
