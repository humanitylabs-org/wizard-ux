package ai.wizards.os.audio;
import org.junit.Test;
import static org.junit.Assert.*;
public class AudioPolicyTest {
    private final String origin="https://wizard.tailc0f369.ts.net";
    @Test public void acceptsOnlyBoundAppMedia() {
        assertTrue(AudioPolicy.trusted(origin+"/wizard-music/stream/yt:abcdefghijk",origin,"stream"));
        assertTrue(AudioPolicy.trusted(origin+"/wizard-music/art/lib:abcdef",origin,"art"));
        assertTrue(AudioPolicy.trusted(origin+"/wizard-music/api/station/1234567890abcdef/more?n=10&requestId=x",origin,"more"));
        assertTrue(AudioPolicy.trusted(origin+"/wizard-music/api/feedback",origin,"feedback"));
    }
    @Test public void rejectsEscapesAndCredentialRedirects() {
        for(String u:new String[]{"https://evil.test/wizard-music/stream/yt:abc",origin+"/wizard-music/stream/../art/yt:abc",origin+"/wizard-music/stream/%79t:abc",origin+"/wizard-music/stream/yt:abc?redirect=x",origin+"/other/stream/yt:abc",origin+"/wizard-music/stream/yt:abc#x","https://u@wizard.tailc0f369.ts.net/wizard-music/stream/yt:abc"}) assertFalse(u,AudioPolicy.trusted(u,origin,"stream"));
    }
    @Test public void confinesBridgeToShellMainFrame() {
        assertTrue(AudioPolicy.shell(origin+"/wizard-os-home/?open=wizard-music",origin));
        assertFalse(AudioPolicy.shell(origin+"/wizard-music/",origin));
        assertFalse(AudioPolicy.shell("https://evil.test/wizard-os-home/",origin));
    }
}
