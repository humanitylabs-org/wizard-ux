package ai.wizards.os.apps;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public class AppsPolicyTest {
    static final String SHA = "fa091c91912c0d56ec3553394fac4158f9a9d178e93bcbb35419601d788cb528";
    static final String KEY = "c6db80a8e14e5230c1de8415ef820d13dc901d8fe33cf3acb57b6862d858a823";
    static final String OTHER = "3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd";
    static final String PKG = "com.beemdevelopment.aegis";
    static final String SELF = "ai.wizards.os";

    static Set<String> set(String... s) { return new HashSet<>(Arrays.asList(s)); }

    @Test
    public void onlyAllowlistedMethods() {
        for (String m : new String[]{"list", "icon", "launch", "openPlay", "appInfo", "uninstall", "install", "status"}) assertTrue(m, AppsPolicy.method(m));
        for (String m : new String[]{"", "exec", "installUrl", "LIST", "evaluate", null}) assertFalse(String.valueOf(m), AppsPolicy.method(m));
    }

    @Test
    public void bytesComeOnlyFromThePinnedPath() {
        assertEquals("https://legacy.wizard.example/android-apps/apk/" + SHA + ".apk", AppsPolicy.apkUrl("https://legacy.wizard.example", SHA));
        assertNull(AppsPolicy.apkUrl("https://legacy.wizard.example", "../../evil"));
        assertNull(AppsPolicy.apkUrl("https://legacy.wizard.example", SHA.toUpperCase()));
        assertNull(AppsPolicy.apkUrl(null, SHA));
    }

    @Test
    public void requestValidation() {
        assertNull(AppsPolicy.checkRequest(SHA, PKG, KEY, SELF));
        assertNull(AppsPolicy.checkRequest(SHA, PKG, "", SELF));
        assertNotNull(AppsPolicy.checkRequest("abc", PKG, KEY, SELF));
        assertNotNull(AppsPolicy.checkRequest(SHA, "not a package", KEY, SELF));
        assertNotNull(AppsPolicy.checkRequest(SHA, SELF, KEY, SELF));
        assertNotNull(AppsPolicy.checkRequest(SHA, "com.android.vending", KEY, SELF));
        assertNotNull(AppsPolicy.checkRequest(SHA, PKG, "zz", SELF));
    }

    @Test
    public void firstInstallChecksHashPackageVersionAndRecordedSigner() {
        assertNull(AppsPolicy.checkFile(SHA, PKG, KEY, 82, SHA, PKG, 82, set(KEY), set(KEY), -1, Collections.emptySet()));
        assertTrue(AppsPolicy.checkFile(SHA, PKG, KEY, 82, OTHER, PKG, 82, set(KEY), set(KEY), -1, Collections.emptySet()).contains("checksum"));
        assertNotNull(AppsPolicy.checkFile(SHA, PKG, KEY, 82, SHA, null, 0, null, null, -1, Collections.emptySet()));
        assertTrue(AppsPolicy.checkFile(SHA, PKG, KEY, 82, SHA, "org.evil", 82, set(KEY), set(KEY), -1, Collections.emptySet()).contains("different app"));
        assertNotNull(AppsPolicy.checkFile(SHA, PKG, KEY, 82, SHA, PKG, 81, set(KEY), set(KEY), -1, Collections.emptySet()));
        assertTrue(AppsPolicy.checkFile(SHA, PKG, KEY, 82, SHA, PKG, 82, set(OTHER), set(OTHER), -1, Collections.emptySet()).contains("key Wizard recorded"));
        assertNotNull(AppsPolicy.checkFile(SHA, PKG, KEY, 82, SHA, PKG, 82, set(KEY, OTHER), set(), -1, Collections.emptySet()));
    }

    @Test
    public void updateNeedsTheInstalledKeyAndANewerVersion() {
        assertNull(AppsPolicy.checkFile(SHA, PKG, "", 0, SHA, PKG, 82, set(KEY), set(KEY), 81, set(KEY)));
        assertTrue(AppsPolicy.checkFile(SHA, PKG, "", 0, SHA, PKG, 82, set(OTHER), set(OTHER), 81, set(KEY)).contains("different key"));
        assertTrue(AppsPolicy.checkFile(SHA, PKG, "", 0, SHA, PKG, 81, set(KEY), set(KEY), 81, set(KEY)).contains("already installed"));
        // Key rotation: the APK's lineage contains the installed key.
        assertNull(AppsPolicy.checkFile(SHA, PKG, "", 0, SHA, PKG, 82, set(OTHER), set(KEY, OTHER), 81, set(KEY)));
    }

    @Test
    public void silentOnlyForOwnedUpdatesOnModernAndroid() {
        assertEquals(2, AppsPolicy.requireUserAction(35, true, true));
        assertEquals(0, AppsPolicy.requireUserAction(35, true, false));
        assertEquals(0, AppsPolicy.requireUserAction(35, false, false));
        assertEquals(0, AppsPolicy.requireUserAction(30, true, true));
        assertTrue(AppsPolicy.requestOwnership(34, false));
        assertFalse(AppsPolicy.requestOwnership(34, true));
        assertFalse(AppsPolicy.requestOwnership(33, false));
    }

    @Test
    public void badgesAndOwnership() {
        assertEquals("Wizard", AppsPolicy.badge(false, SELF, null, SELF));
        assertEquals("Wizard", AppsPolicy.badge(false, "dev.imranr.obtainium", SELF, SELF));
        assertEquals("Play", AppsPolicy.badge(false, "com.android.vending", "com.android.vending", SELF));
        assertEquals("Obtainium", AppsPolicy.badge(false, "dev.imranr.obtainium", null, SELF));
        assertEquals("Other", AppsPolicy.badge(false, "com.android.shell", null, SELF));
        assertEquals("System", AppsPolicy.badge(true, null, null, SELF));
        assertEquals("Play", AppsPolicy.badge(true, "com.android.vending", null, SELF));
        assertTrue(AppsPolicy.autoUpdate(true, true, 81, 82));
        assertFalse(AppsPolicy.autoUpdate(true, false, 81, 82));
        assertFalse(AppsPolicy.autoUpdate(true, true, 82, 82));
        assertFalse(AppsPolicy.autoUpdate(false, true, -1, 82));
    }

    @Test
    public void failuresInPlainWords() {
        assertNull(AppsPolicy.failure(0, null));
        assertTrue(AppsPolicy.failure(5, "x").contains("conflicts"));
        assertTrue(AppsPolicy.failure(1, "boom").contains("boom"));
    }
}
