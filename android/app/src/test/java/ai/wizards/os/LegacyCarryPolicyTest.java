package ai.wizards.os;

import org.junit.Test;
import static org.junit.Assert.*;

public class LegacyCarryPolicyTest {
    @Test public void freshInstallDoesNotContactRetiredOrigin() {
        assertFalse(LegacyCarryPolicy.upgradedInstall(100L, 100L));
    }
    @Test public void upgradeCanRecoverOldDeviceLocalState() {
        assertTrue(LegacyCarryPolicy.upgradedInstall(100L, 200L));
    }
    @Test public void missingOrInvalidInstallHistoryCannotTriggerTransfer() {
        assertFalse(LegacyCarryPolicy.upgradedInstall(0L, 200L));
        assertFalse(LegacyCarryPolicy.upgradedInstall(100L, 0L));
        assertFalse(LegacyCarryPolicy.upgradedInstall(200L, 100L));
    }
}
