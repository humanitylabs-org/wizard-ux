package ai.wizards.os.notify;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;

/**
 * Pure rules for per-app phone notifications (no Android types, so the JVM tests cover them).
 *
 * The box's Notifications app is the router: apps send it their inbox feed, it keeps the owner's choice of where each
 * app goes (Chats · Badge · Morning report · Off) and streams only Chats items to this phone as Server-Sent Events
 * over the owner's Tailscale. No Google push (FCM) anywhere.
 */
public final class AppNotifyPolicy {
    private AppNotifyPolicy() {}

    public static final String PROBE_PATH = "/notifications/api/phone";
    public static final String STREAM_PATH = "/notifications/api/phone/stream";
    public static final String EVENTS_PATH = "/notifications/api/phone/events";
    public static final String TAG_PREFIX = "wizapp:";
    public static final String CHANNEL_PREFIX = "wizapp:";
    /** Server pings every 25 s; three missed pings and the connection is treated as dead. */
    public static final int READ_TIMEOUT_MS = 80_000;
    private static final long[] BACKOFF_MS = {1_000, 2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000};

    /** Same shape as the router and the App Manager accept: a lower-case app id. */
    public static boolean validApp(String id) {
        return id != null && id.matches("[a-z0-9][a-z0-9-]{0,63}");
    }

    public static boolean validKey(String key) {
        return key != null && !key.isEmpty() && key.length() <= 200;
    }

    public static boolean validAction(String id) {
        return id != null && id.matches("[a-z0-9_-]{1,40}");
    }

    /** One notification per app item; the tag is what a later clear/update finds. */
    public static String tag(String app, String key) { return TAG_PREFIX + app + ":" + key; }

    public static String channel(String app) { return CHANNEL_PREFIX + app; }

    /** The app id a tag belongs to, or null for a tag that isn't ours. */
    public static String appOfTag(String tag) {
        if (tag == null || !tag.startsWith(TAG_PREFIX)) return null;
        int i = tag.indexOf(':', TAG_PREFIX.length());
        String app = i < 0 ? null : tag.substring(TAG_PREFIX.length(), i);
        return validApp(app) ? app : null;
    }

    /** Wait before reconnect attempt n (0-based): quick at first, at most 5 minutes. */
    public static long backoff(int attempt) {
        return BACKOFF_MS[Math.max(0, Math.min(attempt, BACKOFF_MS.length - 1))];
    }

    public static String streamUrl(String origin, long since, String sid) {
        return origin + STREAM_PATH + query(since, sid);
    }

    public static String eventsUrl(String origin, long since, String sid) {
        return origin + EVENTS_PATH + query(since, sid);
    }

    private static String query(long since, String sid) {
        if (since < 0 || sid == null || sid.isEmpty()) return "";
        try { return "?since=" + since + "&sid=" + URLEncoder.encode(sid, "UTF-8"); }
        catch (UnsupportedEncodingException e) { return ""; }
    }

    /**
     * Where the app lives on the Wizard: its registry path ("/messenger/") when it is a same-origin path, else
     * "/<id>/". Never another origin: the owner's reply only ever goes to the same Wizard.
     */
    public static String appPath(String registryUrl, String app) {
        String u = registryUrl == null ? "" : registryUrl.trim();
        if (u.matches("/[A-Za-z0-9._~-]+(/[A-Za-z0-9._~-]+)*/?") && !u.contains("..")) return u.endsWith("/") ? u : u + "/";
        return "/" + app + "/";
    }

    /** The app's own inbox action route (Wizard OS inbox feed contract), where Reply and Mark as read go. */
    public static String actUrl(String origin, String appPath) { return origin + appPath + "api/inbox/act"; }

    /**
     * Sound/vibrate/heads-up only for newer activity the phone hasn't alerted yet, and not while Wizard OS itself is on
     * screen (the clear that follows reading it would make a flash). Everything else updates quietly.
     */
    public static boolean alert(boolean routerSaysNew, long itemTime, long lastAlerted, boolean wizardOnScreen) {
        return routerSaysNew && itemTime > lastAlerted && !wizardOnScreen;
    }

    /** After a reset snapshot: our notifications whose item is no longer waiting. */
    public static List<String> stale(Collection<String> shownTags, Set<String> activeTags) {
        List<String> out = new ArrayList<>();
        for (String t : shownTags) if (t != null && t.startsWith(TAG_PREFIX) && !activeTags.contains(t)) out.add(t);
        return out;
    }

    /** A readable name when the registry hasn't answered yet: "wizard-mail" → "Wizard mail". */
    public static String fallbackName(String app) {
        if (app == null || app.isEmpty()) return "Wizard";
        String s = app.replace('-', ' ');
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    /** Server-Sent Events, the subset the router sends: id, event, data, comments (pings) and blank-line dispatch. */
    public static final class Sse {
        public static final class Event {
            public final String id, type, data;
            Event(String id, String type, String data) { this.id = id; this.type = type; this.data = data; }
        }
        private String id = null, type = null;
        private final StringBuilder data = new StringBuilder();
        private boolean hasData = false;

        /** Feed one line (without its newline). Returns the event a blank line completes, else null. */
        public Event line(String line) {
            if (line == null) return null;
            if (line.isEmpty()) {
                if (!hasData) { type = null; return null; }
                Event e = new Event(id, type == null ? "message" : type, data.toString());
                type = null; data.setLength(0); hasData = false;
                return e;
            }
            if (line.startsWith(":")) return null;
            int c = line.indexOf(':');
            String field = c < 0 ? line : line.substring(0, c);
            String value = c < 0 ? "" : line.substring(c + 1);
            if (value.startsWith(" ")) value = value.substring(1);
            switch (field) {
                case "id": if (!value.contains("\0")) id = value; break;
                case "event": type = value; break;
                case "data": if (hasData) data.append('\n'); data.append(value); hasData = true; break;
                default: break;
            }
            return null;
        }

        /** The last id seen (SSE keeps it across events). */
        public String lastId() { return id; }
    }
}
