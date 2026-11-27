package ai.wizards.os;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AppLocationTest {
    private static final String WIZARD = "https://box.example.ts.net";

    @Test
    public void asksOnlyWhileTheSwitchIsOnAndOnlyForThisWizard() {
        assertTrue(AppLocation.mayAsk(true, WIZARD, "https://box.example.ts.net/"));
        assertTrue(AppLocation.mayAsk(true, WIZARD, "https://box.example.ts.net:443"));
        assertFalse(AppLocation.mayAsk(false, WIZARD, "https://box.example.ts.net/"));
    }

    @Test
    public void otherAddressesAreDeniedWithNoPrompt() {
        assertFalse(AppLocation.mayAsk(true, WIZARD, "https://evil.example/"));
        assertFalse(AppLocation.mayAsk(true, WIZARD, "http://box.example.ts.net/"));
        assertFalse(AppLocation.mayAsk(true, WIZARD, "https://box.example.ts.net:8443/"));
        assertFalse(AppLocation.mayAsk(true, WIZARD, "null"));
        assertFalse(AppLocation.mayAsk(true, WIZARD, ""));
        assertFalse(AppLocation.mayAsk(true, WIZARD, null));
        assertFalse(AppLocation.mayAsk(true, "", "https://box.example.ts.net/"));
    }
}
