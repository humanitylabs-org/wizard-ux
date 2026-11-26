package ai.wizards.os;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.*;

/** Recovery mode's start rules (wizard-ux issue 1775, switch wizard/phone-recovery-mode). */
public class StartPolicyTest {
    private static final int PID = 100, OTHER = 200, V = 135;

    @Test public void aFineStartStaysNormal() {
        StartPolicy.State s = new StartPolicy.State();
        assertFalse("first start ever", StartPolicy.begin(s, PID, V, 1000));
        assertTrue(s.pendingNormal);
        StartPolicy.settled(s, false, V);
        assertEquals(0, s.pendingAt);
        assertFalse("the next start is normal", StartPolicy.begin(s, OTHER, V, 2000));
    }

    @Test public void aStartThatNeverSettledInItsProcessMakesTheNextOneRecover() {
        StartPolicy.State s = new StartPolicy.State();
        StartPolicy.begin(s, PID, V, 1000); // closed from "isn't responding", crashed, or swiped away while frozen
        assertTrue(StartPolicy.begin(s, OTHER, V, 2000));
        assertEquals("closed", s.why);
        assertFalse("a recovery start is not watched as a normal one", s.pendingNormal);
    }

    @Test public void aFrozenStartThatWentOnStillMakesTheNextOneRecover() {
        StartPolicy.State s = new StartPolicy.State();
        StartPolicy.begin(s, PID, V, 1000);
        StartPolicy.settled(s, true, V);
        assertTrue(StartPolicy.begin(s, OTHER, V, 2000));
        assertEquals("froze", s.why);
    }

    @Test public void theSameProcessStartingAgainIsNotADeath() {
        StartPolicy.State s = new StartPolicy.State();
        StartPolicy.begin(s, PID, V, 1000);
        assertFalse(StartPolicy.begin(s, PID, V, 1500));
    }

    @Test public void recoveryStaysUntilANormalStartGoesFine() {
        StartPolicy.State s = new StartPolicy.State();
        StartPolicy.begin(s, PID, V, 1000);
        assertTrue(StartPolicy.begin(s, OTHER, V, 2000));
        // a recovery start that settles, or is closed, leaves the count: the next start recovers again
        StartPolicy.settled(s, false, V);
        assertTrue(StartPolicy.begin(s, 300, V, 3000));
        assertTrue("a recovery start that died", StartPolicy.begin(s, 400, V, 4000));
        // Start normally, and it freezes again: still recovering next time
        StartPolicy.normal(s, 400, 5000);
        assertTrue(StartPolicy.begin(s, 500, V, 6000));
        // Start normally and it goes fine: the next start is normal
        StartPolicy.normal(s, 500, 7000);
        StartPolicy.settled(s, false, V);
        assertFalse(StartPolicy.begin(s, 600, V, 8000));
        assertEquals("", s.why);
    }

    @Test public void aNewBuildAlwaysGetsANormalTry() {
        StartPolicy.State s = new StartPolicy.State();
        StartPolicy.begin(s, PID, V, 1000);
        assertTrue(StartPolicy.begin(s, OTHER, V, 2000));
        assertFalse("the fixed build installed from recovery mode", StartPolicy.begin(s, 300, V + 1, 3000));
        // and if that build freezes too, recovery comes back for it
        assertTrue(StartPolicy.begin(s, 400, V + 1, 4000));
        assertEquals(1, s.bad);
        assertEquals(V + 1, s.badVersion);
    }

    @Test public void aFreezeCountsForTheStartItHappenedIn() {
        assertTrue(StartPolicy.frozeDuring(10_000, 12_000, 4000));
        assertTrue("began just before and still going", StartPolicy.frozeDuring(10_000, 9_000, 5000));
        assertFalse("an older freeze", StartPolicy.frozeDuring(10_000, 2_000, 4000));
        assertFalse("no start", StartPolicy.frozeDuring(0, 2_000, 4000));
    }

    @Test public void theCardSaysWhatHappenedAndWhatIsPaused() {
        assertTrue(StartPolicy.body("froze").startsWith("WizardOS froze when it last started."));
        assertTrue(StartPolicy.body("closed").startsWith("WizardOS closed before it finished starting"));
        assertTrue(StartPolicy.body("").contains("Meeting recording and uploads are paused"));
    }

    @Test public void theUpdateButtonFollowsTheNormalUpdater() throws Exception {
        assertEquals("Check for update", StartPolicy.updateButton(null));
        assertEquals("", StartPolicy.updateLine(new JSONObject().put("state", "idle")));
        JSONObject current = new JSONObject().put("state", "current").put("installed", "0.10.71");
        assertEquals("WizardOS 0.10.71 is the newest version.", StartPolicy.updateLine(current));
        assertFalse(StartPolicy.updateInstalls(current));
        JSONObject ready = new JSONObject().put("state", "ready").put("version", "0.10.72");
        assertEquals("Install 0.10.72", StartPolicy.updateButton(ready));
        assertTrue(StartPolicy.updateInstalls(ready));
        assertEquals("WizardOS 0.10.72 is ready to install.", StartPolicy.updateLine(ready));
        assertTrue(StartPolicy.updateInstalls(new JSONObject().put("state", "available").put("version", "0.10.72")));
        JSONObject down = new JSONObject().put("state", "downloading").put("version", "0.10.72");
        assertTrue(StartPolicy.updateBusy(down));
        assertEquals("Downloading WizardOS 0.10.72…", StartPolicy.updateLine(down));
        assertEquals("Download failed · try again",
                StartPolicy.updateLine(new JSONObject().put("state", "error").put("message", "Download failed · try again")));
        assertTrue(StartPolicy.updateLine(new JSONObject().put("state", "offline")).startsWith("Couldn’t reach your Wizard"));
    }
}
