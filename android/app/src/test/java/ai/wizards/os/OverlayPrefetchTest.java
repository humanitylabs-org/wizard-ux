package ai.wizards.os;

import org.junit.Test;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class OverlayPrefetchTest {
    @Test public void dependenciesStartConcurrentlyAndAreConsumedOnce() throws Exception {
        CountDownLatch started = new CountDownLatch(6), release = new CountDownLatch(1);
        AtomicInteger calls = new AtomicInteger();
        String[] paths = {"a", "b", "c", "d", "e", "f"};
        try (OverlayPrefetch batch = new OverlayPrefetch(paths, 3000, p -> {
            calls.incrementAndGet(); started.countDown(); release.await(); return p.getBytes();
        })) {
            assertTrue("sequential loading cannot pass this barrier", started.await(2, TimeUnit.SECONDS));
            release.countDown();
            for (String p : paths) assertArrayEquals(p.getBytes(), batch.take(p));
            assertNull("a later read must revalidate transport, not reuse cached privileged content", batch.take("a"));
            assertEquals(6, calls.get());
        } finally { release.countDown(); }
    }
    @Test public void closedGenerationCannotReturnBytesAndNewOwnerHasIndependentReads() throws Exception {
        CountDownLatch oldStarted = new CountDownLatch(1), release = new CountDownLatch(1);
        OverlayPrefetch old = new OverlayPrefetch(new String[]{"orb.js"}, 3000, p -> {
            oldStarted.countDown(); release.await(); return "old Wizard".getBytes();
        });
        assertTrue(oldStarted.await(2, TimeUnit.SECONDS));
        old.close(); release.countDown();
        try { old.take("orb.js"); fail("closed generation returned bytes"); } catch (CancellationException expected) { }
        try (OverlayPrefetch next = new OverlayPrefetch(new String[]{"orb.js"}, 3000, p -> "new Wizard".getBytes())) {
            assertArrayEquals("new Wizard".getBytes(), next.take("orb.js"));
        }
    }
    @Test public void oneTotalBudgetAndFailuresAreNotCachedAsSuccess() throws Exception {
        try (OverlayPrefetch batch = new OverlayPrefetch(new String[]{"slow", "bad"}, 80, p -> {
            if (p.equals("bad")) throw new java.io.IOException("404");
            Thread.sleep(3000); return new byte[1];
        })) {
            try { batch.take("bad"); fail("failure became a successful resource"); } catch (ExecutionException expected) { }
            long start = System.nanoTime();
            try { batch.take("slow"); fail("deadline ignored"); } catch (TimeoutException expected) { }
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 1000);
        }
    }
    @Test public void prefetchPathsStayInsideTheExactAllowlist() {
        for (String page : new String[]{"surface.html#corner", "everywhere.html", "screen.html"}) {
            for (String path : OverlayPolicy.prefetch(page))
                assertTrue(path, OverlayPolicy.fromWizard("https://one.example", OverlayPolicy.VIRTUAL + OverlayPolicy.SHELL + path));
        }
    }
}
