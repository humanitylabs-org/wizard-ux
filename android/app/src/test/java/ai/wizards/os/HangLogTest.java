package ai.wizards.os;

import static org.junit.Assert.*;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** wizard-ux#1762: a frozen UI thread or an ANR reaches the phone's diagnostics with the main thread's stack. */
public class HangLogTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    // The shape of Android's ANR trace (ApplicationExitInfo.getTraceInputStream, same as /data/anr).
    static final String TRACE = "----- pid 4242 at 2026-11-23 17:51:42 -----\n"
            + "Cmd line: ai.wizards.os\n\n"
            + "\"main\" prio=5 tid=1 Blocked\n"
            + "  | group=\"main\" sCount=1 ucsCount=0 flags=1 obj=0x72f1 self=0xb400\n"
            + "  | sysTid=4242 nice=-10 cgrp=top-app sched=0/0 handle=0x7a\n"
            + "  native: #00 pc 000000000008e2b8  /apex/com.android.runtime/lib64/bionic/libc.so (syscall+24)\n"
            + "  at ai.wizards.os.mizel.MizelStore.snapshot(MizelStore.java:110)\n"
            + "  - waiting to lock <0x0a1b2c3d> (a ai.wizards.os.mizel.MizelStore) held by thread 27\n"
            + "  at ai.wizards.os.mizel.MizelHub.state(MizelHub.java:86)\n"
            + "  at ai.wizards.os.MainActivity.onStart(MainActivity.java:1039)\n"
            + "\n"
            + "\"MizelUploader\" prio=5 tid=27 Native\n"
            + "  at java.io.FileDescriptor.sync(Native method)\n";

    @Test public void anrTraceKeepsOnlyTheMainThreadsCodeLocations() throws Exception {
        List<String> f = HangLog.mainFrames(new ByteArrayInputStream(TRACE.getBytes(StandardCharsets.UTF_8)));
        assertEquals(Arrays.asList("ai.wizards.os.mizel.MizelStore.snapshot(MizelStore.java:110)",
                "- waiting to lock <0x0a1b2c3d> (a ai.wizards.os.mizel.MizelStore) held by thread 27",
                "ai.wizards.os.mizel.MizelHub.state(MizelHub.java:86)",
                "ai.wizards.os.MainActivity.onStart(MainActivity.java:1039)"), f);
        assertTrue("no trace, no frames", HangLog.mainFrames(null).isEmpty());
        assertTrue("a trace without a main thread gives nothing",
                HangLog.mainFrames(new ByteArrayInputStream("\"other\" prio=5\n  at a.B.c(B.java:1)\n".getBytes(StandardCharsets.UTF_8))).isEmpty());
    }

    @Test public void framesAreCodeLocationsOnly() {
        assertEquals("a.B.c:12", HangLog.frames(new StackTraceElement[]{new StackTraceElement("a.B", "c", "B.java", 12)}).get(0));
        assertEquals("quotes, slashes and ? never pass", "https:box.examplechatqsecret", HangLog.frame("\"https://box.example/chat?q=secret\""));
        assertEquals(HangLog.FRAME_MAX, HangLog.frame(new String(new char[500]).replace('\0', 'x')).length());
        StackTraceElement[] deep = new StackTraceElement[90];
        for (int i = 0; i < deep.length; i++) deep[i] = new StackTraceElement("a.B", "m" + i, "B.java", i + 1);
        assertEquals(HangLog.FRAMES, HangLog.frames(deep).size());
    }

    @Test public void aHangIsSavedAtOnceAndItsLengthWhenItEnds() throws Exception {
        File file = new File(tmp.newFolder(), "diagnostics/hangs.json");
        HangLog log = new HangLog(file);
        HangLog.Hang h = new HangLog.Hang();
        h.at = 1_795_775_905_000L; h.ms = 4_000; h.frames.add("ai.wizards.os.mizel.MizelStore.snapshot:110");
        log.add(h);
        // The process can be closed from the ANR dialog right now: what was saved must already name the stack.
        HangLog died = new HangLog(file);
        assertEquals(1, died.hangs().size());
        assertEquals("ai.wizards.os.mizel.MizelStore.snapshot:110", died.hangs().get(0).frames.get(0));
        assertTrue("the next start reports it", died.takeUnreported());

        log.takeUnreported();
        log.lasted(h, 9_300);
        JSONObject j = new HangLog(file).json(5).getJSONObject(0);
        assertEquals(9_300, j.getLong("ms"));
        assertEquals("main", j.getString("kind"));
        assertTrue("a longer stall is reported again", log.takeUnreported());
        log.lasted(h, 100);
        assertEquals("never shortened", 9_300, new HangLog(file).hangs().get(0).ms);

        for (int i = 0; i < 15; i++) { HangLog.Hang x = new HangLog.Hang(); x.at = i; x.kind = "webview"; log.add(x); }
        assertEquals(HangLog.KEEP, new HangLog(file).hangs().size());
        assertEquals(14, new HangLog(file).hangs().get(0).at);
        assertEquals(5, log.json(5).length());
    }

    @Test public void anrExitCarriesItsFramesThroughTheLog() throws Exception {
        File f = new File(tmp.newFolder(), "diagnostics/process-exits.json");
        ProcessExitLog log = new ProcessExitLog(f);
        ProcessExitLog.Exit e = new ProcessExitLog.Exit();
        e.timestamp = 5_000; e.pid = 4242; e.reason = 6; e.process = "ai.wizards.os";
        e.frames.addAll(HangLog.mainFrames(new ByteArrayInputStream(TRACE.getBytes(StandardCharsets.UTF_8))));
        log.add(Arrays.asList(e));
        assertEquals(5_000, log.lastSeen());
        JSONObject j = new ProcessExitLog(f).json(1).getJSONObject(0);
        assertEquals("anr", j.getString("reasonName"));
        assertEquals(4, j.getJSONArray("frames").length());
        assertEquals("ai.wizards.os.mizel.MizelStore.snapshot(MizelStore.java:110)", j.getJSONArray("frames").getString(0));
        ProcessExitLog.Exit plain = new ProcessExitLog.Exit(); plain.timestamp = 6_000; plain.reason = 3;
        log.add(Arrays.asList(plain));
        assertFalse("an exit without a trace sends no frames key", log.json(1).getJSONObject(0).has("frames"));
    }
}
