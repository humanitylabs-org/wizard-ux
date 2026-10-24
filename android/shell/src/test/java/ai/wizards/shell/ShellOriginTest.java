package ai.wizards.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ShellOriginTest {
    private static final String O = "https://wizard.example.ts.net";

    @Test public void acceptsTheAddressesOwnersPaste() {
        assertEquals(O, ShellOrigin.parse(O));
        assertEquals(O, ShellOrigin.parse(" " + O + "/ "));
        assertEquals(O, ShellOrigin.parse(O + "/wizard-os-home/"));
        assertEquals(O, ShellOrigin.parse(O + "/wizard-os-home"));
        assertEquals(O, ShellOrigin.parse("wizard.example.ts.net"));
        assertEquals(O, ShellOrigin.parse("HTTPS://Wizard.Example.ts.net:443"));
        assertEquals(O + ":8444", ShellOrigin.parse(O + ":8444"));
        assertEquals(O + ":8444", ShellOrigin.parse("wizard.example.ts.net:8444/"));
    }

    @Test public void acceptsSetupQrLinks() {
        assertEquals(O + ":8444", ShellOrigin.parse("wizard://connect?origin=https%3A%2F%2Fwizard.example.ts.net%3A8444"));
        assertNull(ShellOrigin.parse("wizard://connect?origin=http%3A%2F%2Fwizard.example.ts.net"));
        assertNull(ShellOrigin.parse("wizard://connect?origin=" + O + "&x=1"));
        assertNull(ShellOrigin.parse("wizard://other?origin=" + O));
    }

    @Test public void refusesAnythingButAPlainHttpsOrigin() {
        for (String bad : new String[]{null, "", "   ", "http://wizard.example.ts.net", "ftp://x", "javascript:alert(1)",
                O + "/other/", O + "/?q=1", O + "/#x", "https://user@wizard.example.ts.net",
                O + ":0", O + ":70000", "https://", "https://bad..host", "https://host."}) {
            assertNull(String.valueOf(bad), ShellOrigin.parse(bad));
        }
    }

    @Test public void trustsOnlyTheExactOrigin() {
        assertTrue(ShellOrigin.same(O, O + "/wizard-os-home/"));
        assertTrue(ShellOrigin.same(O, O + ":443/files/"));
        assertTrue(ShellOrigin.same(O + ":8444", O + ":8444/x"));
        assertFalse(ShellOrigin.same(O, O + ":8444/"));
        assertFalse(ShellOrigin.same(O + ":8444", O + "/"));
        assertFalse(ShellOrigin.same(O, "http://wizard.example.ts.net/"));
        assertFalse(ShellOrigin.same(O, "https://evil.example.ts.net/"));
        assertFalse(ShellOrigin.same(O, "https://wizard.example.ts.net.evil.com/"));
        assertFalse(ShellOrigin.same(O, "https://u@wizard.example.ts.net/"));
        assertFalse(ShellOrigin.same(null, O));
        assertFalse(ShellOrigin.same(O, null));
    }

    @Test public void homeAndTailnet() {
        assertEquals(O + "/wizard-os-home/", ShellOrigin.home(O));
        assertTrue(ShellOrigin.tailnet(O));
        assertFalse(ShellOrigin.tailnet("https://wizard.example.com"));
    }
}
