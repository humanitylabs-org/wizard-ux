package ai.wizards.os;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** "Connect to your Wizard": Back never exits; links only offer a switch, never make one by themselves. */
public class ConnectPolicyTest {
    @Test
    public void backOnTheConnectScreenNeverExits() {
        // Unconnected: nowhere else to go, so Back stays on the screen (MainActivity shows a hint, never finishes).
        assertEquals(ConnectPolicy.Back.STAY, ConnectPolicy.onBack(false));
        // Already connected (a link offered another Wizard): Back closes the offer and returns to the current Wizard.
        assertEquals(ConnectPolicy.Back.CLOSE, ConnectPolicy.onBack(true));
        for (ConnectPolicy.Back b : ConnectPolicy.Back.values()) assertFalse(b.name().contains("EXIT"));
    }

    @Test
    public void linksOfferOnlyADifferentWizard() {
        assertTrue(ConnectPolicy.offer("https://wizard.example.ts.net", ""));
        assertTrue(ConnectPolicy.offer("https://other.example.ts.net", "https://wizard.example.ts.net"));
        assertFalse(ConnectPolicy.offer("https://wizard.example.ts.net", "https://wizard.example.ts.net"));
        assertFalse(ConnectPolicy.offer("", "https://wizard.example.ts.net"));
        assertFalse(ConnectPolicy.offer(null, ""));
    }

    @Test
    public void screenTextNamesNoOne() {
        String all = ConnectPolicy.TITLE + ConnectPolicy.BODY + ConnectPolicy.HINT + ConnectPolicy.INVALID + ConnectPolicy.STAY;
        assertFalse(all.matches("(?s).*\\b(James|Archimedes)\\b.*"));
        assertTrue(ConnectPolicy.HINT.endsWith(".ts.net"));
    }
}
