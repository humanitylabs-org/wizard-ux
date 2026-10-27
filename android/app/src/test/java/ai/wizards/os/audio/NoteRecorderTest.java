package ai.wizards.os.audio;

import ai.wizards.os.MicOwner;
import ai.wizards.os.assist.TakeRecovery;
import ai.wizards.os.mizel.MicLoan;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;

import static org.junit.Assert.*;

/** Plain JUnit: real MicOwner and journal, fake hardware and monotonic clock. No Android runtime required. */
public class NoteRecorderTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private File root, file;
    private CaptureJournal journal;
    private long now;
    private final AtomicInteger releases = new AtomicInteger();
    private Fake driver;

    private static final class Fake implements NoteRecorder.Driver {
        int stops, releases, pauses, resumes;
        boolean failStop, failRelease, failListener;
        NoteRecorder.Errors errors;
        public void stop() { stops++; if (failStop) throw new IllegalStateException("stop"); }
        public void release() { releases++; if (failRelease) throw new IllegalStateException("release"); }
        public void pause() { pauses++; }
        public void resume() { resumes++; }
        public int amplitude() { return 123; }
        public String routed() { return "builtin_mic"; }
        public void errors(NoteRecorder.Errors e) { errors = e; if (failListener) throw new IllegalStateException("listener"); }
    }

    @Before public void setup() throws Exception {
        clearOwner();
        root = tmp.newFolder(); file = new File(new File(root, "takes"), "take.aac");
        journal = new CaptureJournal(root); driver = new Fake(); now = 1000;
    }
    @After public void clearOwner() {
        for (String who : new String[]{MicOwner.ORB, MicOwner.EVERYWHERE, MicOwner.MEETING, MicOwner.SIDE}) MicOwner.release(who);
    }
    private NoteRecorder.Reservation reserve() throws IOException {
        return NoteRecorder.reserve(MicOwner.ORB, () -> { releases.incrementAndGet(); MicOwner.release(MicOwner.ORB); });
    }
    private NoteRecorder.Take start(int bytes, NoteRecorder.Listener listener) throws IOException {
        return NoteRecorder.open(reserve(), journal, "take", "app", file, false,
                f -> { Files.write(f.toPath(), new byte[bytes]); return driver; }, () -> now, listener);
    }
    private void released() {
        assertNull(MicOwner.holder()); assertEquals(1, releases.get());
    }
    private void kept() throws Exception {
        assertEquals("kept", journal.entry("take").getString("state"));
        assertEquals(4096, new File(journal.entry("take").getString("path")).length());
    }

    @Test public void realTakeStopsAndStaysInJournal() throws Exception {
        NoteRecorder.Take take = start(4096, null);
        assertEquals(MicOwner.ORB, MicOwner.holder());
        assertEquals("recording", journal.entry("take").getString("state"));
        assertEquals("builtin_mic", take.routed()); assertEquals(123, take.getMaxAmplitude());
        now += 1500;
        assertEquals(file, take.stop()); assertEquals(file, take.stop());
        released(); assertEquals(1, driver.stops); assertEquals(1, driver.releases);
        assertEquals(1500, take.elapsedMs()); assertEquals(0, take.getMaxAmplitude());
        assertEquals("stopped", new CaptureJournal(root).entry("take").getString("state"));
        assertEquals(4096, file.length());
    }
    @Test public void emptyTakeIsReleased() throws Exception {
        NoteRecorder.Take take = start(0, null);
        assertNull(take.stop()); assertNull(take.stop()); released();
        assertFalse(file.exists());
        assertEquals("NOTHING_RECORDED", journal.entry("take").getString("releaseReason"));
    }
    @Test public void headerOnlyTakeIsReleasedAtSharedFloor() throws Exception {
        NoteRecorder.Take take = start(2047, null);
        assertNull(take.stop()); released(); assertFalse(file.exists());
    }
    @Test public void boundaryTakeIsKeptForDelivery() throws Exception {
        NoteRecorder.Take take = start(2048, null);
        assertEquals(file, take.stop()); released(); assertTrue(file.isFile());
    }
    @Test public void refusedOwnerDoesNotReleaseSomebodyElsesMic() throws Exception {
        assertTrue(MicOwner.tryAcquire(MicOwner.MEETING));
        assertThrows(IOException.class, this::reserve);
        assertEquals(MicOwner.MEETING, MicOwner.holder()); assertEquals(0, releases.get());
    }
    @Test public void preServiceFailureReleasesReservationExactlyOnce() throws Exception {
        NoteRecorder.Reservation reservation = reserve(); reservation.close(); reservation.close(); released();
    }
    @Test public void emptyStopThenCancelDoesNotRecreateCustody() throws Exception {
        NoteRecorder.Take take = start(0, null);
        assertNull(take.stop()); assertFalse(take.cancel(15000)); released();
        assertFalse(file.exists());
        assertEquals("NOTHING_RECORDED", journal.entry("take").getString("releaseReason"));
    }
    @Test public void existingIdentityIsNotStoppedOrOverwritten() throws Exception {
        File original = new File(root, "original.aac"); Files.write(original.toPath(), new byte[4096]);
        journal.register("take", "everywhere", "note", original, 1);
        assertThrows(IOException.class, () -> start(0, null)); released();
        assertEquals("recording", journal.entry("take").getString("state"));
        assertEquals(original.getAbsolutePath(), journal.entry("take").getString("path"));
        assertFalse(file.exists());
    }
    @Test public void directoryFailureReleasesMic() throws Exception {
        File notDir = tmp.newFile();
        assertThrows(IOException.class, () -> NoteRecorder.open(reserve(), journal, "take", "app",
                new File(notDir, "take.aac"), false, f -> driver, () -> now, null));
        released(); assertEquals(0, driver.releases);
    }
    @Test public void existingFileIsNeverOverwritten() throws Exception {
        assertTrue(file.getParentFile().mkdirs()); Files.write(file.toPath(), new byte[4096]);
        assertThrows(IOException.class, () -> start(0, null));
        released(); assertEquals(4096, file.length()); assertEquals(0, driver.stops);
    }
    @Test public void failedHardwareStartReleasesEmptyFileAndMic() throws Exception {
        assertThrows(IOException.class, () -> NoteRecorder.open(reserve(), journal, "take", "app", file, false,
                f -> { throw new IOException("prepare/start failed"); }, () -> now, null));
        released(); assertFalse(file.exists());
        assertEquals("NOTHING_RECORDED", journal.entry("take").getString("releaseReason"));
    }
    @Test public void failedStartWithRealBytesKeepsThem() throws Exception {
        assertThrows(IllegalStateException.class, () -> NoteRecorder.open(reserve(), journal, "take", "app", file, false,
                f -> { Files.write(f.toPath(), new byte[4096]); throw new IllegalStateException("start"); }, () -> now, null));
        released(); kept();
    }
    @Test public void listenerSetupFailureClosesStartedHardware() throws Exception {
        driver.failListener = true;
        assertThrows(IllegalStateException.class, () -> start(4096, null));
        released(); kept(); assertEquals(1, driver.stops); assertEquals(1, driver.releases);
    }
    @Test public void stopAndReleaseExceptionsStillReleaseOwnerAndRetainAudio() throws Exception {
        NoteRecorder.Take take = start(4096, null); driver.failStop = true; driver.failRelease = true;
        assertEquals(file, take.stop()); take.stop(); released();
        assertEquals(1, driver.releases); assertEquals("stopped", journal.entry("take").getString("state"));
    }
    @Test public void journalFailureStillReleasesHardwareAndOwner() throws Exception {
        NoteRecorder.Take take = start(4096, null);
        File blocker = new File(root, "capture-journal.json.tmp"); assertTrue(blocker.mkdir());
        Files.write(new File(blocker, "block").toPath(), new byte[]{1});
        assertThrows(java.io.UncheckedIOException.class, take::stop);
        released(); assertEquals(1, driver.releases); assertEquals(4096, file.length());
    }
    @Test public void shortCancelDiscardsAndLongCancelKeeps() throws Exception {
        NoteRecorder.Take take = start(4096, null);
        assertFalse(take.cancel(14999)); assertFalse(take.cancel(14999));
        released(); assertFalse(file.exists());
        assertEquals("USER_DISCARD", journal.entry("take").getString("releaseReason"));
    }
    @Test public void longCancelKeepsAtPolicyBoundary() throws Exception {
        NoteRecorder.Take take = start(4096, null);
        assertTrue(take.cancel(15000)); assertTrue(take.cancel(15000));
        take.abandon(); released(); kept(); assertEquals(1, driver.releases);
    }
    @Test public void abandonKeepsRealAudioAndIsIdempotent() throws Exception {
        NoteRecorder.Take take = start(4096, null);
        take.abandon(); take.abandon(); released(); kept(); assertNull(take.stop());
    }
    @Test public void abandonReleasesEmptyAudio() throws Exception {
        NoteRecorder.Take take = start(0, null); take.abandon(); released(); assertFalse(file.exists());
    }
    @Test public void pauseResumeAndElapsedExcludePausedTime() throws Exception {
        NoteRecorder.Take take = start(4096, null);
        now = 2000; take.pause(); take.pause(); now = 4000;
        assertEquals(1000, take.elapsedMs()); assertEquals(0, take.getMaxAmplitude());
        take.resume(); take.resume(); now = 4500;
        take.stop(); now = 9000; assertEquals(1500, take.elapsedMs());
        assertEquals(1, driver.pauses); assertEquals(1, driver.resumes); released();
    }
    @Test public void micLostClosesBeforeNotifyingAndLateCallbacksCannotReleaseNextOwner() throws Exception {
        AtomicInteger errors = new AtomicInteger();
        NoteRecorder.Take take = start(4096, (t, what) -> {
            released(); assertEquals(7, what); assertEquals(file, t.stop()); errors.incrementAndGet();
        });
        driver.errors.lost(7); assertEquals(1, errors.get());
        assertTrue(MicOwner.tryAcquire(MicOwner.ORB));
        driver.errors.lost(7); take.stop();
        assertEquals(MicOwner.ORB, MicOwner.holder()); assertEquals(1, releases.get());
        assertEquals(1, errors.get());
    }
    @Test public void throwingMicLostListenerCannotLeakOwner() throws Exception {
        start(4096, (t, what) -> { throw new IllegalStateException("UI gone"); });
        assertThrows(IllegalStateException.class, () -> driver.errors.lost(1)); released();
        assertEquals("stopped", journal.entry("take").getString("state"));
    }
    @Test public void stagedLegacyM4aUsesSameCustodyWithoutTouchingHardware() throws Exception {
        File staged = new File(root, "staged.m4a"); Files.write(staged.toPath(), new byte[4096]);
        NoteRecorder.Take take = NoteRecorder.open(reserve(), journal, "take", "everywhere", staged, true,
                f -> null, () -> now, null);
        take.pause(); take.resume(); assertEquals(staged, take.stop()); released();
        assertEquals("everywhere", journal.entry("take").getString("source"));
        assertEquals(4096, staged.length());
    }
    @Test public void meetingLoanAndEngineShareOneIdempotentMicRelease() throws Exception {
        MicLoan loan = MicLoan.acquire(null, MicOwner.EVERYWHERE, "take", "event"); assertNotNull(loan);
        NoteRecorder.Take take = NoteRecorder.open(NoteRecorder.reserve(MicOwner.EVERYWHERE, loan::releaseMic),
                journal, "take", "everywhere", file, false,
                f -> { Files.write(f.toPath(), new byte[4096]); return driver; }, () -> now, null);
        take.stop(); assertNull(MicOwner.holder());
        assertTrue(MicOwner.tryAcquire(MicOwner.EVERYWHERE));
        loan.release(null, "stopped"); take.stop();
        assertEquals("late loan cleanup must not release the next take", MicOwner.EVERYWHERE, MicOwner.holder());
    }

    private String source(String relative) throws IOException {
        return new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"), "src/main/java/ai/wizards/os", relative)), StandardCharsets.UTF_8);
    }
    @Test public void controllersCannotOpenOrConfigureHardwareDirectly() throws Exception {
        for (String path : new String[]{"recording/RecorderService.java", "everywhere/EverywhereService.java"}) {
            String s = source(path);
            for (String forbidden : new String[]{"MicRoute.start(", "new MediaRecorder", "setOutputFile(", "MicOwner.tryAcquire(", "MicOwner.release("})
                assertFalse(path + " must delegate " + forbidden, s.contains(forbidden));
            assertTrue(path + " starts through the engine", s.contains("NoteRecorder.start("));
            assertFalse(path + " must not bypass the engine's cancel policy", s.contains("CaptureJournal.get(this).cancel("));
        }
        try (Stream<java.nio.file.Path> paths = Files.walk(Paths.get(System.getProperty("user.dir"), "src/main/java"))) {
            paths.filter(p -> p.toString().endsWith(".java")).forEach(p -> {
                try {
                    String s = new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
                    if (!s.contains("new MediaRecorder") && !s.contains(".setOutputFile(")) return;
                    String name = p.getFileName().toString();
                    assertTrue("Unexpected recorder " + name, name.equals("NoteRecorder.java") || name.equals("VoiceCapture.java") || name.equals("MeetingRecorderService.java"));
                } catch (IOException e) { throw new AssertionError(e); }
            });
        }
    }
    @Test public void sharedEncoderAndBothUploadFormatsStayWired() throws Exception {
        String engine = source("audio/NoteRecorder.java");
        assertTrue(engine.contains("MicRoute.start("));
        assertTrue(engine.contains("OutputFormat.AAC_ADTS"));
        assertTrue(engine.contains("setAudioEncodingBitRate(96000)"));
        assertTrue(engine.contains("setAudioSamplingRate(44100)"));
        assertEquals(".aac", TakeRecovery.ext(file.getName())); assertEquals("audio/aac", TakeRecovery.mime(file.getName()));
        assertEquals(".m4a", TakeRecovery.ext("legacy.m4a")); assertEquals("audio/mp4", TakeRecovery.mime("legacy.m4a"));
        String outbox = source("everywhere/EverywhereOutbox.java");
        assertTrue(outbox.contains("TakeRecovery.ext(recording.getName())"));
        assertTrue(outbox.contains("TakeRecovery.ext(audio.getName())"));
        assertTrue(outbox.contains("TakeRecovery.mime(audio.getName())"));
        String transcriber = source("assist/Transcriber.java");
        assertTrue(transcriber.contains("TakeRecovery.ext(audio.getName())"));
        assertTrue(transcriber.contains("TakeRecovery.mime(audio.getName())"));
    }
}
