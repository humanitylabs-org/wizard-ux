package ai.wizards.os.notify;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Clear chat notifications (wizard-ux issue 1276, switch wizard/clear-chat-notifications): which of another chat app's
 * tray notifications belong to a chat the owner just read in Messenger. Plain Java (org.json only) so the JVM tests
 * run it; {@link BridgedNotificationListener} does the Android part.
 *
 * A read is {network, names[]}: the bridged network's id as Messenger names it (line, whatsapp, telegram…) and the
 * chat's names (its title, plus the person's account labels for a direct chat). A notification matches when it was
 * posted by that network's own Android app and its title, conversation title or sub text is one of those names, after
 * {@link #norm}. Nothing else is read, and nothing is kept.
 */
public final class BridgedNotifyPolicy {
    private BridgedNotifyPolicy() {}

    public static final int MAX_NAMES = 8, MAX_NAME = 200;
    private static final Pattern NETWORK = Pattern.compile("^[a-z0-9_-]{1,32}$");
    /** A bridge's network tag at the end of a name: "Mike (WA)", "Mike [LINE]". */
    private static final Pattern TAG = Pattern.compile("\\s*[(\\[][^()\\[\\]]{1,16}[)\\]]\\s*$");
    /** Zero-width and direction marks some apps put around names. */
    private static final Pattern INVISIBLE = Pattern.compile("[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]");
    private static final Pattern SPACE = Pattern.compile("\\s+");

    /** Messenger's network id → the Android apps that post its notifications. */
    static final Map<String, Set<String>> PACKAGES;
    static {
        Map<String, Set<String>> m = new HashMap<>();
        put(m, "line", "jp.naver.line.android", "com.linecorp.linelite");
        put(m, "whatsapp", "com.whatsapp", "com.whatsapp.w4b");
        put(m, "telegram", "org.telegram.messenger", "org.telegram.messenger.web", "org.telegram.plus", "org.thunderdog.challegram");
        put(m, "signal", "org.thoughtcrime.securesms");
        put(m, "instagram", "com.instagram.android");
        put(m, "facebook", "com.facebook.orca", "com.facebook.katana", "com.facebook.mlite");
        put(m, "slack", "com.Slack");
        put(m, "kakaotalk", "com.kakao.talk");
        put(m, "twitter", "com.twitter.android");
        put(m, "linkedin", "com.linkedin.android");
        put(m, "gmessages", "com.google.android.apps.messaging");
        PACKAGES = Collections.unmodifiableMap(m);
    }
    private static void put(Map<String, Set<String>> m, String network, String... pkgs) {
        m.put(network, Collections.unmodifiableSet(new LinkedHashSet<>(java.util.Arrays.asList(pkgs))));
    }

    /** The Android apps of one network; empty for a network we know no app for (Wizard's own chats included). */
    public static Set<String> packagesFor(String network) {
        Set<String> s = network == null ? null : PACKAGES.get(network);
        return s == null ? Collections.emptySet() : s;
    }

    /** One chat read in Messenger. */
    public static final class Read {
        public final String network;
        public final List<String> names; // already normalized, non-empty, distinct
        Read(String network, List<String> names) { this.network = network; this.names = names; }
    }

    /** The shell's {network, names[]} JSON, or null when it is not a usable read (unknown network, no names). */
    public static Read parse(String json) {
        if (json == null || json.length() > 8192) return null;
        try {
            JSONObject o = new JSONObject(json);
            String network = o.optString("network", "");
            if (!NETWORK.matcher(network).matches() || packagesFor(network).isEmpty()) return null;
            JSONArray a = o.optJSONArray("names");
            if (a == null) return null;
            LinkedHashSet<String> names = new LinkedHashSet<>();
            for (int i = 0; i < a.length() && names.size() < MAX_NAMES; i++) {
                Object v = a.opt(i);
                if (!(v instanceof String) || ((String) v).length() > MAX_NAME) continue;
                String n = norm((String) v);
                if (!n.isEmpty()) names.add(n);
            }
            return names.isEmpty() ? null : new Read(network, new ArrayList<>(names));
        } catch (Exception e) { return null; }
    }

    /** A name as both sides can compare it: NFKC, no invisible marks, no bridge tag, one space, lower case. */
    public static String norm(CharSequence s) {
        if (s == null) return "";
        String t = Normalizer.normalize(s.toString(), Normalizer.Form.NFKC);
        t = INVISIBLE.matcher(t).replaceAll("");
        t = SPACE.matcher(t).replaceAll(" ").trim();
        String untagged = TAG.matcher(t).replaceFirst("").trim();
        if (!untagged.isEmpty()) t = untagged;
        return t.toLowerCase(Locale.ROOT);
    }

    /**
     * Only message notifications are cleared: no category, or a message / social one, and never an ongoing one. A call,
     * a missed call or an upload from the same app stays, even when it carries that person's name.
     */
    public static boolean messageLike(String category, boolean ongoing) {
        if (ongoing) return false;
        return category == null || category.isEmpty() || "msg".equals(category) || "social".equals(category);
    }

    /** True when this notification is the network app's notification for the chat that was read. */
    public static boolean matches(Read r, String pkg, CharSequence title, CharSequence conversationTitle, CharSequence subText) {
        if (r == null || pkg == null || !packagesFor(r.network).contains(pkg)) return false;
        for (CharSequence c : new CharSequence[]{conversationTitle, title, subText}) {
            String n = norm(c);
            if (!n.isEmpty() && r.names.contains(n)) return true;
        }
        return false;
    }
}
