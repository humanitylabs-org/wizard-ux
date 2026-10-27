package ai.wizards.shell;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Pure rules for the Wizards this phone has connected to, newest first, so the connect screen can switch with one
 * tap. Only origins are kept (one per line); every entry passes {@link ShellOrigin#parse} on the way in and out, so a
 * damaged or edited list can never add an address Connect itself would refuse. Unit-tested off-device.
 */
public final class SavedWizards {
    /** SharedPreferences key (in {@link ShellOrigin#PREFS}) for the list. */
    public static final String KEY = "wizards";
    /** The most Wizards remembered; the oldest drops off. */
    public static final int MAX = 10;

    private SavedWizards() {}

    /** The stored list, cleaned: valid normalised origins only, no repeats, newest first, at most {@link #MAX}. */
    public static List<String> decode(String stored) {
        List<String> out = new ArrayList<>();
        if (stored == null) return out;
        for (String line : stored.split("\n")) {
            String o = ShellOrigin.parse(line);
            if (o != null && !out.contains(o) && out.size() < MAX) out.add(o);
        }
        return out;
    }

    public static String encode(List<String> list) {
        return String.join("\n", decode(String.join("\n", list)));
    }

    /** A successful connection: the Wizard moves to (or joins at) the top; null when the address is not valid. */
    public static List<String> remember(List<String> list, String origin) {
        String o = ShellOrigin.parse(origin);
        if (o == null) return null;
        List<String> out = new ArrayList<>();
        out.add(o);
        for (String s : list) if (!s.equals(o) && out.size() < MAX) out.add(s);
        return out;
    }

    /** The list without that Wizard (only the list: its takes and shortcuts stay with it). */
    public static List<String> forget(List<String> list, String origin) {
        String o = ShellOrigin.parse(origin);
        List<String> out = new ArrayList<>(list);
        if (o != null) out.remove(o);
        return out;
    }

    /** True when the origin is one this phone has connected to (a launcher shortcut may only switch to these). */
    public static boolean known(List<String> list, String origin) {
        String o = ShellOrigin.parse(origin);
        return o != null && list.contains(o);
    }

    /** Up to {@code n} saved Wizards other than the current one, newest first (the launcher's quick switches). */
    public static List<String> others(List<String> list, String current, int n) {
        List<String> out = new ArrayList<>();
        for (String s : list) if (!s.equals(current) && out.size() < n) out.add(s);
        return Collections.unmodifiableList(out);
    }

    /**
     * A short name for a Wizard: the first part of its host ({@code https://demo-5.example.ts.net} → {@code demo-5}),
     * the whole host for an IP address or a one-word host, plus a non-default port ({@code wizard:8444}).
     */
    public static String label(String origin) {
        String o = ShellOrigin.parse(origin);
        if (o == null) return "";
        String hostPort = o.substring("https://".length());
        int colon = hostPort.lastIndexOf(':');
        String host = hostPort, port = "";
        if (colon > 0 && !hostPort.endsWith("]")) {
            host = hostPort.substring(0, colon);
            port = hostPort.substring(colon);
        }
        boolean ip = host.startsWith("[") || host.matches("[0-9.]+");
        int dot = host.indexOf('.');
        String name = ip || dot <= 0 ? host : host.substring(0, dot);
        return name.toLowerCase(Locale.ROOT) + port;
    }
}
