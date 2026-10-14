package ai.wizards.os.device;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;

import org.junit.After;
import org.junit.Test;

import ai.wizards.os.BuildConfig;

/** This Wizard's address: parsed from what the owner typed or a link carried; nothing is built in. */
public class WizardAddressTest {
    @After public void reset() { WizardAddress.setForTest(""); }

    @Test
    public void sourceCarriesNoAddress() {
        // The repo's unit tests run without private Gradle properties: the build itself knows no Wizard.
        if (BuildConfig.ORIGIN.isEmpty()) {
            assertEquals("", BuildConfig.HOME_URL);
            assertEquals("", BuildConfig.LEGACY_HOSTS);
        } else {
            assertEquals(BuildConfig.ORIGIN, WizardAddress.normalize(BuildConfig.ORIGIN));
        }
    }

    @Test
    public void unconfiguredStateHasNowhereToGo() {
        WizardAddress.setForTest("");
        assertFalse(WizardAddress.configured());
        assertEquals("", WizardAddress.origin());
        assertEquals("", WizardAddress.host());
        assertEquals("", WizardAddress.homeUrl());
        assertNull(WizardAddress.legacyOrigin());
        assertFalse(WizardAddress.isTrustedOrigin("https://wizard.example.ts.net"));
        assertFalse(WizardAddress.isTrustedOrigin(""));
        assertTrue(WizardAddress.listenerOrigins("").isEmpty());
        // Native HTTP has no fallback to rewrite to.
        AppState.legacyFallback = true;
        try { assertEquals("", AppState.live("")); } finally { AppState.legacyFallback = false; }
    }

    @Test
    public void normalizeAcceptsWhatTheOwnerPastes() {
        assertEquals("https://wizard.example.ts.net", WizardAddress.normalize("https://wizard.example.ts.net"));
        assertEquals("https://wizard.example.ts.net", WizardAddress.normalize("  https://Wizard.Example.ts.net/  "));
        assertEquals("https://wizard.example.ts.net", WizardAddress.normalize("wizard.example.ts.net"));
        assertEquals("https://wizard.example.ts.net", WizardAddress.normalize("https://wizard.example.ts.net/wizard-os-home/?open=chats"));
        assertEquals("https://wizard.example.ts.net", WizardAddress.normalize("https://wizard.example.ts.net:443/"));
    }

    @Test
    public void normalizeRefusesAnythingElse() {
        assertEquals("", WizardAddress.normalize(null));
        assertEquals("", WizardAddress.normalize(""));
        assertEquals("", WizardAddress.normalize("http://wizard.example.ts.net"));
        assertEquals("", WizardAddress.normalize("https://wizard.example.ts.net:8443"));
        assertEquals("", WizardAddress.normalize("https://user@wizard.example.ts.net"));
        assertEquals("", WizardAddress.normalize("https://localhost"));
        assertEquals("", WizardAddress.normalize("javascript:alert(1)"));
        assertEquals("", WizardAddress.normalize("file:///sdcard/x"));
        assertEquals("", WizardAddress.normalize("wizard example"));
        assertEquals("", WizardAddress.normalize("https://-bad.example.com"));
    }

    @Test
    public void legacyHostsParse() {
        assertEquals(Arrays.asList("old.example.com", "older.example.net"),
                WizardAddress.hosts(" Old.example.com, https://older.example.net/ ,old.example.com"));
        assertTrue(WizardAddress.hosts("").isEmpty());
        assertTrue(WizardAddress.hosts("not a host").isEmpty());
    }

    @Test
    public void listenerOriginsAddOlderNamesOnlyForTheOwnAddress() {
        WizardAddress.setForTest("https://wizard.example.ts.net", "old.example.com");
        assertEquals("https://old.example.com", WizardAddress.legacyOrigin());
        assertEquals(new java.util.LinkedHashSet<>(Arrays.asList("https://wizard.example.ts.net", "https://old.example.com")),
                WizardAddress.listenerOrigins("https://wizard.example.ts.net"));
        assertEquals(java.util.Collections.singleton("http://localhost:18788"), WizardAddress.listenerOrigins("http://localhost:18788"));
        assertTrue(WizardAddress.isTrustedOrigin("https://old.example.com"));
        assertFalse(WizardAddress.isTrustedOrigin("https://old.example.com.evil.test"));
    }

    @Test
    public void connectLinks() {
        assertEquals("https://wizard.example.ts.net", WizardAddress.fromLink("wizardos://connect?address=https%3A%2F%2Fwizard.example.ts.net%2F"));
        assertEquals("https://wizard.example.ts.net", WizardAddress.fromLink("wizardos://connect?address=https://wizard.example.ts.net/"));
        assertEquals("https://wizard.example.ts.net", WizardAddress.fromLink("https://wizard.example.ts.net/wizard-os-home/?open=setup"));
        assertEquals("", WizardAddress.fromLink("wizardos://connect?address=http://wizard.example.ts.net"));
        assertEquals("", WizardAddress.fromLink("wizardos://other?address=https://wizard.example.ts.net"));
        assertEquals("", WizardAddress.fromLink("wizardos://connect"));
        assertEquals("", WizardAddress.fromLink("http://wizard.example.ts.net/"));
        assertEquals("", WizardAddress.fromLink(null));
    }
}
