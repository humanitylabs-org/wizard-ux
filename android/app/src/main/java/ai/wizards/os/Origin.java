package ai.wizards.os;

import android.net.Uri;

import java.util.List;
import java.util.Locale;

import ai.wizards.os.device.WizardAddress;

/** The origins Wizard OS loads in-app. Pure string checks so they are unit-testable off-device.
 *  host() is this Wizard's own address (device/WizardAddress: the build's private default or what the owner
 *  connected to). Legacy hosts are older names of the same Wizard: still accepted so old links and
 *  notifications keep working, and moved to host(). Nothing matches before the phone is connected. */
final class Origin {
    static final String SHELL_PATH = "/wizard-os-home/";
    /** Mizel Live (meeting recorder view): the recording notification deep-links here, inside the app. */
    static final String MIZEL_LIVE_PATH = "/mizel-live/";

    private Origin() {}

    static String host() { return WizardAddress.host(); }

    static boolean isPrivate(Uri u) {
        return u != null && isPrivate(u.getScheme(), u.getHost(), u.getPort());
    }

    static boolean isPrivate(String scheme, String host, int port) {
        if (!"https".equals(scheme) || host == null || host.isEmpty() || !(port == -1 || port == 443)) return false;
        String home = host();
        return (!home.isEmpty() && home.equalsIgnoreCase(host)) || WizardAddress.isLegacyHost(host);
    }

    static boolean isLegacy(Uri u) {
        return u != null && isLegacy(u.getScheme(), u.getHost(), u.getPort());
    }

    static boolean isLegacy(String scheme, String host, int port) {
        return "https".equals(scheme) && WizardAddress.isLegacyHost(host) && (port == -1 || port == 443);
    }

    /** The same page on this Wizard's own name: a legacy-name URL keeps its path, query and fragment. */
    static String toHome(String url) {
        if (url == null || host().isEmpty()) return url;
        for (String legacy : WizardAddress.legacyHosts()) {
            String rest = restAfter(url, legacy);
            if (rest != null) return "https://" + host() + rest;
        }
        return url;
    }

    /** The same page on the first older name (the fallback when this Wizard's own name cannot be reached). */
    static String toLegacy(String url) {
        List<String> legacy = WizardAddress.legacyHosts();
        if (url == null || legacy.isEmpty() || host().isEmpty()) return url;
        String rest = restAfter(url, host());
        return rest == null ? url : "https://" + legacy.get(0) + rest;
    }

    /** The path/query/fragment of an https URL on exactly {@code host} (port 443 or none), "/"-led; else null. */
    private static String restAfter(String url, String host) {
        String lower = url.toLowerCase(Locale.ROOT);
        String base = "https://" + host.toLowerCase(Locale.ROOT);
        String rest;
        if (lower.startsWith(base + ":443")) rest = url.substring(base.length() + 4);
        else if (lower.startsWith(base)) rest = url.substring(base.length());
        else return null;
        if (!rest.isEmpty() && "/?#".indexOf(rest.charAt(0)) < 0) return null; // <host>.evil.test
        return rest.isEmpty() || rest.charAt(0) != '/' ? "/" + rest : rest;
    }

    static boolean isHome(Uri u) {
        String home = host();
        return u != null && !home.isEmpty() && "https".equals(u.getScheme()) && home.equalsIgnoreCase(u.getHost())
                && (u.getPort() == -1 || u.getPort() == 443);
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
