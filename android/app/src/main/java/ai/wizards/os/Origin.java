package ai.wizards.os;

import android.content.Context;
import android.net.Uri;

/** The selected Wizard only; never a process-global cached build-time host. */
final class Origin {
    static final String SHELL_PATH = "/wizard-os-home/";
    static final String MIZEL_LIVE_PATH = "/mizel-live/";
    private Origin() {}
    static boolean isPrivate(Context c, Uri u) {
        return u != null && ServerOrigin.matches(ai.wizards.os.device.AppState.primaryOrigin(c), u.toString());
    }
    static boolean isHome(Context c, Uri u) { return isPrivate(c, u); }
    static boolean isShell(Context c, Uri u) {
        return isPrivate(c, u) && u.getPath() != null && isShellPath(u.getPath());
    }
    static boolean isShellPath(String path) {
        return path != null && (path.equals("/wizard-os-home") || path.startsWith(SHELL_PATH));
    }
    static boolean isInApp(Context c, Uri u) {
        return isPrivate(c, u) && u.getPath() != null && isInAppPath(u.getPath());
    }
    static boolean isInAppPath(String path) {
        return isShellPath(path) || (path != null && (path.equals("/mizel-live") || path.startsWith(MIZEL_LIVE_PATH)));
    }
}
