package ai.wizards.os;

import android.content.Context;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import androidx.test.platform.app.InstrumentationRegistry;
import ai.wizards.os.mizel.MizelJournal;
import ai.wizards.os.mizel.MizelStore;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.Assert.*;

/**
 * wizard-ux#1769 on a real emulator: startup bookkeeping never holds the UI thread.
 *  1. A start's disk loads ({@link StartupWork}) run off the main thread; what follows them still runs on it.
 *  2. A long meeting (6.4 h, 4,600 chunks, half still uploading) on the device's own storage: while the uploader works
 *     through the backlog, the UI thread's store reads (what recover() in onStart/onResume does) never wait long.
 * Uses its own store directory, never the app's meetings. Run by {@link DeviceBridgeE2eTest}.
 */
final class LongMeetingStartupScenario {
    private static final String TAG = "WizardStartupQa";

    static void startupLoadsRunOffTheUiThread() throws Exception {
        AtomicBoolean loadedOnMain = new AtomicBoolean(true), thenOnMain = new AtomicBoolean(false);
        AtomicLong thenAt = new AtomicLong();
        long[] mainMs = {0};
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            long t = SystemClock.elapsedRealtime();
            StartupWork.then(false, () -> {
                loadedOnMain.set(Looper.myLooper() == Looper.getMainLooper());
                SystemClock.sleep(3000); // a slow load: a long meeting's custody index, an ANR trace
            }, () -> {
                thenOnMain.set(Looper.myLooper() == Looper.getMainLooper());
                thenAt.set(SystemClock.elapsedRealtime());
            });
            mainMs[0] = SystemClock.elapsedRealtime() - t;
        });
        long until = SystemClock.elapsedRealtime() + 15000;
        while (thenAt.get() == 0 && SystemClock.elapsedRealtime() < until) Thread.sleep(20);
        Log.i(TAG, "startup load: main thread busy " + mainMs[0] + " ms for a 3000 ms load");
        assertTrue("the main thread did not wait for the load: " + mainMs[0] + " ms", mainMs[0] < 500);
        assertFalse("the load ran off the main thread", loadedOnMain.get());
        assertTrue("what follows the load ran", thenAt.get() > 0);
        assertTrue("what follows the load ran on the main thread", thenOnMain.get());
        // Already loaded and on the main thread: runs at once, in the same call, as before.
        boolean[] now = {false};
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> StartupWork.then(true, () -> fail("no second load"), () -> now[0] = true));
        assertTrue(now[0]);
    }

    static void longMeetingUploadsDoNotHoldTheUiThread() throws Exception {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        int n = 4600, uploaded = n / 2, acks = 100;
        File files = new File(c.getCacheDir(), "qa-long-meeting-" + System.nanoTime());
        File root = new File(files, "mizel");
        String id = "qa_mt_long_meeting";
        File me = new File(new File(root, id), "me");
        assertTrue(me.mkdirs());
        try {
            JSONArray idx = new JSONArray();
            MizelJournal j = new MizelJournal();
            j.meetingId = id; j.createdAt = 1; j.nextSeq = n; j.acked = uploaded; j.lastAckedSeq = uploaded - 1;
            j.stopReason = "user"; j.finalSeq = n - 1; j.endedAt = 2; j.mediaSamples = n * 80000L;
            for (int s = 0; s < n; s++) {
                File f = new File(me, String.format(java.util.Locale.US, "%06d.wav", s));
                try (RandomAccessFile r = new RandomAccessFile(f, "rw")) { r.setLength(44 + 160); }
                JSONObject e = new JSONObject();
                e.put("id", id + "/" + String.format(java.util.Locale.US, "%06d", s)); e.put("source", "meeting"); e.put("kind", "meeting_chunk");
                e.put("path", f.getAbsolutePath()); e.put("bytes", f.length()); e.put("startedAt", 1L); e.put("owner", "mizel-uploader");
                JSONArray rc = new JSONArray(); rc.put(new JSONObject().put("owner", "mizel-uploader"));
                if (s < uploaded) { e.put("state", "delivered"); rc.put(new JSONObject().put("server", "mizel-chunk:" + id + "/" + s)); }
                else {
                    e.put("state", "handed");
                    MizelJournal.Chunk ch = new MizelJournal.Chunk(); ch.seq = s; ch.startMs = s * 5000L; ch.samples = 80000; j.pending.add(ch);
                }
                e.put("receipts", rc); e.put("updatedAt", 1L); idx.put(e);
            }
            Files.write(new File(files, "capture-journal.json").toPath(), idx.toString().getBytes(StandardCharsets.UTF_8));
            Files.write(new File(new File(root, id), "journal.json").toPath(), j.json().toString().getBytes(StandardCharsets.UTF_8));

            long t0 = SystemClock.elapsedRealtime();
            MizelStore store = new MizelStore(root);
            long openMs = SystemClock.elapsedRealtime() - t0;

            AtomicBoolean done = new AtomicBoolean();
            long[] ack = {0, 0}; // total, longest
            Thread up = new Thread(() -> {
                for (int s = uploaded; s < uploaded + acks; s++) {
                    long t = SystemClock.elapsedRealtime();
                    store.acked(id, s);
                    long d = SystemClock.elapsedRealtime() - t;
                    ack[0] += d; ack[1] = Math.max(ack[1], d);
                }
                done.set(true);
            }, "qa-uploader");
            long[] ui = {0, 0, 0}; // calls, longest wait, total wait
            up.start();
            while (!done.get()) {
                InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                    long t = SystemClock.elapsedRealtime();
                    synchronized (store) { for (MizelJournal x : store.all()) if (x.recording) break; } // as recover() does
                    long w = SystemClock.elapsedRealtime() - t;
                    ui[0]++; ui[1] = Math.max(ui[1], w); ui[2] += w;
                });
                Thread.sleep(16);
            }
            up.join(120_000);
            String line = "long meeting " + n + " chunks: store opened in " + openMs + " ms (off the UI thread at start); "
                    + acks + " acks back to back took " + ack[0] + " ms (longest " + ack[1] + " ms); UI-thread store reads: "
                    + ui[0] + " calls, longest wait " + ui[1] + " ms, " + ui[2] + " ms waiting in total";
            Log.i(TAG, line);
            System.out.println(line);
            assertEquals("every ack landed", n - uploaded - acks, store.pendingCount(id));
            assertTrue("the UI thread never waited 1 s on the meeting store: " + line, ui[1] < 1000);
        } finally {
            deleteTree(files);
        }
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private LongMeetingStartupScenario() {}
}
