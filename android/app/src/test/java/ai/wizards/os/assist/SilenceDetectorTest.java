package ai.wizards.os.assist;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;

import org.junit.Test;

public class SilenceDetectorTest {
    private static SilenceDetector.Result run(SilenceDetector d, int[] amps, long stepMs) {
        SilenceDetector.Result r = SilenceDetector.Result.CONTINUE;
        long t = 1000;
        for (int a : amps) {
            r = d.feed(a, t);
            t += stepMs;
            if (r != SilenceDetector.Result.CONTINUE) return r;
        }
        return r;
    }

    private static int[] fill(int n, int amp) {
        int[] a = new int[n];
        java.util.Arrays.fill(a, amp);
        return a;
    }

    private static int[] concat(int[]... parts) {
        int len = 0;
        for (int[] p : parts) len += p.length;
        int[] out = new int[len];
        int i = 0;
        for (int[] p : parts) for (int v : p) out[i++] = v;
        return out;
    }

    @Test
    public void speechThenPauseSends() {
        SilenceDetector d = SilenceDetector.standard();
        // 0.9 s room noise, 2 s talking, then quiet for 3 s.
        int[] amps = concat(fill(10, 500), fill(22, 9000), fill(34, 500));
        assertEquals(SilenceDetector.Result.SEND, run(d, amps, 90));
    }

    @Test
    public void shortGapsInSpeechKeepListening() {
        SilenceDetector d = SilenceDetector.standard();
        // talk, breathe for 1 s, talk again: still one utterance.
        int[] amps = concat(fill(15, 9000), fill(11, 500), fill(15, 9000));
        assertEquals(SilenceDetector.Result.CONTINUE, run(d, amps, 90));
    }

    @Test
    public void silenceOnlyEndsAsNothingHeard() {
        SilenceDetector d = SilenceDetector.standard();
        assertEquals(SilenceDetector.Result.NOTHING_HEARD, run(d, fill(120, 400), 90));
    }

    @Test
    public void noisyRoomRaisesTheThreshold() {
        SilenceDetector d = SilenceDetector.standard();
        run(d, fill(60, 1500), 90);
        assertTrue(d.speechThreshold() > 3000);
        assertTrue(!d.heardSpeech());
    }

    @Test
    public void longMonologueStopsAtTheCap() {
        SilenceDetector d = new SilenceDetector(2400, 9000, 5000);
        assertEquals(SilenceDetector.Result.SEND, run(d, fill(100, 9000), 90));
    }

    @Test
    public void multipartCarriesFileAndFields() throws Exception {
        Multipart mp = new Multipart("BOUNDARY");
        mp.file("file", "voice.m4a", "audio/mp4", new byte[]{1, 2, 3}).field("language", "en");
        String body = new String(mp.finish(), StandardCharsets.ISO_8859_1);
        assertEquals("multipart/form-data; boundary=BOUNDARY", mp.contentType());
        assertTrue(body.contains("name=\"file\"; filename=\"voice.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n\u0001\u0002\u0003\r\n"));
        assertTrue(body.contains("name=\"language\"\r\n\r\nen\r\n"));
        assertTrue(body.endsWith("--BOUNDARY--\r\n"));
    }
}
