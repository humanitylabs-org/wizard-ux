package ai.wizards.shell.orb;

import org.junit.Test;

import java.util.concurrent.CancellationException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.Assert.*;

/** Ported from android/app's OverlayPrefetchTest (#323). */
public class OrbPrefetchTest {
    @Test public void dependenciesStartConcurrentlyAndAreConsumedOnce() throws Exception {
        CountDownLatch started = new CountDownLatch(OrbPrefetch.PATHS.length), release = new CountDownLatch(1);
        AtomicInteger calls = new AtomicInteger();
        try (OrbPrefetch batch = new OrbPrefetch(OrbPrefetch.PATHS, 3000, p -> {
            calls.incrementAndGet(); started.countDown(); release.await(); return p.getBytes();
        })) {
            assertTrue("sequential loading cannot pass this barrier", started.await(2, TimeUnit.SECONDS));
            release.countDown();
            for (String p : OrbPrefetch.PATHS) assertArrayEquals(p.getBytes(), batch.take(p));
            assertNull("a later read revalidates transport, never reuses cached privileged content", batch.take("orb.js"));
            assertEquals(OrbPrefetch.PATHS.length, calls.get());
        } finally { release.countDown(); }
    }

    @Test public void aClosedLoadCannotReturnBytesAndANewOwnerReadsIndependently() throws Exception {
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1);
        OrbPrefetch old = new OrbPrefetch(new String[]{"orb.js"}, 3000, p -> { started.countDown(); release.await(); return "old Wizard".getBytes(); });
        assertTrue(started.await(2, TimeUnit.SECONDS));
        old.close(); release.countDown();
        try { old.take("orb.js"); fail("closed load returned bytes"); } catch (CancellationException expected) { }
        try (OrbPrefetch next = new OrbPrefetch(new String[]{"orb.js"}, 3000, p -> "new Wizard".getBytes())) {
            assertArrayEquals("new Wizard".getBytes(), next.take("orb.js"));
        }
    }

    @Test public void oneTotalBudgetAndFailuresAreNeverSuccess() throws Exception {
        try (OrbPrefetch batch = new OrbPrefetch(new String[]{"slow", "bad"}, 80, p -> {
            if (p.equals("bad")) throw new java.io.IOException("503");
            Thread.sleep(3000); return new byte[1];
        })) {
            try { batch.take("bad"); fail("failure became a resource"); } catch (ExecutionException expected) { }
            long start = System.nanoTime();
            try { batch.take("slow"); fail("deadline ignored"); } catch (TimeoutException expected) { }
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 1000);
        }
    }

    @Test public void prefetchPathsStayInsideTheExactAllowlist() {
        for (String path : OrbPrefetch.PATHS)
            assertTrue(path, OrbPolicy.fromWizard("https://one.example:8444", OrbPolicy.VIRTUAL + OrbPolicy.SHELL + path));
    }
}
