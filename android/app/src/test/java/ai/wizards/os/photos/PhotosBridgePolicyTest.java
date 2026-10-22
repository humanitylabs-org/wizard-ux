package ai.wizards.os.photos;

import static org.junit.Assert.*;

import java.util.Iterator;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class PhotosBridgePolicyTest {
    @Test public void onlyAllowlistedMethods() {
        for (String m : new String[]{"status", "setEnabled", "setOption", "connect", "runNow", "permissions", "albums", "setAlbums", "disconnect"}) assertTrue(m, PhotosBridgePolicy.method(m));
        // API-key entry and the native screen stay off the bridge: credentials never reach the page.
        for (String m : new String[]{"", "open", "openNative", "apiKey", "secret", "credentials", "STATUS", "eval", null}) assertFalse(String.valueOf(m), PhotosBridgePolicy.method(m));
    }

    @Test public void requestsMustBeVersionedAndWellFormed() {
        JSONObject ok = PhotosBridgePolicy.request("{\"v\":1,\"id\":\"p1\",\"method\":\"status\"}");
        assertNotNull(ok); assertEquals(0, ok.getJSONObject("params").length());
        assertNotNull(PhotosBridgePolicy.request("{\"v\":1,\"id\":\"p2\",\"method\":\"setEnabled\",\"params\":{\"on\":true}}"));
        assertNull("legacy word is not JSON", PhotosBridgePolicy.request("open"));
        assertNull("future version", PhotosBridgePolicy.request("{\"v\":2,\"id\":\"p1\",\"method\":\"status\"}"));
        assertNull("no version", PhotosBridgePolicy.request("{\"id\":\"p1\",\"method\":\"status\"}"));
        assertNull("no id", PhotosBridgePolicy.request("{\"v\":1,\"method\":\"status\"}"));
        assertNull("unknown method", PhotosBridgePolicy.request("{\"v\":1,\"id\":\"p1\",\"method\":\"apiKey\"}"));
        assertNull("params must be an object", PhotosBridgePolicy.request("{\"v\":1,\"id\":\"p1\",\"method\":\"status\",\"params\":\"x\"}"));
        assertNull(PhotosBridgePolicy.request(null));
        assertNull(PhotosBridgePolicy.request("[]"));
    }

    @Test public void onlyTwoOptionsAreWritable() {
        assertEquals("wifi", PhotosBridgePolicy.option("wifi"));
        assertEquals("charge", PhotosBridgePolicy.option("charge"));
        for (String k : new String[]{"enabled", "server", "credentials", "initial_done", "albums", "", null}) assertNull(PhotosBridgePolicy.option(k));
    }

    @Test public void albumIdsAreBucketNumbersOnly() {
        assertEquals(2, PhotosBridgePolicy.albums(new JSONArray().put("-1739773001").put("540528482")).size());
        for (String bad : new String[]{"camera", "1;DROP", "", "12345678901234567890123"}) {
            try { PhotosBridgePolicy.albums(new JSONArray().put(bad)); fail(bad); } catch (IllegalArgumentException expected) {}
        }
        JSONArray many = new JSONArray(); for (int i = 0; i <= PhotosBridgePolicy.MAX_ALBUMS; i++) many.put(String.valueOf(i));
        try { PhotosBridgePolicy.albums(many); fail(); } catch (IllegalArgumentException expected) {}
    }

    @Test public void onlyTheShellPathDrivesBackup() {
        assertTrue(PhotosBridgePolicy.shellPath("/wizard-os-home"));
        assertTrue(PhotosBridgePolicy.shellPath("/wizard-os-home/index.html"));
        assertFalse(PhotosBridgePolicy.shellPath("/wizard-os-homeevil"));
        assertFalse(PhotosBridgePolicy.shellPath("/files/"));
        assertFalse(PhotosBridgePolicy.shellPath(null));
    }

    @Test public void statusCarriesNoSecrets() throws Exception {
        PhotosBridgePolicy.Snapshot s = new PhotosBridgePolicy.Snapshot();
        s.connected = true; s.enabled = true; s.server = "https://photos.example.org"; s.done = 3; s.total = 9; s.lastSync = 42; s.message = "Up to date"; s.readable = true;
        JSONObject j = PhotosBridgePolicy.status(s);
        assertEquals(1, j.getInt("v"));
        assertTrue(j.getBoolean("needsAccess")); // original-location access missing
        assertEquals("Up to date", j.getString("message"));
        java.util.Set<String> allowed = new java.util.HashSet<>(java.util.Arrays.asList("v", "connected", "enabled", "wifi", "charge", "server", "done", "total", "lastSync", "message", "limited", "signingIn", "access", "needsAccess"));
        for (Iterator<String> it = j.keys(); it.hasNext(); ) { String k = it.next(); assertTrue("unexpected status key " + k, allowed.contains(k)); }
        String text = j.toString().toLowerCase(java.util.Locale.ROOT);
        for (String forbidden : new String[]{"\"key\"", "secret", "credential", "oauth", "verifier", "token", "device"}) assertFalse(forbidden, text.contains(forbidden));
    }

    @Test public void emptyStatusInvitesSignIn() throws Exception {
        JSONObject j = PhotosBridgePolicy.status(new PhotosBridgePolicy.Snapshot());
        assertFalse(j.getBoolean("enabled"));
        assertFalse(j.getBoolean("needsAccess"));
        assertEquals("Turn on backup to sign in with your fingerprint", j.getString("message"));
    }
}
