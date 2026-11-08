package ai.wizards.os.apps;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/** #371: switching Wizards never shows the previous Wizard's pending install. */
public class InstallStatesTest {
    private static final String A = "https://wizard-a.example", B = "https://wizard-b.example", AEGIS = "com.beemdevelopment.aegis";

    @Test public void ownerSwitchDoesNotCarryPendingInstall() throws Exception {
        InstallStates s = new InstallStates();
        s.put(A, AEGIS, "confirm", 1_000L);
        assertEquals("confirm", s.snapshot(A).getJSONObject(AEGIS).getString("state"));
        assertEquals(0, s.snapshot(B).length());
        assertNull(s.get(B, AEGIS));
        assertFalse(s.busy(B, AEGIS, 2_000L));
        assertTrue(s.busy(A, AEGIS, 2_000L));
    }

    @Test public void lateUpdatesFromTheOldWizardStayWithIt() throws Exception {
        InstallStates s = new InstallStates();
        s.put(A, AEGIS, "downloading", 1_000L, "progress", 0);
        s.put(B, "org.example.other", "installed", 1_500L);
        s.put(A, AEGIS, "installing", 2_000L); // A's worker still running after the switch
        JSONObject b = s.snapshot(B);
        assertEquals(1, b.length());
        assertFalse(b.has(AEGIS));
        assertEquals("installing", s.snapshot(A).getJSONObject(AEGIS).getString("state"));
    }

    @Test public void snapshotIsACopy() throws Exception {
        InstallStates s = new InstallStates();
        s.put(A, AEGIS, "confirm", 1_000L);
        s.snapshot(A).remove(AEGIS);
        assertTrue(s.snapshot(A).has(AEGIS));
    }

    @Test public void oldFinishedEntriesArePrunedForEveryOwner() throws Exception {
        InstallStates s = new InstallStates();
        s.put(A, AEGIS, "error", 0L, "message", "x");
        s.put(A, "org.example.dl", "downloading", 0L);
        s.put(B, "org.example.new", "installed", InstallStates.KEEP_FINISHED_MS + 1);
        assertFalse(s.snapshot(A).has(AEGIS));
        assertTrue(s.snapshot(A).has("org.example.dl"));
        assertFalse(s.busy(A, "org.example.dl", InstallStates.BUSY_MS + 1));
    }
}
