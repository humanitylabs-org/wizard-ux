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
check(WizardAudioPolicy.methods.contains("rate"), "rate is a player method (issue 2061)")
check(WizardAudioPolicy.rate(2) == 2 && WizardAudioPolicy.rate(1.5) == 1.5, "rate 1.5/2")
check(WizardAudioPolicy.rate(0.1) == 0.5 && WizardAudioPolicy.rate(9) == 3, "rate clamp 0.5...3")
check(WizardAudioPolicy.rate(0) == 1 && WizardAudioPolicy.rate(-1) == 1 && WizardAudioPolicy.rate(.nan) == 1 && WizardAudioPolicy.rate(.infinity) == 1 && WizardAudioPolicy.rate(nil) == 1, "no rate is 1x")
check(WizardAudioPolicy.skipSeconds(0) == 0 && WizardAudioPolicy.skipSeconds(.nan) == 0 && WizardAudioPolicy.skipSeconds(nil) == 0, "no skip")
check(WizardAudioPolicy.absolute("/wizard-podcasts/api/episodes/1/audio", origin: origin) == origin + "/wizard-podcasts/api/episodes/1/audio", "absolute")
check(WizardAudioPolicy.absolute("//evil.test/x", origin: origin) == "//evil.test/x", "protocol-relative stays (and is refused)")

// lockScreenButtonsFollowTheOwner (asks 3): Podcasts asks back 15 / forward 30 and gets them in place of next/previous
let podcastControls = WizardAudioPolicy.controls(back: 15, forward: 30)
check(podcastControls.skipBack == 15 && podcastControls.skipForward == 30, "podcasts skip 15/30")
check(!podcastControls.nextPrevious, "podcasts: no next/previous while skip buttons show")
let musicControls = WizardAudioPolicy.controls(back: nil, forward: nil)
check(musicControls.nextPrevious && musicControls.skipBack == 0 && musicControls.skipForward == 0, "music: next/previous, no skips")
check(podcastControls.scrub && musicControls.scrub, "the progress bar can be dragged for both")
check(WizardAudioPolicy.controls(back: 1, forward: 9999) == WizardAudioPolicy.Controls(skipBack: 5, skipForward: 120), "skip sizes clamped")
check(WizardAudioPolicy.sessionMode(pc) == "spokenAudio" && WizardAudioPolicy.sessionMode(music) == "default", "session modes")

// nowPlayingTextShowsTheTrack (ask 3)
let ep: [String: Any] = ["title": "Episode 12", "artist": "The Show", "album": "", "id": "ep:12"]
let epText = WizardAudioPolicy.nowPlayingText(app: pc, track: ep)
check(epText.title == "Episode 12" && epText.artist == "The Show" && epText.podcast == "The Show", "episode on the lock screen")
let song = WizardAudioPolicy.nowPlayingText(app: music, track: ["title": "Song", "artist": "Band", "album": "LP"])
check(song.title == "Song" && song.artist == "Band" && song.album == "LP" && song.podcast == nil, "song on the lock screen")
check(WizardAudioPolicy.nowPlayingText(app: music, track: ["title": 5]).title == "", "a non-text title shows nothing")

// interruptionsAndUnplug (ask 4): began 1 / ended 0, shouldResume 1; route reason oldDeviceUnavailable 2
check(WizardAudioPolicy.interruption(type: 1, options: nil, wasPlaying: true) == .pause, "a call pauses playback")
check(WizardAudioPolicy.interruption(type: 1, options: nil, wasPlaying: false) == .nothing, "a call while paused changes nothing")
check(WizardAudioPolicy.interruption(type: 0, options: 1, wasPlaying: true) == .resume, "after the call it resumes when iOS says so")
check(WizardAudioPolicy.interruption(type: 0, options: 0, wasPlaying: true) == .nothing, "no resume when iOS does not say so")
check(WizardAudioPolicy.interruption(type: 0, options: 1, wasPlaying: false) == .nothing, "never starts what was not playing")
check(WizardAudioPolicy.interruption(type: nil, options: 1, wasPlaying: true) == .nothing, "unknown interruption")
check(WizardAudioPolicy.pausesOnRouteChange(2), "headphones out pauses")
for r in [nil, 0, 1, 3, 4, 8] as [UInt?] { check(!WizardAudioPolicy.pausesOnRouteChange(r), "route change \(r.debugDescription) keeps playing") }

// previousRestartsLikeAndroid
check(WizardAudioPolicy.previousRestarts(position: 10, index: 3), "past 4 s restarts")
check(!WizardAudioPolicy.previousRestarts(position: 2, index: 3), "early goes one back")
check(WizardAudioPolicy.previousRestarts(position: 0, index: 0), "first track restarts")

// podcastsPlaceIsSaved (ask 4)
check(WizardAudioPolicy.progressEvery == 15, "progress every 15 s")
let mid = WizardAudioPolicy.progressBody(app: pc, position: 61.5, duration: 1800, completed: false)
check(mid?["position"] as? Double == 61.5 && mid?["duration"] as? Double == 1800 && mid?["completed"] == nil, "mid-episode place")
let end = WizardAudioPolicy.progressBody(app: pc, position: 1799.7, duration: 1800, completed: true)
check(end?["position"] as? Double == 1800 && end?["completed"] as? Bool == true, "finished episode")
let live = WizardAudioPolicy.progressBody(app: pc, position: 30, duration: 0, completed: false)
check(live?["position"] as? Double == 30 && live?["duration"] == nil, "no duration yet")
check(WizardAudioPolicy.progressBody(app: music, position: 30, duration: 200, completed: false) == nil, "music saves no podcast place")
check(WizardAudioPolicy.progressBody(app: pc, position: .nan, duration: 200, completed: false) == nil, "nan position is not sent")
if let body = mid, let json = try? JSONSerialization.data(withJSONObject: body),
   let back = (try? JSONSerialization.jsonObject(with: json)) as? [String: Any] {
    check(back["position"] as? Double == 61.5, "the body is valid JSON for the progress URL")
} else { check(false, "progress body serialises") }

if failures > 0 { print("\(failures) failed"); exit(1) }
print("audio policy checks passed")
