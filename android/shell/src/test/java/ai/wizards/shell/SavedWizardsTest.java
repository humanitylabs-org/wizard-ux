package ai.wizards.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import org.junit.Test;

public class SavedWizardsTest {
    private static final String A = "https://home.example.ts.net", B = "https://demo-5.example.com:8444";

    @Test public void rememberPutsTheNewestFirstWithoutRepeats() {
        List<String> l = SavedWizards.remember(new ArrayList<>(), A);
        l = SavedWizards.remember(l, B);
        assertEquals(Arrays.asList(B, A), l);
        // Reconnecting to A (pasted differently) moves it back to the top, once.
        l = SavedWizards.remember(l, "HTTPS://Home.Example.ts.net:443/wizard-os-home/");
        assertEquals(Arrays.asList(A, B), l);
    }

    @Test public void rememberRefusesWhatConnectRefuses() {
        List<String> l = Collections.singletonList(A);
        assertNull(SavedWizards.remember(l, "http://plain.example.com"));
        assertNull(SavedWizards.remember(l, "https://user@evil.example.com"));
        assertNull(SavedWizards.remember(l, "https://x.example.com/other/path"));
        assertNull(SavedWizards.remember(l, null));
        assertEquals(Collections.singletonList(A), l);
    }

    @Test public void keepsAtMostTenAndDropsTheOldest() {
        List<String> l = new ArrayList<>();
        for (int i = 0; i < 12; i++) l = SavedWizards.remember(l, "https://w" + i + ".example.com");
        assertEquals(SavedWizards.MAX, l.size());
        assertEquals("https://w11.example.com", l.get(0));
        assertEquals("https://w2.example.com", l.get(9));
        assertFalse(l.contains("https://w0.example.com"));
    }

    @Test public void forgetRemovesOnlyThatWizard() {
        List<String> l = Arrays.asList(A, B);
        assertEquals(Collections.singletonList(B), SavedWizards.forget(l, A));
        assertEquals(Collections.singletonList(A), SavedWizards.forget(l, B + "/"));
        assertEquals(l, SavedWizards.forget(l, "https://other.example.com"));
        assertEquals(l, SavedWizards.forget(l, "not a url"));
    }

    @Test public void storageRoundTripsAndRejectsDamagedEntries() {
        List<String> l = Arrays.asList(A, B);
        assertEquals(l, SavedWizards.decode(SavedWizards.encode(l)));
        String damaged = A + "\nhttp://plain.example.com\n\njavascript:alert(1)\n" + A + "\nhttps://u@x.example.com\n" + B;
        assertEquals(l, SavedWizards.decode(damaged));
        assertTrue(SavedWizards.decode(null).isEmpty());
        assertTrue(SavedWizards.decode("").isEmpty());
        StringBuilder many = new StringBuilder();
        for (int i = 0; i < 30; i++) many.append("https://w").append(i).append(".example.com\n");
        assertEquals(SavedWizards.MAX, SavedWizards.decode(many.toString()).size());
    }

    @Test public void onlyRememberedWizardsAreKnown() {
        List<String> l = Arrays.asList(A, B);
        assertTrue(SavedWizards.known(l, A));
        assertTrue(SavedWizards.known(l, "demo-5.example.com:8444"));
        assertFalse(SavedWizards.known(l, "https://other.example.com"));
        assertFalse(SavedWizards.known(l, "http://home.example.ts.net"));
        assertFalse(SavedWizards.known(l, null));
    }

    @Test public void othersSkipsTheCurrentOne() {
        List<String> l = Arrays.asList(A, B, "https://c.example.com", "https://d.example.com");
        assertEquals(Arrays.asList(A, "https://c.example.com"), SavedWizards.others(l, B, 2));
        assertEquals(Arrays.asList(B, "https://c.example.com", "https://d.example.com"), SavedWizards.others(l, A, 3));
    }

    @Test public void labelsAreShortHostNames() {
        assertEquals("home", SavedWizards.label(A));
        assertEquals("demo-5:8444", SavedWizards.label(B));
        assertEquals("10.0.2.2:8443", SavedWizards.label("https://10.0.2.2:8443"));
        assertEquals("127.0.0.1", SavedWizards.label("https://127.0.0.1"));
        assertEquals("[::1]:8443", SavedWizards.label("https://[::1]:8443"));
        assertEquals("localhost", SavedWizards.label("https://localhost"));
        assertEquals("", SavedWizards.label("http://plain.example.com"));
    }
}
