package ai.wizards.os.update;

import org.json.JSONObject;

import java.net.URI;
import java.util.Locale;
import java.util.Set;

/** Pure rules for the in-app update feed and the hands-free installer (unit-tested off-device). */
public final class UpdatePolicy {
    private UpdatePolicy() {}

    public static final class Release {
        public final int versionCode;
        public final String versionName, url, sha256, notes, app, signer;
        public final long bytes;

        Release(int versionCode, String versionName, String url, String sha256, long bytes, String notes, String app, String signer) {
            this.versionCode = versionCode; this.versionName = versionName; this.url = url; this.sha256 = sha256;
            this.bytes = bytes; this.notes = notes; this.app = app; this.signer = signer;
        }
    }

    /**
     * latest.json → Release, or null when malformed. The APK must come from the same origin as the feed
     * (https, or the QA build's plain-http fake on the emulator host), and carry a full SHA-256. The optional
     * "app" and "signer" fields are kept so the updater can refuse a feed meant for another app or key.
     */
    public static Release parse(JSONObject o, String feedUrl) {
        if (o == null) return null;
        int vc = o.optInt("versionCode", 0);
        String name = o.optString("versionName", o.optString("version", ""));
        String sha = o.optString("sha256", "").toLowerCase(Locale.ROOT);
        String url = o.optString("url", "");
        long bytes = o.optLong("bytes", o.optLong("size", 0));
        String signer = o.optString("signer", "").toLowerCase(Locale.ROOT).replace(":", "");
        if (vc <= 0 || name.isEmpty() || !sha.matches("[0-9a-f]{64}") || url.isEmpty()) return null;
        if (!signer.isEmpty() && !signer.matches("[0-9a-f]{64}")) return null;
        String abs = resolve(feedUrl, url);
        if (abs == null || !sameOrigin(feedUrl, abs)) return null;
        return new Release(vc, name, abs, sha, bytes, o.optString("notes", ""), o.optString("app", ""), signer);
    }

    public static boolean newer(Release r, int installed) { return r != null && r.versionCode > installed; }

    static String resolve(String base, String ref) {
        try { return URI.create(base).resolve(ref).toString(); } catch (RuntimeException e) { return null; }
    }

    static boolean sameOrigin(String a, String b) {
        try {
            URI x = URI.create(a), y = URI.create(b);
            String sx = x.getScheme(), sy = y.getScheme();
            if (sx == null || !sx.equals(sy) || !("https".equals(sx) || "http".equals(sx))) return false;
            return x.getHost() != null && x.getHost().equalsIgnoreCase(y.getHost()) && port(x) == port(y);
        } catch (RuntimeException e) { return false; }
    }

    private static int port(URI u) { return u.getPort() != -1 ? u.getPort() : "https".equals(u.getScheme()) ? 443 : 80; }

    /** Every certificate of the installed app must sign the update, and nothing else (no added or rotated keys). */
    public static boolean sameSigners(Set<String> installed, Set<String> update) {
        return installed != null && update != null && !installed.isEmpty() && installed.equals(update);
    }

    /**
     * The update's signer set must be exactly {pinned} (the Wizard OS release key, or the debug key for QA builds),
     * equal to the installed app's set, and agree with the feed's "signer" when the feed names one.
     */
    public static boolean signerOk(Set<String> installed, Set<String> update, String pinned, String feedSigner) {
        if (pinned == null || !pinned.matches("[0-9a-f]{64}")) return false;
        if (!sameSigners(installed, update)) return false;
        if (update.size() != 1 || !update.contains(pinned)) return false;
        return feedSigner == null || feedSigner.isEmpty() || feedSigner.equals(pinned);
    }

    /** The feed's optional "app" names the package it is for (ai.wizards.os, or ai.wizards.os.qa for QA builds). */
    public static boolean appOk(String feedApp, String pkg) {
        return feedApp == null || feedApp.isEmpty() || feedApp.equals(pkg);
    }

    /* ------------------------------------------------------------------ hands-free install decisions */

    /** What to do with a newer release, given where it is and what the phone is doing. */
    public enum Step {
        /** Nothing newer (or nothing to act on). */
        NONE,
        /** Newer, not on the phone yet, but only on a metered network and nobody asked: show the banner only. */
        OFFER,
        /** Fetch it now (unmetered, or James tapped). */
        DOWNLOAD,
        /** Downloaded + verified while Wizard OS is in front: one "Update ready · tap to restart" banner. */
        BANNER,
        /** Install now (Wizard OS in the background, or James tapped). */
        INSTALL,
        /** A recording is running: never interrupt it, try again when it ends. */
        DEFER,
        /** Android has not allowed Wizard OS to install apps yet and James isn't here to allow it: wait for him. */
        WAIT_PERMISSION,
    }

    /**
     * @param newer      the feed names a higher versionCode than this app
     * @param verified   that APK is on the phone and passed every check
     * @param unmetered  the active network is unmetered (Wi-Fi)
     * @param front      Wizard OS is on screen
     * @param recording  any Wizard OS recording is running (native recorder, orb, floating orb, side button)
     * @param silentOk   Android will install without asking (API 31+, "Install unknown apps" allowed, and Wizard OS
     *                   installed the version that is running now)
     * @param tapped     James tapped Update / the ready banner
     */
    public static Step next(boolean newer, boolean verified, boolean unmetered, boolean front, boolean recording,
                            boolean silentOk, boolean tapped) {
        if (!newer) return Step.NONE;
        if (!verified) return (unmetered || tapped) ? Step.DOWNLOAD : Step.OFFER;
        if (recording) return Step.DEFER;
        if (tapped) return Step.INSTALL;               // permission is asked for in place, with James looking
        if (front) return Step.BANNER;                 // never restart the app under James's fingers
        if (!silentOk) return Step.WAIT_PERMISSION;    // a background commit would only raise Android's dialog later
        return Step.INSTALL;
    }

    /** SessionParams.setRequireUserAction value: USER_ACTION_NOT_REQUIRED (2) on API 31+, else none (0 = unspecified). */
    public static int requireUserAction(int sdk) { return sdk >= 31 ? 2 : 0; }

    /** Seconds Wizard OS waits after leaving the screen before restarting itself into a ready update. */
    public static final long BACKGROUND_GRACE_MS = 15_000L;

    /**
     * PackageInstaller.STATUS_* → plain words for the banner, or null for success / pending user action.
     * Codes (stable platform constants): 0 success, -1 pending user action, 1 failure, 2 blocked, 3 aborted,
     * 4 invalid, 5 conflict, 6 storage, 7 incompatible, 8 timeout.
     */
    public static String failureMessage(int status, String detail) {
        String m;
        switch (status) {
            case 0: case -1: return null;
            case 2: m = "Android blocked the update"; break;
            case 3: m = "Update cancelled · tap to try again"; break;
            case 4: m = "The update file is invalid"; break;
            case 5: m = "The update conflicts with the installed app"; break;
            case 6: m = "Not enough storage for the update"; break;
            case 7: m = "The update isn’t compatible with this phone"; break;
            case 8: m = "The update timed out · tap to try again"; break;
            default: m = "Update failed"; break;
        }
        if (detail != null && !detail.trim().isEmpty()) {
            String d = detail.trim();
            if (d.length() > 120) d = d.substring(0, 120) + "…";
            m += " (" + d + ")";
        }
        return m;
    }

    /** Background nudges (the "ready · tap to install" notification) go out once per version, unless James asked. */
    public static boolean mayPromptAgain(int lastPromptedVersionCode, int versionCode, boolean tapped) {
        return tapped || lastPromptedVersionCode != versionCode;
    }
}
