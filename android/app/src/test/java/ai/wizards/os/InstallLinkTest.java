package ai.wizards.os;

import org.junit.Test;
import static org.junit.Assert.*;

public final class InstallLinkTest {
    @Test public void mapsToRecipientShellAndPreservesQuery() {
        String q = "repo=github.com%2Fowner%2Frepo&commit=" + new String(new char[40]).replace('\0','a') + "&from=Jane%20Doe";
        assertEquals("/wizard-os-home/?view=install&" + q, InstallLink.shellPath("wizard://install?" + q));
        assertEquals("/wizard-os-home/?view=install", InstallLink.shellPath("wizard://install"));
    }
    @Test public void rejectsForeignAuthorityAndNavigationOverrides() {
        for (String bad : new String[]{"wizard://connect?repo=o/r", "https://install?repo=o/r", "wizard://user@install?repo=o/r", "wizard://install:80?repo=o/r", "wizard://install/path?repo=o/r", "wizard://install?view=settings", "wizard://install?repo=o/r#other"}) assertNull(bad, InstallLink.shellPath(bad));
    }
    @Test public void malformedSelectionStillReachesStoreErrorCard() {
        assertEquals("/wizard-os-home/?view=install&repo=not-a-repo", InstallLink.shellPath("wizard://install?repo=not-a-repo"));
    }
}
