package ai.wizards.os;

import android.net.Uri;

/** The only origin Wizard OS loads in-app. Pure string checks so they are unit-testable off-device. */
final class Origin {
    static final String HOST = "private.wizard001.com";
    static final String SHELL_PATH = "/wizard-os-home/";
    /** Mizel Live (meeting recorder view): the recording notification deep-links here, inside the app. */
    static final String MIZEL_LIVE_PATH = "/mizel-live/";

    private Origin() {}

    static boolean isPrivate(Uri u) {
        return u != null && isPrivate(u.getScheme(), u.getHost(), u.getPort());
    }

    static boolean isPrivate(String scheme, String host, int port) {
        return "https".equals(scheme) && HOST.equalsIgnoreCase(host) && (port == -1 || port == 443);
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
