package ai.wizards.os.audio;
import org.junit.Test;
import static org.junit.Assert.*;
public class AudioPolicyTest {
    private final String origin="https://box.example.ts.net";
    @Test public void acceptsOnlyBoundAppMedia() {
        assertTrue(AudioPolicy.trusted(origin+"/wizard-music/stream/yt:abcdefghijk",origin,"stream"));
        assertTrue(AudioPolicy.trusted(origin+"/wizard-music/art/lib:abcdef",origin,"art"));
        assertTrue(AudioPolicy.trusted(origin+"/wizard-music/api/station/1234567890abcdef/more?n=10&requestId=x",origin,"more"));
        assertTrue(AudioPolicy.trusted(origin+"/wizard-music/api/feedback",origin,"feedback"));
    }
    @Test public void acceptsCanonicalHubEncodedSeparatorsOnly() {
        assertTrue(AudioPolicy.trusted(origin+"/wizard-music/stream/yt%3Aabcdefghijk",origin,"stream"));
        assertTrue(AudioPolicy.trusted(origin+"/wizard-music/art/lib%3aabcdef",origin,"art"));
        assertFalse(AudioPolicy.trusted(origin+"/wizard-music/stream/%79t%3Aabc",origin,"stream"));
        assertFalse(AudioPolicy.trusted(origin+"/wizard-music/stream/yt%253Aabc",origin,"stream"));
        assertFalse(AudioPolicy.trusted(origin+"/wizard-music/stream/yt%3Aabc%2fdef",origin,"stream"));
    }
    @Test public void rejectsEscapesAndCredentialRedirects() {
        for(String u:new String[]{"https://evil.test/wizard-music/stream/yt:abc",origin+"/wizard-music/stream/../art/yt:abc",origin+"/wizard-music/stream/%79t:abc",origin+"/wizard-music/stream/yt:abc?redirect=x",origin+"/other/stream/yt:abc",origin+"/wizard-music/stream/yt:abc#x","https://u@box.example.ts.net/wizard-music/stream/yt:abc"}) assertFalse(u,AudioPolicy.trusted(u,origin,"stream"));
    }
    @Test public void confinesBridgeToShellMainFrame() {
        assertTrue(AudioPolicy.shell(origin+"/wizard-os-home/?open=wizard-music",origin));
        assertFalse(AudioPolicy.shell(origin+"/wizard-music/",origin));
        assertFalse(AudioPolicy.shell("https://evil.test/wizard-os-home/",origin));
    }
    @Test public void admitsExactlyMusicAndPodcasts() {
        assertTrue(AudioPolicy.admitted("wizard-music"));
        assertTrue(AudioPolicy.admitted("wizard-podcasts"));
        for(String id:new String[]{null,"","wizard-notes","maps","Wizard-Podcasts","wizard-podcasts/"}) assertFalse(String.valueOf(id),AudioPolicy.admitted(id));
        assertFalse(AudioPolicy.trusted(origin+"/wizard-notes/api/episodes/1/audio",origin,"stream","wizard-notes"));
    }
    @Test public void podcastsMediaIsConfinedToItsEpisodes() {
        String pc="wizard-podcasts";
        assertTrue(AudioPolicy.trusted(origin+"/wizard-podcasts/api/episodes/11113/audio",origin,"stream",pc));
        assertTrue(AudioPolicy.trusted(origin+"/wizard-podcasts/api/episodes/11113/art",origin,"art",pc));
        assertTrue(AudioPolicy.trusted(origin+"/wizard-podcasts/api/shows/7/art",origin,"art",pc));
        assertTrue(AudioPolicy.trusted(origin+"/wizard-podcasts/api/episodes/11113/progress",origin,"progress",pc));
        for(String u:new String[]{origin+"/wizard-podcasts/api/episodes/1/audio?u=https://evil.test",origin+"/wizard-podcasts/api/episodes/x/audio",
                origin+"/wizard-podcasts/api/episodes/1/../2/audio","https://evil.test/wizard-podcasts/api/episodes/1/audio",origin+"/wizard-music/stream/yt:abcdefghijk",
                origin+"/wizard-podcasts/api/episodes/1/download",origin+"/wizard-podcasts/api/episodes/1/audio#x"}) assertFalse(u,AudioPolicy.trusted(u,origin,"stream",pc));
        // Podcasts never gets Music's continuation or feedback, and Music never gets Podcasts' media.
        assertFalse(AudioPolicy.trusted(origin+"/wizard-music/api/station/1234567890abcdef/more",origin,"more",pc));
        assertFalse(AudioPolicy.trusted(origin+"/wizard-music/api/feedback",origin,"feedback",pc));
        assertFalse(AudioPolicy.trusted(origin+"/wizard-podcasts/api/episodes/1/audio",origin,"stream","wizard-music"));
        assertFalse(AudioPolicy.trusted(origin+"/wizard-podcasts/api/episodes/1/progress",origin,"progress","wizard-music"));
    }
    @Test public void sharedPlayerOpensOnlyAdmittedMedia() {
        assertEquals("stream",AudioPolicy.mediaKind(origin+"/wizard-music/stream/yt:abcdefghijk",origin));
        assertEquals("art",AudioPolicy.mediaKind(origin+"/wizard-music/art/lib:abcdef",origin));
        assertEquals("stream",AudioPolicy.mediaKind(origin+"/wizard-podcasts/api/episodes/3/audio",origin));
        assertEquals("art",AudioPolicy.mediaKind(origin+"/wizard-podcasts/api/shows/3/art",origin));
        assertNull(AudioPolicy.mediaKind(origin+"/wizard-podcasts/api/episodes/3/progress",origin));
        assertNull(AudioPolicy.mediaKind(origin+"/wizard-music/api/feedback",origin));
        assertNull(AudioPolicy.mediaKind("https://evil.test/wizard-podcasts/api/episodes/3/audio",origin));
    }
    @Test public void trackIdsTapAndSkipFollowTheOwner() {
        assertTrue(AudioPolicy.trackId("wizard-podcasts","ep:11113"));
        assertFalse(AudioPolicy.trackId("wizard-podcasts","yt:abcdefghijk"));
        assertTrue(AudioPolicy.trackId("wizard-music","yt:abcdefghijk"));
        assertFalse(AudioPolicy.trackId("wizard-music","ep:1"));
        assertFalse(AudioPolicy.trackId("wizard-notes","ep:1"));
        assertEquals("/wizard-os-home/?open=wizard-podcasts",AudioPolicy.openPath("wizard-podcasts"));
        assertEquals("/wizard-os-home/?open=wizard-music",AudioPolicy.openPath("wizard-music"));
        assertEquals("/wizard-os-home/?open=wizard-music",AudioPolicy.openPath("evil&open=x"));
        assertTrue(AudioPolicy.spoken("wizard-podcasts"));
        assertFalse(AudioPolicy.spoken("wizard-music"));
        assertEquals(15000,AudioPolicy.skipMs(15));
        assertEquals(30000,AudioPolicy.skipMs(30));
        assertEquals(5000,AudioPolicy.skipMs(1));
        assertEquals(120000,AudioPolicy.skipMs(9999));
        assertEquals(0,AudioPolicy.skipMs(0));
        assertEquals(0,AudioPolicy.skipMs(Double.NaN));
    }
    @Test public void playbackSpeedIsAMethodAndClamped() {
        // wizard-ux issue 2061: Podcasts' speed buttons need a rate command on the device player.
        assertTrue(AudioPolicy.METHODS.contains("rate"));
        assertEquals(2f,AudioPolicy.rate(2),0f);
        assertEquals(1.5f,AudioPolicy.rate(1.5),0f);
        assertEquals(0.5f,AudioPolicy.rate(0.1),0f);
        assertEquals(3f,AudioPolicy.rate(9),0f);
        assertEquals(1f,AudioPolicy.rate(0),0f);
        assertEquals(1f,AudioPolicy.rate(-2),0f);
        assertEquals(1f,AudioPolicy.rate(Double.NaN),0f);
        assertEquals(1f,AudioPolicy.rate(Double.POSITIVE_INFINITY),0f);
    }
}
