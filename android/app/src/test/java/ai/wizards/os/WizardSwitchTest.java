package ai.wizards.os;

import static org.junit.Assert.*;
import org.junit.Test;

public class WizardSwitchTest {
    private static final String HERE = "https://wizard.tail1a2b3c.ts.net";

    @Test public void switchesToAnotherWizardOnTheSameTailnetInsideTheApp() {
        assertEquals("https://second.tail1a2b3c.ts.net:8443",
                WizardSwitch.target(HERE, "https://second.tail1a2b3c.ts.net:8443"));
        assertEquals("https://second.tail1a2b3c.ts.net:8443",
                WizardSwitch.target(HERE, "https://second.tail1a2b3c.ts.net:8443/wizard-os-home/"));
        assertEquals("https://other.tail1a2b3c.ts.net", WizardSwitch.target(HERE + ":8443", "https://OTHER.tail1a2b3c.ts.net:443"));
    }

    @Test public void neverSwitchesToAnythingElse() {
        for (String u : new String[]{
                HERE,                                                  // already there
                "https://wizard.tail9z8y7x.ts.net",                    // someone else's tailnet
                "https://evil.example",                                // not a tailnet name
                "https://second.tail1a2b3c.ts.net.evil.example", // look-alike suffix
                "http://second.tail1a2b3c.ts.net:8443",          // not https
                "https://user@second.tail1a2b3c.ts.net",         // credentials
                "https://second.tail1a2b3c.ts.net/other-path",   // not a shell address
                "https://second.tail1a2b3c.ts.net/?x=1",
                "https://tail1a2b3c.ts.net",                           // no machine name
                "javascript:alert(1)", "", "null"}) assertNull(u, WizardSwitch.target(HERE, u));
        assertNull(WizardSwitch.target("", "https://second.tail1a2b3c.ts.net"));
        assertNull(WizardSwitch.target(null, "https://second.tail1a2b3c.ts.net"));
        assertNull(WizardSwitch.target("https://box.example.com", "https://second.tail1a2b3c.ts.net"));
    }

    @Test public void tailnetName() {
        assertEquals("tail1a2b3c.ts.net", WizardSwitch.tailnet("a.b.tail1A2B3C.ts.net"));
        assertNull(WizardSwitch.tailnet("tail1a2b3c.ts.net"));
        assertNull(WizardSwitch.tailnet("a.tail1a2b3c.ts.net.evil"));
        assertNull(WizardSwitch.tailnet(null));
    }

    @Test public void debugBuildsSwitchBetweenTwoEmulatorHostFakesOnly() {
        assertEquals("http://10.0.2.2:9002", WizardSwitch.target("http://10.0.2.2:9001", "http://10.0.2.2:9002", true));
        assertNull(WizardSwitch.target("http://10.0.2.2:9001", "http://10.0.2.2:9002", false));
        assertNull(WizardSwitch.target("http://10.0.2.2:9001", "http://evil.example:9002", true));
        assertNull(WizardSwitch.target("http://10.0.2.2:9001", "http://10.0.2.2:9001", true));
    }
}
