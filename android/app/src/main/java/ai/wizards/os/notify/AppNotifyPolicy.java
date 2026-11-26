package ai.wizards.os.notify;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Phone notifications per app (wizard-ux issue 1567, switch wizard/phone-app-notifications, off by default): which of
 * the Notifications app's items become native Android notifications, under which app, and what a tap opens. Plain Java
 * (org.json only) so the JVM tests run it; {@link AppNotify} does the Android part.
 *
 * The one notify door is the Notifications app: a sender tags an item {@code app:<id>} (or names it in {@code from}),
 * exactly as the shell's bell attributes it. Every app gets its own Android notification channel
 * ({@code app-<id>}), so the owner can mute Messenger in Android settings and keep Chats and the rest.
 */
public final class AppNotifyPolicy {
    private AppNotifyPolicy() {}

    /** Items the Notifications app files as quiet (cron "All clear", priority 1-2) stay in the list, never on the phone. */
    public static final int MIN_PRIORITY = 3;
    /** At most this many new notifications per pass: a backlog after a long sleep never floods the shade. */
    public static final int MAX_PER_PASS = 5;
    /** Ids already posted, kept so two items with the same time are never posted twice. */
    public static final int KEEP_POSTED = 200;
    /** Items with no app of their own (the agent's notify tool, system notes) belong to Notifications. */
    public static final String DEFAULT_APP = "notifications";
    static final String CHANNEL_PREFIX = "app-";

    private static final Pattern APPID = Pattern.compile("^[a-z0-9][a-z0-9-]{0,63}$");
    private static final Pattern APP_TAG = Pattern.compile("^app:([a-z0-9][a-z0-9-]{0,63})$");

    /** One notification to post. thread: the chat it is a reply in (a Chats item the box posted), else null. */
    public static final class Note {
        public final String id, app, title, text, link, thread;
        public final double time;
        public final int priority;
        Note(String id, String app, String title, String text, String link, double time, int priority, String thread) {
            this.id = id; this.app = app; this.title = title; this.text = text; this.link = link; this.time = time; this.priority = priority;
            this.thread = thread;
        }
    }

    /* Chat replies as Chats notifications (wizard-ux issue 1619, switch wizard/phone-chat-replies): with it on, the box
     * posts an agent's chat reply to Notifications under Chats, tagged chat-reply and linked to its thread
     * (…/wizard-os-home/?session=<id>). Such a note opens that thread like the reply watcher's did, and carries the
     * thread so reading it in Wizard clears it. Only the box posts these, and only for a phone that asked. */
    public static final String CHATS_APP = "chats";
    public static final String CHAT_REPLY_TAG = "chat-reply";
    private static final Pattern SESSION_ID = Pattern.compile("^(?!\\.{1,2}$)[A-Za-z0-9._:-]{1,180}$");
    private static final Pattern SESSION_PARAM = Pattern.compile("[?&]session=([^&#]*)");

    /** The thread a Chats reply item is about (its link's {@code session}), else null. */
    public static String threadOf(JSONObject it) {
        if (it == null || !CHATS_APP.equals(appOf(it)) || !hasTag(it, CHAT_REPLY_TAG)) return null;
        String link = it.optString("link", "");
        if (link.length() > 2000) return null;
        Matcher m = SESSION_PARAM.matcher(link);
        if (!m.find()) return null;
        String id;
        try { id = java.net.URLDecoder.decode(m.group(1), "UTF-8"); } catch (Exception e) { return null; }
        return SESSION_ID.matcher(id).matches() ? id : null;
    }

    /** The result of one read: what to post (newest first) and the new watermark (item time, seconds). */
    public static final class Pass {
        public final List<Note> post;
        public final double since;
        Pass(List<Note> post, double since) { this.post = post; this.since = since; }
    }

    /** The app an item belongs to: its {@code app:<id>} tag, else a valid {@code from}, else Notifications. */
    public static String appOf(JSONObject it) {
        if (it == null) return DEFAULT_APP;
        String direct = it.optString("app", "");
        if (APPID.matcher(direct).matches()) return direct;
        JSONArray tags = it.optJSONArray("tags");
        if (tags != null) for (int i = 0; i < tags.length(); i++) {
            Matcher m = APP_TAG.matcher(tags.optString(i, ""));
            if (m.matches()) return m.group(1);
        }
        String from = it.optString("from", "");
        return APPID.matcher(from).matches() ? from : DEFAULT_APP;
    }

    /* The System kinds the shell's bell knows (notif-bell.js SYSTEM): routed as system:<kind>, Morning Report by default. */
    private static final String[][] SYSTEM = {
        {"app-updates", "^(\\d+ apps? updated|App updates need a look)$"},
        {"connections", "^(App connection added|Connection needs your OK)$"},
        {"wizard-updates", "^(App Manager updated|Wizard ?OS updated|Your release needs you to finish an update)$"},
    };

    static boolean hasTag(JSONObject it, String tag) {
        JSONArray tags = it.optJSONArray("tags");
        if (tags != null) for (int i = 0; i < tags.length(); i++) if (tag.equals(tags.optString(i, ""))) return true;
        return false;
    }

    /** Needs the owner (the bell's needsYou): tagged so, priority 4+, or a title that asks for him. */
    static boolean needsYou(JSONObject it) {
        return hasTag(it, "needs-you") || it.optInt("priority", 3) >= 4
                || Pattern.compile("need(s)? (a look|your OK|you)", Pattern.CASE_INSENSITIVE).matcher(it.optString("title", "")).find();
    }

    /** The source whose level decides an item, as the bell's routeIdOf: its app, a System kind, else Notifications. */
    static String routeOf(JSONObject it) {
        String app = appOf(it);
        if (APPID.matcher(it.optString("app", "")).matches()) return app; // an app's own feed item
        if (needsYou(it)) return DEFAULT_APP; // one that needs the owner keeps following Notifications' level
        if (!DEFAULT_APP.equals(app)) return app;
        String title = it.optString("title", "").trim();
        if (hasTag(it, "wizard-system")) for (String[] k : SYSTEM) if (hasTag(it, k[0])) return "system:" + k[0];
        for (String[] k : SYSTEM) if (Pattern.compile(k[1], Pattern.CASE_INSENSITIVE).matcher(title).matches()) return "system:" + k[0];
        return DEFAULT_APP;
    }

    /**
     * The owner's level for the item's source in Notifications (chats / badge / daily / off). Off and the Morning
     * Report (daily) keep it off the phone too; a System kind with no saved level is in the Morning Report.
     */
    static boolean quiet(JSONObject routes, JSONObject it) {
        String key = routeOf(it);
        String r = routes == null ? "" : routes.optString(key, "");
        if (r.isEmpty() && key.startsWith("system:")) r = "daily";
        return "off".equals(r) || "daily".equals(r);
    }

    /**
     * One pass over the Notifications list. since &lt; 0 means this phone never read it: the watermark jumps to the
     * newest item and nothing is posted, so turning the switch on never replays old items.
     */
    public static Pass pass(JSONArray items, JSONObject routes, double since, Set<String> posted) {
        List<Note> out = new ArrayList<>();
        double top = since;
        if (items == null) return new Pass(out, since);
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            double t = it.optDouble("time", 0);
            if (Double.isNaN(t) || t <= 0) continue;
            if (t > top) top = t;
            if (since < 0 || t <= since) continue;
            String id = it.optString("id", "");
            if (id.isEmpty() || id.length() > 128 || (posted != null && posted.contains(id))) continue;
            if (it.optBoolean("read") || it.optBoolean("archived")) continue;
            int pr = it.optInt("priority", 3);
            if (pr < MIN_PRIORITY) continue;
            String app = appOf(it);
            if (quiet(routes, it)) continue;
            String title = clip(it.optString("title", ""), 120), text = clip(it.optString("message", ""), 400);
            if (title.isEmpty() && text.isEmpty()) continue;
            out.add(new Note(id, app, title, text, it.optString("link", ""), t, pr, threadOf(it)));
        }
        Collections.sort(out, (a, b) -> Double.compare(b.time, a.time));
        if (out.size() > MAX_PER_PASS) out = new ArrayList<>(out.subList(0, MAX_PER_PASS));
        return new Pass(out, Math.max(since < 0 ? 0 : since, top));
    }

    public static String channelId(String app) { return CHANNEL_PREFIX + app; }

    /** The app's own name as the shell knows it (names: {id: name} from the page), else a readable form of the id. */
    public static String channelName(String app, JSONObject names) {
        String n = names == null ? "" : clip(names.optString(app, ""), 40);
        if (!n.isEmpty()) return n;
        if (DEFAULT_APP.equals(app)) return "Notifications";
        String s = app.startsWith("wizard-") && app.length() > 7 ? app.substring(7) : app;
        s = s.replace('-', ' ');
        return s.substring(0, 1).toUpperCase(Locale.ROOT) + s.substring(1);
    }

    /**
     * What a tap opens: the item's own link when it is on this Wizard (a path, or an address on this origin),
     * else the app itself through the shell's {@code ?open=<id>} link. Never another site.
     */
    public static String target(String origin, String link, String app) {
        String o = origin == null ? "" : origin.replaceAll("/+$", "");
        String l = link == null ? "" : link.trim();
        if (!o.isEmpty() && !l.isEmpty() && l.length() <= 2000 && !hasControl(l)) {
            if (l.startsWith("/") && !l.startsWith("//") && !l.startsWith("/\\")) return o + l;
            if (l.equals(o) || l.startsWith(o + "/") || l.startsWith(o + "?") || l.startsWith(o + "#")) return l;
        }
        return o + "/wizard-os-home/?open=" + (APPID.matcher(app == null ? "" : app).matches() ? app : DEFAULT_APP);
    }

    private static boolean hasControl(String s) {
        for (int i = 0; i < s.length(); i++) if (s.charAt(i) < 0x20 || s.charAt(i) == 0x7f) return true;
        return false;
    }

    static String clip(String s, int n) {
        String t = s == null ? "" : s.replaceAll("\\s+", " ").trim();
        return t.length() <= n ? t : t.substring(0, n - 1) + "…";
    }
}
