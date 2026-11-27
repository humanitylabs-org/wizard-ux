package ai.wizards.os;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AppLocationTest {
    private static final String WIZARD = "https://box.example.ts.net";

    @Test
    public void asksOnlyForThisWizard() {
        assertTrue(AppLocation.mayAsk(WIZARD, "https://box.example.ts.net/"));
        assertTrue(AppLocation.mayAsk(WIZARD, "https://box.example.ts.net:443"));
    }

    @Test
    public void otherAddressesAreDeniedWithNoPrompt() {
        assertFalse(AppLocation.mayAsk(WIZARD, "https://evil.example/"));
        assertFalse(AppLocation.mayAsk(WIZARD, "http://box.example.ts.net/"));
        assertFalse(AppLocation.mayAsk(WIZARD, "https://box.example.ts.net:8443/"));
        assertFalse(AppLocation.mayAsk(WIZARD, "null"));
        assertFalse(AppLocation.mayAsk(WIZARD, ""));
        assertFalse(AppLocation.mayAsk(WIZARD, null));
        assertFalse(AppLocation.mayAsk("", "https://box.example.ts.net/"));
    }
}
