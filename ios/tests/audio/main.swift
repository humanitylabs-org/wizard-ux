// Media-player rules for the iPhone app (wizard-ux issue 1664), using the Android app's test cases
// (android/app/src/test/java/ai/wizards/os/audio/AudioPolicyTest.java). Runs on any Mac with the Command Line Tools,
// or anywhere with a Swift toolchain (Foundation only):
//   ios/tests/audio/run.sh
import Foundation

var failures = 0
func check(_ ok: Bool, _ what: String, line: Int = #line) {
    if !ok { failures += 1; print("FAIL line \(line): \(what)") }
}

let origin = "https://box.example.ts.net"
let music = "wizard-music", pc = "wizard-podcasts"
func trusted(_ url: String, _ kind: String, _ app: String = music) -> Bool { WizardAudioPolicy.trusted(url, origin: origin, kind: kind, app: app) }

// acceptsOnlyBoundAppMedia
check(trusted(origin + "/wizard-music/stream/yt:abcdefghijk", "stream"), "music stream")
check(trusted(origin + "/wizard-music/art/lib:abcdef", "art"), "music art")
check(trusted(origin + "/wizard-music/api/station/1234567890abcdef/more?n=10&requestId=x", "more"), "music more")
check(trusted(origin + "/wizard-music/api/feedback", "feedback"), "music feedback")

// acceptsCanonicalHubEncodedSeparatorsOnly
check(trusted(origin + "/wizard-music/stream/yt%3Aabcdefghijk", "stream"), "%3A")
check(trusted(origin + "/wizard-music/art/lib%3aabcdef", "art"), "%3a")
for u in ["/wizard-music/stream/%79t%3Aabc", "/wizard-music/stream/yt%253Aabc", "/wizard-music/stream/yt%3Aabc%2fdef"] {
    check(!trusted(origin + u, "stream"), "refused " + u)
}

// rejectsEscapesAndCredentialRedirects
for u in ["https://evil.test/wizard-music/stream/yt:abc", origin + "/wizard-music/stream/../art/yt:abc", origin + "/wizard-music/stream/%79t:abc",
          origin + "/wizard-music/stream/yt:abc?redirect=x", origin + "/other/stream/yt:abc", origin + "/wizard-music/stream/yt:abc#x",
          "https://u@box.example.ts.net/wizard-music/stream/yt:abc", "http://box.example.ts.net/wizard-music/stream/yt:abc",
          "https://box.example.ts.net:8443/wizard-music/stream/yt:abc", origin + "/wizard-music/stream/yt:abc\n"] {
    check(!trusted(u, "stream"), "refused " + u.debugDescription)
}

// confinesBridgeToShellMainFrame
check(WizardAudioPolicy.shell(origin + "/wizard-os-home/?open=wizard-music", origin: origin), "shell page")
check(!WizardAudioPolicy.shell(origin + "/wizard-music/", origin: origin), "app page is not the shell")
check(!WizardAudioPolicy.shell("https://evil.test/wizard-os-home/", origin: origin), "other host")

// admitsExactlyMusicAndPodcasts
check(WizardAudioPolicy.admitted(music) && WizardAudioPolicy.admitted(pc), "music and podcasts admitted")
for id in [nil, "", "wizard-notes", "maps", "Wizard-Podcasts", "wizard-podcasts/"] as [String?] {
    check(!WizardAudioPolicy.admitted(id), "not admitted: \(id.debugDescription)")
}
check(!trusted(origin + "/wizard-notes/api/episodes/1/audio", "stream", "wizard-notes"), "notes media refused")
check(WizardAudioPolicy.apps == [music, pc], "exactly two apps")

// podcastsMediaIsConfinedToItsEpisodes
check(trusted(origin + "/wizard-podcasts/api/episodes/11113/audio", "stream", pc), "episode audio")
check(trusted(origin + "/wizard-podcasts/api/episodes/11113/art", "art", pc), "episode art")
check(trusted(origin + "/wizard-podcasts/api/shows/7/art", "art", pc), "show art")
check(trusted(origin + "/wizard-podcasts/api/episodes/11113/progress", "progress", pc), "episode progress")
for u in [origin + "/wizard-podcasts/api/episodes/1/audio?u=https://evil.test", origin + "/wizard-podcasts/api/episodes/x/audio",
          origin + "/wizard-podcasts/api/episodes/1/../2/audio", "https://evil.test/wizard-podcasts/api/episodes/1/audio",
          origin + "/wizard-music/stream/yt:abcdefghijk", origin + "/wizard-podcasts/api/episodes/1/download",
          origin + "/wizard-podcasts/api/episodes/1/audio#x"] {
    check(!trusted(u, "stream", pc), "podcasts refused " + u)
}
check(!trusted(origin + "/wizard-music/api/station/1234567890abcdef/more", "more", pc), "podcasts never gets music's continuation")
check(!trusted(origin + "/wizard-music/api/feedback", "feedback", pc), "podcasts never gets music's feedback")
check(!trusted(origin + "/wizard-podcasts/api/episodes/1/audio", "stream", music), "music never gets podcasts' media")
check(!trusted(origin + "/wizard-podcasts/api/episodes/1/progress", "progress", music), "music never gets podcasts' progress")

// trackIdsTapAndSkipFollowTheOwner
check(WizardAudioPolicy.trackId(pc, "ep:11113"), "ep id")
check(!WizardAudioPolicy.trackId(pc, "yt:abcdefghijk"), "music id in podcasts")
check(WizardAudioPolicy.trackId(music, "yt:abcdefghijk"), "yt id")
check(!WizardAudioPolicy.trackId(music, "ep:1"), "ep id in music")
check(!WizardAudioPolicy.trackId("wizard-notes", "ep:1"), "other app")
check(!WizardAudioPolicy.trackId(pc, "ep:1\n"), "newline")
check(WizardAudioPolicy.openPath(pc) == "/wizard-os-home/?open=wizard-podcasts", "open podcasts")
check(WizardAudioPolicy.openPath(music) == "/wizard-os-home/?open=wizard-music", "open music")
check(WizardAudioPolicy.openPath("evil&open=x") == "/wizard-os-home/?open=wizard-music", "open never injected")
check(WizardAudioPolicy.spoken(pc) && !WizardAudioPolicy.spoken(music), "spoken")
check(WizardAudioPolicy.skipSeconds(15) == 15 && WizardAudioPolicy.skipSeconds(30) == 30, "skip 15/30")
check(WizardAudioPolicy.skipSeconds(1) == 5 && WizardAudioPolicy.skipSeconds(9999) == 120, "skip clamp")
check(WizardAudioPolicy.skipSeconds(0) == 0 && WizardAudioPolicy.skipSeconds(.nan) == 0 && WizardAudioPolicy.skipSeconds(nil) == 0, "no skip")
check(WizardAudioPolicy.absolute("/wizard-podcasts/api/episodes/1/audio", origin: origin) == origin + "/wizard-podcasts/api/episodes/1/audio", "absolute")
check(WizardAudioPolicy.absolute("//evil.test/x", origin: origin) == "//evil.test/x", "protocol-relative stays (and is refused)")

if failures > 0 { print("\(failures) failed"); exit(1) }
print("audio policy checks passed")
