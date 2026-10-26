package ai.wizards.os.apps;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Android Apps: every decision about a third-party install, as pure functions (unit-tested off-device).
 *
 * The page never names a URL: an install names the SHA-256 of a build the Android Apps server pinned, and the APK
 * is fetched only from {origin}/android-apps/apk/{sha256}.apk. The file must hash to that value, be the named package,
 * be newer than what is installed, and carry the installed app's signing key (and the key the server recorded, when
 * given). Only then does Android's installer see it.
 */
public final class AppsPolicy {
    private AppsPolicy() {}

    /** Methods the shell relay may forward from the Android Apps view (and nothing else). */
    public static final Set<String> METHODS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            "list", "icon", "launch", "openPlay", "appInfo", "uninstall", "install", "status", "scheduleUpdates")));

    public static final String APK_PATH = "/android-apps/apk/";
    public static final long MAX_BYTES = 250L * 1024 * 1024;
    static final Pattern HEX64 = Pattern.compile("[0-9a-f]{64}");
    static final Pattern PKG = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+");
    /** Android's own installer + Wizard OS itself: never through this path. */
    static final Set<String> NEVER = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            "ai.wizards.os", "ai.wizards.os.qa", "com.android.vending", "com.google.android.packageinstaller",
            "com.android.packageinstaller", "com.google.android.gms")));

    public static boolean method(String m) { return m != null && METHODS.contains(m); }
    public static boolean sha(String s) { return s != null && HEX64.matcher(s).matches(); }
    public static boolean pkg(String p) { return p != null && p.length() <= 200 && PKG.matcher(p).matches(); }

    /** Where an install's bytes come from: only the private origin's pinned-APK path. */
    public static String apkUrl(String origin, String sha256) {
        if (origin == null || !sha(sha256)) return null;
        return origin + APK_PATH + sha256 + ".apk";
    }

    /** Plain-words reason the request itself is unacceptable, or null. */
    public static String checkRequest(String sha256, String pkg, String expectedSigner, String self) {
        if (!sha(sha256)) return "That install request has no valid checksum";
        if (!pkg(pkg)) return "That install request names no app";
        if (NEVER.contains(pkg) || pkg.equals(self)) return "Wizard OS doesn’t install that app here";
        if (expectedSigner != null && !expectedSigner.isEmpty() && !sha(expectedSigner)) return "That install request has a malformed signer";
        return null;
    }

    /**
     * The downloaded file against the request and the phone. null = OK to hand to Android's installer.
     *
     * @param fileSha       SHA-256 of the downloaded bytes
     * @param apkPkg        package name read from the APK (null: not an APK)
     * @param apkVc         versionCode read from the APK
     * @param apkSigners    SHA-256 of each current signer of the APK
     * @param apkHistory    SHA-256 of the APK's signing lineage (key rotation), may be empty
     * @param installedVc   versionCode installed now, or -1 if not installed
     * @param installedSigners current signers of the installed app (empty if not installed)
     * @param wantVc        versionCode the server pinned (0 = not given)
     */
    public static String checkFile(String wantSha, String wantPkg, String expectedSigner, long wantVc,
                                   String fileSha, String apkPkg, long apkVc, Set<String> apkSigners, Set<String> apkHistory,
                                   long installedVc, Set<String> installedSigners) {
        if (fileSha == null || !fileSha.equals(wantSha)) return "The download doesn’t match its checksum, so it wasn’t installed";
        if (apkPkg == null) return "The download isn’t an Android app";
        if (!apkPkg.equals(wantPkg)) return "The download is a different app (" + apkPkg + ")";
        if (wantVc > 0 && apkVc != wantVc) return "The download isn’t the version Wizard checked";
        if (apkSigners == null || apkSigners.isEmpty()) return "The download isn’t signed";
        if (expectedSigner != null && !expectedSigner.isEmpty() && !(apkSigners.size() == 1 && apkSigners.contains(expectedSigner)))
            return "The download isn’t signed by the key Wizard recorded for this app";
        if (installedVc >= 0) {
            if (apkVc <= installedVc) return "That version is already installed (or newer)";
            if (!sameKey(installedSigners, apkSigners, apkHistory))
                return "The download is signed by a different key than the installed app, so it wasn’t installed";
        }
        return null;
    }

    /** Same signing key as installed: equal current signer sets, or (single signer) the installed key is in the APK's rotation lineage. */
    public static boolean sameKey(Set<String> installed, Set<String> apk, Set<String> apkHistory) {
        if (installed == null || installed.isEmpty() || apk == null || apk.isEmpty()) return false;
        if (installed.equals(apk)) return true;
        return installed.size() == 1 && apk.size() == 1 && apkHistory != null && apkHistory.containsAll(installed);
    }

    /** PackageInstaller USER_ACTION_*: 2 NOT_REQUIRED (Wizard owns the installed app), 0 UNSPECIFIED otherwise. API 31+ only. */
    public static int requireUserAction(int sdk, boolean installed, boolean ownedBySelf) {
        if (sdk < 31) return 0;
        return installed && ownedBySelf ? 2 : 0;
    }

    /** Ask Android to make Wizard OS the update owner (API 34+) on a first install, so other stores can't update it silently. */
    public static boolean requestOwnership(int sdk, boolean installed) { return sdk >= 34 && !installed; }

    /** Wizard OS is this app's installer of record or update owner. */
    public static boolean owned(String installer, String updateOwner, String self) {
        return self != null && (self.equals(installer) || self.equals(updateOwner));
    }

    /** Callers before message v1 (shell relay without {v}) relied on list scheduling the update job; v1 asks with scheduleUpdates. */
    public static boolean scheduleOnList(int v) { return v < 1; }

    /** Background update job: install this update silently? */
    public static boolean autoUpdate(boolean installed, boolean owned, long installedVc, long offeredVc) {
        return installed && owned && offeredVc > installedVc && installedVc >= 0;
    }

    /** PackageInstaller.STATUS_* → plain words (null on success). */
    public static String failure(int status, String msg) {
        switch (status) {
            case 0: return null;
            case 3: return "Install cancelled";
            case 4: return "Android refused the app (storage or a damaged file)";
            case 5: return "It conflicts with an app already installed (different signer?)";
            case 6: return "Not enough storage";
            case 7: return "This app doesn’t run on this phone";
            case 2: return "Android blocked the install";
            default: return "Install failed" + (msg != null && !msg.isEmpty() ? " (" + msg + ")" : "");
        }
    }
}
