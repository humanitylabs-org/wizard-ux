package ai.wizards.os.notify;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Box-to-phone push for app notifications (wizard-ux issue 1618, switch wizard/phone-push, off by default): the plain
 * Java half, so the JVM tests run the exact stream reader the phone runs ({@link AppPush} does the Android part).
 *
 * The box's Notifications app serves one wake-up line, {@code GET /notifications/api/phone/inbox} (Server-Sent
 * Events): {@code hello} on connect, {@code inbox {id, time}} the moment an item is published, {@code : ping} every
 * 50 s while quiet. It carries no words: each hello or inbox only asks the phone to run its existing reader
 * ({@link AppNotify#pollOnce}) once, so the per-app channels, Off and quiet items and the no-replay watermark stay
 * exactly as they are. Nothing goes through Google: the connection is the phone's own, over the owner's Tailscale.
 */
public final class AppPushPolicy {
    private AppPushPolicy() {}

    public static final String PATH = "/notifications/api/phone/inbox";
    /** The box pings every 50 s; three missed pings mean the line is dead (Wi-Fi changed, box restarted). */
    public static final int READ_TIMEOUT_MS = 150_000;
    public static final int CONNECT_TIMEOUT_MS = 10_000;
    /** A Notifications without the line (older version, 404) is asked again this much later; the 30 s reads go on. */
    public static final long MISSING_RETRY_MS = 15 * 60_000L;

    /** What the phone listens to on this Wizard. */
    public static String url(String origin) {
        return (origin == null ? "" : origin.replaceAll("/+$", "")) + PATH;
    }

    /** Wait before reconnect attempt n (0 = the first retry): 1 s, 2 s, 4 s … at most a minute. */
    public static long backoffMs(int attempt) {
        int n = Math.max(0, Math.min(attempt, 6));
        return Math.min(60_000L, 1000L << n);
    }

    /** One line of the event stream. */
    public interface Listener {
        /** The box says: read Notifications now (connected, or a new item). */
        void read(String why);
    }

    /**
     * Server-Sent Events reader for the wake-up line: an event ends at a blank line; {@code hello} and {@code inbox}
     * ask for one read, anything else (pings, comments, unknown events from a newer box) is ignored.
     */
    public static final class Parser {
        private String event = "";
        private boolean data;

        /** Feed one line (without its line end). Returns the event to act on ("hello" / "inbox") or null. */
        public String line(String l) {
            if (l == null) return null;
            if (l.isEmpty()) {
                String e = event.isEmpty() ? "message" : event;
                boolean had = data;
                event = ""; data = false;
                return had && ("hello".equals(e) || "inbox".equals(e)) ? e : null;
            }
            if (l.startsWith(":")) return null;
            int i = l.indexOf(':');
            String k = i < 0 ? l : l.substring(0, i);
            if ("event".equals(k)) event = (i < 0 ? "" : l.substring(i + 1)).trim();
            else if ("data".equals(k)) data = true;
            return null;
        }
    }

    /** Why a connection ended. */
    public static final class Ended extends IOException {
        public final int status;
        public Ended(int status, String m) { super(m); this.status = status; }
    }

    /** Something that says whether to keep listening (the switch is still on, the service still runs). */
    public interface Keep {
        boolean on();
        /** The open connection, so a stop can close it at once instead of waiting for the next line. */
        default void opened(HttpURLConnection c) {}
    }

    /**
     * Hold one connection until it drops, the box refuses it, or {@code keep} says stop. Every hello / inbox calls
     * {@code l.read}. Returns normally when it was stopped; throws {@link Ended} (with the HTTP status, 0 for a
     * network error) otherwise. headers: name, value pairs (the Origin the box expects).
     */
    public static void listen(String url, Keep keep, Listener l, String... headers) throws Ended {
        if (!keep.on()) return;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            keep.opened(c);
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setUseCaches(false);
            c.setRequestProperty("Accept", "text/event-stream");
            c.setRequestProperty("Cache-Control", "no-store");
            for (int i = 0; i + 1 < headers.length; i += 2) if (headers[i + 1] != null) c.setRequestProperty(headers[i], headers[i + 1]);
            int code = c.getResponseCode();
            String type = c.getContentType() == null ? "" : c.getContentType();
            if (code != 200 || !type.startsWith("text/event-stream")) throw new Ended(code, "HTTP " + code + " " + type);
            Parser p = new Parser();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8), 1024)) {
                String line;
                while (keep.on() && (line = r.readLine()) != null) {
                    String e = p.line(line);
                    if (e != null) l.read(e);
                }
            }
            if (!keep.on()) return;
            throw new Ended(0, "the box closed the line");
        } catch (Ended e) {
            if (!keep.on()) return;
            throw e;
        } catch (IOException | RuntimeException e) {
            if (!keep.on()) return;
            throw new Ended(0, String.valueOf(e));
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
