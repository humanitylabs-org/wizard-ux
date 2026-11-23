package ai.wizards.os;

import static org.junit.Assert.*;

import java.io.File;
import java.util.Arrays;
import java.util.List;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** wizard-ux#1724: the phone keeps why earlier processes ended, so an early meeting stop can be explained. */
public class ProcessExitLogTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static ProcessExitLog.Exit exit(long at, int pid, int reason, String description) {
        ProcessExitLog.Exit e = new ProcessExitLog.Exit();
        e.timestamp = at; e.pid = pid; e.reason = reason; e.description = description; e.process = "ai.wizards.os";
        return e;
    }

    @Test public void recordsOnlyNewExitsOnceAndSurvivesARestart() throws Exception {
        File f = new File(tmp.newFolder(), "diagnostics/process-exits.json");
        ProcessExitLog log = new ProcessExitLog(f);
        List<ProcessExitLog.Exit> fresh = log.add(Arrays.asList(exit(2_000, 12, 3, "lmk"), exit(1_000, 11, 4, "java.lang.IllegalStateException\u0000")));
        assertEquals(2, fresh.size());
        assertEquals("newest first", 12, fresh.get(0).pid);
        assertEquals("control characters are dropped", "java.lang.IllegalStateException", log.exits().get(1).description);
        assertTrue(log.takeUnreported());
        assertFalse(log.takeUnreported());

        ProcessExitLog again = new ProcessExitLog(f); // next process: Android lists the same exits again plus a new one
        fresh = again.add(Arrays.asList(exit(3_000, 13, 2, "signal 9"), exit(2_000, 12, 3, "lmk"), exit(1_000, 11, 4, "x")));
        assertEquals(1, fresh.size());
        assertEquals(13, fresh.get(0).pid);
        assertEquals(3, again.exits().size());
        assertTrue(again.takeUnreported());
        assertEquals("signaled", again.json(1).getJSONObject(0).getString("reasonName"));
        assertEquals(1, again.json(1).length());
    }

    @Test public void keepsTheLastTwentyAndClipsDescriptions() throws Exception {
        ProcessExitLog log = new ProcessExitLog(new File(tmp.newFolder(), "x.json"));
        StringBuilder longText = new StringBuilder();
        for (int i = 0; i < 500; i++) longText.append('d');
        for (int i = 1; i <= 25; i++) log.add(Arrays.asList(exit(i * 1_000L, i, 13, longText.toString())));
        assertEquals(ProcessExitLog.KEEP, log.exits().size());
        assertEquals(25, log.exits().get(0).pid);
        assertEquals(ProcessExitLog.DESCRIPTION_MAX, log.exits().get(0).description.length());
    }

    @Test public void findsTheExitThatEndedARecording() throws Exception {
        ProcessExitLog log = new ProcessExitLog(new File(tmp.newFolder(), "x.json"));
        log.add(Arrays.asList(exit(100_000, 1, 10, "old"), exit(205_000, 2, 3, "lmk"), exit(400_000, 3, 4, "later")));
        assertEquals("the first exit after the last chunk", 2, log.near(203_000).pid);
        assertEquals("an exit stamped shortly before the last sign of life still counts", 3, log.near(430_000).pid);
        assertNull(log.near(900_000));
    }

    @Test public void plainWordsForTheOwner() {
        assertEquals("low memory", ProcessExitLog.plainName("low_memory"));
        assertEquals("the app crashed", ProcessExitLog.plainName("crash"));
        assertEquals("", ProcessExitLog.plainName(""));
        assertEquals("", ProcessExitLog.plainName("nonsense"));
        assertEquals("freezer", ProcessExitLog.reasonName(14));
    }
}
