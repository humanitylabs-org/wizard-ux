package ai.wizards.os;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.*;

/** One document load's memory-only speculative reads. Never shared across hosts, owners or generations.
 * The global worker/queue bounds also apply when hosts detach/retry faster than sockets can close. */
final class OverlayPrefetch implements AutoCloseable {
    interface Fetch { byte[] get(String path) throws Exception; }
    private static final ThreadPoolExecutor WORKERS = new ThreadPoolExecutor(6, 6, 30, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(24), r -> { Thread t = new Thread(r, "overlay-static"); t.setDaemon(true); return t; });
    private final Map<String, Future<byte[]>> pending = new LinkedHashMap<>();
    private final long deadline;
    private boolean closed;

    OverlayPrefetch(String[] paths, long budgetMs, Fetch fetch) {
        deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMs);
        try {
            for (String path : paths) pending.put(path, WORKERS.submit(() -> {
                if (System.nanoTime() >= deadline) throw new TimeoutException("overlay prefetch expired");
                return fetch.get(path);
            }));
        } catch (RejectedExecutionException e) { close(); }
    }
    byte[] take(String path) throws Exception {
        Future<byte[]> f;
        synchronized (this) {
            if (closed) throw new CancellationException("overlay load ended");
            f = pending.remove(path);
        }
        if (f == null) return null; // later dynamic reads must still use native policy/transport
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
