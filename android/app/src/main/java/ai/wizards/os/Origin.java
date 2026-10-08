package ai.wizards.os;

import android.net.Uri;

/** The only origin Wizard OS loads in-app. Pure string checks so they are unit-testable off-device. */
final class Origin {
    static final String HOST = "private.wizard001.com";
    static final String SHELL_PATH = "/wizard-os-home/";

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
}
