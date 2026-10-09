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
        // 0.9 s room noise, 2 s talking, then quiet for 4.5 s.
        int[] amps = concat(fill(10, 500), fill(22, 9000), fill(50, 500));
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

    @Test
    public void pauseNeverSendsOrGivesUp() {
        SilenceDetector d = SilenceDetector.standard();
        long t = 1000;
        for (int i = 0; i < 20; i++, t += 90) d.feed(9000, t);   // 1.8 s talking
        d.pause(t);
        for (int i = 0; i < 400; i++, t += 90)                    // 36 s paused, silent
            assertEquals(SilenceDetector.Result.CONTINUE, d.feed(300, t));
        d.resume(t);
        // After resuming, the pause rule starts fresh: 1 s of quiet is still listening …
        SilenceDetector.Result r = SilenceDetector.Result.CONTINUE;
        for (int i = 0; i < 11; i++, t += 90) r = d.feed(300, t);
        assertEquals(SilenceDetector.Result.CONTINUE, r);
        // … and a real pause after that sends.
        for (int i = 0; i < 60 && r == SilenceDetector.Result.CONTINUE; i++, t += 90) r = d.feed(300, t);
        assertEquals(SilenceDetector.Result.SEND, r);
    }

    /**
     * James's real side-button take, 9 Oct 2026: "Testing the side button functionality. This seems
     * pretty nice." Peak amplitude per 90 ms from the delivered file, scaled to 0.8 because the
     * phone's live meter reads quieter than the decoded file. With the 0.6.2 rule this sends at
     * 7.2 s, exactly where the real take was cut off mid-"nice": the soft "pretty nice" never
     * counted as speech, so the 2.4 s timer ran from "This seems".
     */
    private static final int[] JAMES_TAKE = {
        0, 0, 0, 0, 40, 72, 2560, 4456, 8764, 2990, 2124, 1487, 1148, 1129, 3872, 4444, 2416, 1765, 2234,
        1822, 1490, 1564, 581, 2374, 1884, 869, 1673, 1942, 1644, 1919, 1597, 1076, 127, 136, 89, 119, 94, 100,
        121, 772, 2549, 2640, 2080, 1304, 1104, 796, 183, 100, 192, 1138, 2079, 3865, 3427, 2594, 1355, 1125, 1400,
        2498, 2567, 925, 120, 127, 122, 101, 606, 207, 156, 211, 1241, 1480, 869, 880, 308, 328, 250, 734,
        508, 452, 2104, 1398, 1142, 924};

    @Test
    public void softLastWordKeepsListeningThenAFullPauseSends() {
        SilenceDetector d = SilenceDetector.standard();
        long t = 1000;
        for (int a : JAMES_TAKE) {
            assertEquals(SilenceDetector.Result.CONTINUE, d.feed(a, t));
            t += 90;
        }
        // He stops talking. 3 s of room quiet is still "thinking", not "done".
        SilenceDetector.Result r = SilenceDetector.Result.CONTINUE;
        for (int i = 0; i < 33; i++, t += 90) r = d.feed(120, t);
        assertEquals(SilenceDetector.Result.CONTINUE, r);
        // A real pause after that sends.
        for (int i = 0; i < 20 && r == SilenceDetector.Result.CONTINUE; i++, t += 90) r = d.feed(120, t);
        assertEquals(SilenceDetector.Result.SEND, r);
    }

    @Test
    public void softSpeechAfterTalkingCountsAsTalking() {
        SilenceDetector d = SilenceDetector.standard();
        long t = 1000;
        for (int i = 0; i < 10; i++, t += 90) d.feed(300, t);    // quiet room
        for (int i = 0; i < 10; i++, t += 90) d.feed(6000, t);   // clear speech
        // 6 s of soft trailing speech (well under the start-of-speech threshold) never sends.
        for (int i = 0; i < 66; i++, t += 90)
            assertEquals(SilenceDetector.Result.CONTINUE, d.feed(1200, t));
    }

    @Test
    public void softNoiseAloneIsNotSpeech() {
        SilenceDetector d = SilenceDetector.standard();
        // The same soft level with no clear speech first never counts as "you said something".
        assertEquals(SilenceDetector.Result.NOTHING_HEARD, run(d, fill(120, 1200), 90));
    }

    @Test
    public void sidePauseIsLongerThanASplitSecond() {
        assertTrue(SilenceDetector.SIDE_PAUSE_MS >= 3500);
    }

    @Test
    public void pauseBeforeSpeakingDoesNotCountTowardsNothingHeard() {
        SilenceDetector d = SilenceDetector.standard();
        long t = 1000;
        d.feed(300, t);
        d.pause(t);
        t += 60_000;
        d.resume(t);
        assertEquals(SilenceDetector.Result.CONTINUE, d.feed(300, t + 90));
    }
}
