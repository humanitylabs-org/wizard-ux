package ai.wizards.shell.orb;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CancellationException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * One orb page load's memory-only speculative reads, ported from android/app's OverlayPrefetch (#323). It removes the
 * serial waterfall (html → orb-size.js → orb.js → everywhere.js) that missed the unchanged 1.5 s deadline on cold
 * renderers. Never shared across loads, owners or generations; the global worker/queue bounds hold when the orb hides
 * and shows faster than sockets close. Every byte still comes through OrbPage's native policy and transport.
 */
final class OrbPrefetch implements AutoCloseable {
    interface Fetch { byte[] get(String path) throws Exception; }

    /** Fixed dependencies of the orb page, never server-supplied preload URLs. */
    static final String[] PATHS = {"assist/everywhere.html", "assist/orb-size.js", "orb.js", "assist/everywhere.js", "robert-thread-orb.png"};

    private static final ThreadPoolExecutor WORKERS = new ThreadPoolExecutor(5, 5, 30, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(20), r -> { Thread t = new Thread(r, "orb-static"); t.setDaemon(true); return t; });
    private final Map<String, Future<byte[]>> pending = new LinkedHashMap<>();
    private final long deadline;
    private boolean closed;

    OrbPrefetch(String[] paths, long budgetMs, Fetch fetch) {
        deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMs);
        try {
            for (String path : paths) pending.put(path, WORKERS.submit(() -> {
                if (System.nanoTime() >= deadline) throw new TimeoutException("orb prefetch expired");
                return fetch.get(path);
            }));
        } catch (RejectedExecutionException e) { close(); }
    }

    /** The prefetched bytes for path (once), null when it wasn't prefetched; throws if the read failed or expired. */
    byte[] take(String path) throws Exception {
        Future<byte[]> f;
        synchronized (this) {
            if (closed) throw new CancellationException("orb load ended");
            f = pending.remove(path);
        }
        if (f == null) return null; // later reads still use the native policy and transport
        try { return f.get(Math.max(0, deadline - System.nanoTime()), TimeUnit.NANOSECONDS); }
        finally { f.cancel(true); }
    }

    @Override public synchronized void close() {
        closed = true;
        for (Future<byte[]> f : pending.values()) f.cancel(true);
        pending.clear();
        WORKERS.purge();
    }
}
