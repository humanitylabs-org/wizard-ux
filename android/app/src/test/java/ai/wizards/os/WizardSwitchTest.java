package ai.wizards.os;

import static org.junit.Assert.*;
import org.junit.Test;

public class WizardSwitchTest {
    private static final String HERE = "https://wizard.tailc0f369.ts.net";

    @Test public void switchesToAnotherWizardOnTheSameTailnetInsideTheApp() {
        assertEquals("https://wizard-james.tailc0f369.ts.net:8796",
                WizardSwitch.target(HERE, "https://wizard-james.tailc0f369.ts.net:8796"));
        assertEquals("https://wizard-james.tailc0f369.ts.net:8796",
                WizardSwitch.target(HERE, "https://wizard-james.tailc0f369.ts.net:8796/wizard-os-home/"));
        assertEquals("https://other.tailc0f369.ts.net", WizardSwitch.target(HERE + ":8443", "https://OTHER.tailc0f369.ts.net:443"));
    }

    @Test public void neverSwitchesToAnythingElse() {
        for (String u : new String[]{
                HERE,                                                  // already there
                "https://wizard.tailaaaaaa.ts.net",                    // someone else's tailnet
                "https://evil.example",                                // not a tailnet name
                "https://wizard-james.tailc0f369.ts.net.evil.example", // look-alike suffix
                "http://wizard-james.tailc0f369.ts.net:8796",          // not https
                "https://user@wizard-james.tailc0f369.ts.net",         // credentials
                "https://wizard-james.tailc0f369.ts.net/other-path",   // not a shell address
                "https://wizard-james.tailc0f369.ts.net/?x=1",
                "https://tailc0f369.ts.net",                           // no machine name
                "javascript:alert(1)", "", "null"}) assertNull(u, WizardSwitch.target(HERE, u));
        assertNull(WizardSwitch.target("", "https://wizard-james.tailc0f369.ts.net"));
        assertNull(WizardSwitch.target(null, "https://wizard-james.tailc0f369.ts.net"));
        assertNull(WizardSwitch.target("https://box.example.com", "https://wizard-james.tailc0f369.ts.net"));
    }

    @Test public void tailnetName() {
        assertEquals("tailc0f369.ts.net", WizardSwitch.tailnet("a.b.tailC0F369.ts.net"));
        assertNull(WizardSwitch.tailnet("tailc0f369.ts.net"));
        assertNull(WizardSwitch.tailnet("a.tailc0f369.ts.net.evil"));
        assertNull(WizardSwitch.tailnet(null));
    }

    @Test public void debugBuildsSwitchBetweenTwoEmulatorHostFakesOnly() {
        assertEquals("http://10.0.2.2:9002", WizardSwitch.target("http://10.0.2.2:9001", "http://10.0.2.2:9002", true));
        assertNull(WizardSwitch.target("http://10.0.2.2:9001", "http://10.0.2.2:9002", false));
        assertNull(WizardSwitch.target("http://10.0.2.2:9001", "http://evil.example:9002", true));
        assertNull(WizardSwitch.target("http://10.0.2.2:9001", "http://10.0.2.2:9001", true));
    }
}
