package ai.wizards.os.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.HashSet;

public class UpdatePolicyTest {
    static final String FEED = "https://private.wizard001.com/reports/wizard-os/latest.json";
    static final String SHA = "864663a75a0dd19a134da46fea51931571d1fb03e7e50b0c05d089344039d771";

    @Test
    public void parsesRelativeApkOnTheFeedOrigin() throws Exception {
        UpdatePolicy.Release r = UpdatePolicy.parse(new JSONObject().put("versionCode", 6).put("versionName", "0.5.1")
                .put("url", "wizard-os-0.5.1.apk").put("sha256", SHA).put("bytes", 437029), FEED);
        assertNotNull(r);
        assertEquals("https://private.wizard001.com/reports/wizard-os/wizard-os-0.5.1.apk", r.url);
        assertEquals(6, r.versionCode);
        assertFalse(UpdatePolicy.newer(r, 6));
        assertTrue(UpdatePolicy.newer(r, 5));
    }

    @Test
    public void rejectsForeignOriginsBadHashesAndDowngrades() throws Exception {
        assertNull(UpdatePolicy.parse(new JSONObject().put("versionCode", 9).put("versionName", "9").put("url", "https://evil.example/x.apk").put("sha256", SHA), FEED));
        assertNull(UpdatePolicy.parse(new JSONObject().put("versionCode", 9).put("versionName", "9").put("url", "http://private.wizard001.com/x.apk").put("sha256", SHA), FEED));
        assertNull(UpdatePolicy.parse(new JSONObject().put("versionCode", 9).put("versionName", "9").put("url", "x.apk").put("sha256", "abc"), FEED));
        assertNull(UpdatePolicy.parse(new JSONObject().put("versionCode", 0).put("versionName", "9").put("url", "x.apk").put("sha256", SHA), FEED));
        assertNull(UpdatePolicy.parse(null, FEED));
    }

    @Test
    public void qaFakeFeedOnLoopbackWorks() throws Exception {
        UpdatePolicy.Release r = UpdatePolicy.parse(new JSONObject().put("versionCode", 99).put("versionName", "9.9.9").put("url", "/reports/wizard-os/new.apk").put("sha256", SHA),
                "http://localhost:18788/reports/wizard-os/latest.json");
        assertNotNull(r);
        assertEquals("http://localhost:18788/reports/wizard-os/new.apk", r.url);
    }

    @Test
    public void signersMustMatchExactly() {
        HashSet<String> a = new HashSet<>(Arrays.asList("aa")), ab = new HashSet<>(Arrays.asList("aa", "bb"));
        assertTrue(UpdatePolicy.sameSigners(a, new HashSet<>(a)));
        assertFalse(UpdatePolicy.sameSigners(a, ab));
        assertFalse(UpdatePolicy.sameSigners(a, new HashSet<>(Arrays.asList("cc"))));
        assertFalse(UpdatePolicy.sameSigners(new HashSet<>(), new HashSet<>()));
    }
}
