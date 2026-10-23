package ai.wizards.os.apps;

import org.junit.Test;
import org.json.JSONObject;
import static org.junit.Assert.*;

public class PlayAppsDistributionTest {
    @Test public void noInstallerOrBackgroundJobs() {
        assertFalse(AppsDistribution.canInstall(null));
        assertTrue(AppsDistribution.known(null).isEmpty());
        assertEquals(0, AppsDistribution.status().length());
        AppsDistribution.attach(null);
        AppsDistribution.detach(null);
        AppsDistribution.schedule(null);
        AppsDistribution.postInventorySoon(null);
    }
    @Test public void invalidPackageIsRefusedBeforeHandoff() throws Exception {
        for (String pkg : new String[]{"", "../app.apk", "com.example&url=bad", "market://bad"}) {
            try {
                AppsDistribution.install(null, null, new JSONObject().put("package", pkg));
                fail(pkg);
            } catch (AppsBridge.Refusal expected) { assertEquals("No such app", expected.getMessage()); }
        }
    }
}
