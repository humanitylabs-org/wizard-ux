package ai.wizards.os.apps;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.InstallSourceInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * What is installed. Only apps with a launcher entry are visible (the manifest's &lt;queries&gt; MAIN/LAUNCHER filter;
 * no QUERY_ALL_PACKAGES), plus anything Wizard OS installed itself (installers always see their own installs).
 */
public final class AppsCatalog {
    private AppsCatalog() {}

    /** Every launchable app plus the ones Wizard OS installed, as JSON rows for the view and the server. */
    public static JSONArray list(Context c) {
        PackageManager pm = c.getPackageManager();
        Map<String, JSONObject> out = new LinkedHashMap<>();
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> ris;
        try { ris = pm.queryIntentActivities(main, 0); } catch (RuntimeException e) { ris = java.util.Collections.emptyList(); }
        Set<String> pkgs = new HashSet<>();
        for (ResolveInfo ri : ris) if (ri.activityInfo != null) pkgs.add(ri.activityInfo.packageName);
        pkgs.addAll(AppsInstaller.known(c));
        for (String p : pkgs) {
            if (p.equals(c.getPackageName())) continue;
            JSONObject row = row(c, p);
            if (row != null) out.put(p, row);
        }
        JSONArray a = new JSONArray();
        for (JSONObject o : out.values()) a.put(o);
        return a;
    }

    /** One app (null if not installed / not visible). */
    public static JSONObject row(Context c, String p) {
        PackageManager pm = c.getPackageManager();
        PackageInfo pi;
        try { pi = pm.getPackageInfo(p, 0); } catch (PackageManager.NameNotFoundException e) { return null; }
        ApplicationInfo ai = pi.applicationInfo;
        if (ai == null) return null;
        String[] src = source(c, p);
        boolean system = (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
        try {
            JSONObject o = new JSONObject()
                    .put("package", p)
                    .put("label", String.valueOf(pm.getApplicationLabel(ai)))
                    .put("versionName", pi.versionName == null ? "" : pi.versionName)
                    .put("versionCode", pi.getLongVersionCode())
                    .put("system", system)
                    .put("updatedSystem", (ai.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0)
                    .put("enabled", ai.enabled)
                    .put("launchable", pm.getLaunchIntentForPackage(p) != null)
                    .put("firstInstall", pi.firstInstallTime)
                    .put("lastUpdate", pi.lastUpdateTime)
                    .put("badge", AppsPolicy.badge(system, src[0], src[1], c.getPackageName()))
                    .put("owned", AppsPolicy.owned(src[0], src[1], c.getPackageName()));
            if (src[0] != null) o.put("installer", src[0]);
            if (src[1] != null) o.put("owner", src[1]);
            return o;
        } catch (JSONException e) { return null; }
    }

    /** [installer of record, update owner (API 34+)]. */
    @SuppressWarnings("deprecation")
    public static String[] source(Context c, String p) {
        PackageManager pm = c.getPackageManager();
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                InstallSourceInfo s = pm.getInstallSourceInfo(p);
                String owner = Build.VERSION.SDK_INT >= 34 ? s.getUpdateOwnerPackageName() : null;
                return new String[]{s.getInstallingPackageName(), owner};
            }
            return new String[]{pm.getInstallerPackageName(p), null};
        } catch (PackageManager.NameNotFoundException | RuntimeException e) { return new String[]{null, null}; }
    }

    /** Launcher icon as a small PNG data URL (null if none). */
    public static String icon(Context c, String p, int px) {
        try {
            Drawable d = c.getPackageManager().getApplicationIcon(p);
            int s = Math.max(24, Math.min(192, px));
            Bitmap b = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
            Canvas cv = new Canvas(b);
            d.setBounds(0, 0, s, s);
            d.draw(cv);
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            b.compress(Bitmap.CompressFormat.PNG, 100, o);
            b.recycle();
            return "data:image/png;base64," + Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP);
        } catch (PackageManager.NameNotFoundException | RuntimeException e) { return null; }
    }

    /** Installed versionCode, or -1. */
    public static long installedVc(Context c, String p) {
        try { return c.getPackageManager().getPackageInfo(p, 0).getLongVersionCode(); }
        catch (PackageManager.NameNotFoundException e) { return -1; }
    }

    public static Set<String> installedSigners(Context c, String p) {
        try { return signers(c.getPackageManager().getPackageInfo(p, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo, false); }
        catch (PackageManager.NameNotFoundException e) { return new HashSet<>(); }
    }

    /** SHA-256 of each current signer, or (history=true) of each certificate in the rotation lineage. */
    public static Set<String> signers(SigningInfo s, boolean history) {
        Set<String> out = new HashSet<>();
        if (s == null) return out;
        Signature[] sigs;
        if (history) sigs = s.hasMultipleSigners() ? null : s.getSigningCertificateHistory();
        else sigs = s.getApkContentsSigners();
        if (sigs == null) return out;
        for (Signature g : sigs) {
            try { out.add(hex(MessageDigest.getInstance("SHA-256").digest(g.toByteArray()))); }
            catch (NoSuchAlgorithmException ignored) { }
        }
        return out;
    }

    static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format(Locale.ROOT, "%02x", x));
        return s.toString();
    }
}
