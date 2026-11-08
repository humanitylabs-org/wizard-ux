package ai.wizards.os.downloads;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * DownloadManager.ACTION_DOWNLOAD_COMPLETE arrives at a manifest receiver. The receiver stays exported because the
 * sender is not Wizard OS and not the system UID (see docs/android-downloads-port.md, "Receiver"), so any app can send
 * the same action. Review finding on PR #1140 (source-level, no device exploit shown): a raw thread was started for every
 * non-negative id BEFORE the id was checked against what Wizard OS tracks. These tests pin: tracked id first, a single
 * bounded worker, genuine completions kept.
 */
public class DownloadsReceiverPolicyTest {
    private static final String DONE = "android.intent.action.DOWNLOAD_COMPLETE";

    private static Set<Long> tracked(long... ids) { Set<Long> s = new HashSet<>(); for (long i : ids) s.add(i); return s; }

    // ---- genuine completions are kept; everything else is dropped before any work ------------------------------------

    @Test public void aTrackedDownloadCompletionIsAccepted() {
        assertTrue(DownloadsReceiverPolicy.accept(DONE, 41, tracked(41, 42)::contains));
        assertTrue(DownloadsReceiverPolicy.accept(DONE, 0, tracked(0)::contains));
    }

    @Test public void anIdWizardOsNeverStartedIsDroppedBeforeAnyWork() {
        AtomicInteger asked = new AtomicInteger();
        assertFalse(DownloadsReceiverPolicy.accept(DONE, 7, id -> { asked.incrementAndGet(); return false; }));
        assertEquals("the tracked list was consulted", 1, asked.get());
    }

    @Test public void wrongActionsAndBadIdsNeverReachTheTrackedLookup() {
        AtomicInteger asked = new AtomicInteger();
        java.util.function.LongPredicate any = id -> { asked.incrementAndGet(); return true; };
        assertFalse(DownloadsReceiverPolicy.accept(null, 41, any));
        assertFalse(DownloadsReceiverPolicy.accept("android.intent.action.VIEW", 41, any));
        assertFalse(DownloadsReceiverPolicy.accept(DONE.toLowerCase(), 41, any));
        assertFalse(DownloadsReceiverPolicy.accept(DONE, -1, any));
        assertFalse(DownloadsReceiverPolicy.accept(DONE, Long.MIN_VALUE, any));
        assertEquals(0, asked.get());
    }

    @Test public void aFloodOfUntrackedIdsStartsNoWorkAtAll() {
        ThreadPoolExecutor ex = DownloadsReceiverPolicy.newExecutor();
        try {
            int scheduled = 0;
            for (long id = 0; id < 5000; id++)
                if (DownloadsReceiverPolicy.accept(DONE, id, tracked(-5)::contains)) scheduled++;
            assertEquals(0, scheduled);
            assertEquals("no thread was ever created for rejected ids", 0, ex.getPoolSize());
        } finally { ex.shutdownNow(); }
    }

    // ---- bounded work -------------------------------------------------------------------------------------------

    @Test public void workRunsOnOneBoundedWorkerAndOverflowIsRefusedNotQueuedForever() throws Exception {
        ThreadPoolExecutor ex = DownloadsReceiverPolicy.newExecutor();
        CountDownLatch hold = new CountDownLatch(1);
        try {
            int accepted = 0, refused = 0;
            for (int i = 0; i < 200; i++) {
                if (DownloadsReceiverPolicy.submit(ex, () -> { try { hold.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) { } })) accepted++;
                else refused++;
            }
            assertEquals("one worker thread, never one per id", 1, ex.getLargestPoolSize());
            assertEquals(1, ex.getMaximumPoolSize());
            assertTrue("a small bounded queue: " + accepted, accepted <= DownloadsReceiverPolicy.MAX_QUEUE + 1);
            assertTrue("accepted at least the worker itself", accepted >= 1);
            assertEquals(200, accepted + refused);
            assertTrue("overflow was refused", refused > 0);
        } finally { hold.countDown(); ex.shutdownNow(); }
    }

    @Test public void aRefusedSubmissionReportsFalseSoTheBroadcastIsStillFinished() {
        ThreadPoolExecutor ex = DownloadsReceiverPolicy.newExecutor();
        ex.shutdownNow();
        assertFalse(DownloadsReceiverPolicy.submit(ex, () -> { }));
    }

    @Test public void acceptedWorkActuallyRuns() throws Exception {
        ThreadPoolExecutor ex = DownloadsReceiverPolicy.newExecutor();
        CountDownLatch ran = new CountDownLatch(1);
        try {
            assertTrue(DownloadsReceiverPolicy.submit(ex, ran::countDown));
            assertTrue(ran.await(5, TimeUnit.SECONDS));
        } finally { ex.shutdownNow(); }
    }

    // ---- wiring: source of the receiver and the manifest ---------------------------------------------------------

    private static Path module() {
        Path p = Paths.get(System.getProperty("user.dir"), "src/main");
        assertTrue(p + " exists", Files.isDirectory(p));
        return p;
    }

    private static String read(String rel) throws Exception { return new String(Files.readAllBytes(module().resolve(rel)), "UTF-8"); }

    @Test public void theReceiverChecksTheTrackedIdFirstAndNeverStartsARawThread() throws Exception {
        String r = read("java/ai/wizards/os/downloads/DownloadsReceiver.java");
        assertFalse("no raw Thread per id", r.contains("new Thread("));
        assertTrue(r.contains("DownloadsReceiverPolicy.accept("));
        assertTrue(r.contains("DownloadsReceiverPolicy.submit("));
        assertTrue(r.contains("Downloads.isTracked("));
        int accept = r.indexOf("DownloadsReceiverPolicy.accept("), async = r.indexOf("goAsync()");
        assertTrue("accept(...) comes before goAsync()", accept >= 0 && async > accept);
        assertTrue("a refused submission still finishes the broadcast", r.contains("pending.finish()"));
    }

    @Test public void theReceiverListensForTheDownloadCompleteActionOnly() throws Exception {
        String m = read("AndroidManifest.xml");
        int at = m.indexOf(".downloads.DownloadsReceiver");
        assertTrue(at > 0);
        String block = m.substring(m.lastIndexOf("<receiver", at), m.indexOf("</receiver>", at));
        assertEquals("exactly one action", 1, block.split("<action ", -1).length - 1);
        assertTrue(block.contains("android.intent.action.DOWNLOAD_COMPLETE"));
        // exported on purpose: DownloadProvider (shared UID android.media, not the system UID) sends this broadcast; an
        // unexported manifest receiver would not get it. Validation, not export, is the defence (tracked id first).
        assertTrue("stays exported while the sender is another app's UID", block.contains("android:exported=\"true\""));
        // PR #1143 review (a222e3dc): exported does not have to mean "any app". DownloadProvider holds this signature
        // permission (AOSP: protectionLevel=signature, requested by DownloadProvider), no third-party app can.
        assertTrue("only a holder of the sender permission may deliver", block.contains("android:permission=\"android.permission.SEND_DOWNLOAD_COMPLETED_INTENTS\""));
    }

    @Test public void isTrackedLooksOnlyAtWhatWizardOsStarted() throws Exception {
        String d = read("java/ai/wizards/os/downloads/Downloads.java");
        assertTrue(d.contains("public static synchronized boolean isTracked("));
    }
}
