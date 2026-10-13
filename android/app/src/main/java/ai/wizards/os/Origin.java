package ai.wizards.os;

import android.net.Uri;

import java.util.Locale;

/** The origins Wizard OS loads in-app. Pure string checks so they are unit-testable off-device.
 *  HOST is this Wizard's own address (its tailnet name, from BuildConfig.ORIGIN). LEGACY_HOST is the retired
 *  legacy.wizard.example: still accepted so old links and notifications keep working, and moved to HOST. */
final class Origin {
    static final String HOST = BuildConfig.ORIGIN.replaceFirst("^https://", "").replaceAll("/+$", "");
    static final String LEGACY_HOST = "legacy.wizard.example";
    static final String SHELL_PATH = "/wizard-os-home/";
    /** Mizel Live (meeting recorder view): the recording notification deep-links here, inside the app. */
    static final String MIZEL_LIVE_PATH = "/mizel-live/";

    private Origin() {}

    static boolean isPrivate(Uri u) {
        return u != null && isPrivate(u.getScheme(), u.getHost(), u.getPort());
    }

    static boolean isPrivate(String scheme, String host, int port) {
        return "https".equals(scheme) && host != null && (HOST.equalsIgnoreCase(host) || LEGACY_HOST.equalsIgnoreCase(host))
                && (port == -1 || port == 443);
    }

    static boolean isLegacy(Uri u) {
        return u != null && isLegacy(u.getScheme(), u.getHost(), u.getPort());
    }

    static boolean isLegacy(String scheme, String host, int port) {
        return "https".equals(scheme) && LEGACY_HOST.equalsIgnoreCase(host) && (port == -1 || port == 443);
    }

    /** The same page on this Wizard's own name: a legacy-name URL keeps its path, query and fragment. */
    static String toHome(String url) {
        if (url == null) return null;
        String lower = url.toLowerCase(Locale.ROOT);
        String legacy = "https://" + LEGACY_HOST;
        String rest;
        if (lower.startsWith(legacy + ":443")) rest = url.substring(legacy.length() + 4);
        else if (lower.startsWith(legacy)) rest = url.substring(legacy.length());
        else return url;
        if (!rest.isEmpty() && "/?#".indexOf(rest.charAt(0)) < 0) return url; // legacy.wizard.example.evil.test
        return "https://" + HOST + (rest.isEmpty() || rest.charAt(0) != '/' ? "/" + rest : rest);
    }

    /** The same page on the retired name (the fallback when the tailnet name cannot be reached). */
    static String toLegacy(String url) {
        if (url == null) return null;
        String lower = url.toLowerCase(Locale.ROOT);
        String home = "https://" + HOST.toLowerCase(Locale.ROOT);
        String rest;
        if (lower.startsWith(home + ":443")) rest = url.substring(home.length() + 4);
        else if (lower.startsWith(home)) rest = url.substring(home.length());
        else return url;
        if (!rest.isEmpty() && "/?#".indexOf(rest.charAt(0)) < 0) return url;
        return "https://" + LEGACY_HOST + (rest.isEmpty() || rest.charAt(0) != '/' ? "/" + rest : rest);
    }

    static boolean isHome(Uri u) {
        return u != null && "https".equals(u.getScheme()) && HOST.equalsIgnoreCase(u.getHost()) && (u.getPort() == -1 || u.getPort() == 443);
    }

    static boolean isShell(Uri u) {
        return isPrivate(u) && u.getPath() != null && isShellPath(u.getPath());
    }

    static boolean isShellPath(String path) {
        return path.equals("/wizard-os-home") || path.startsWith(SHELL_PATH);
    }

    /** Private-origin pages Wizard OS opens in its own window when a link or notification asks for them. */
    static boolean isInApp(Uri u) {
        return isPrivate(u) && u.getPath() != null && isInAppPath(u.getPath());
    }

    static boolean isInAppPath(String path) {
        return isShellPath(path) || path.equals("/mizel-live") || path.startsWith(MIZEL_LIVE_PATH);
    }
}
