package ai.wizards.os.share;

import org.junit.Test;
import static org.junit.Assert.*;

public class ShareRecoveryBootTest {
    @Test public void systemRestartsRecoverPendingSharesWithoutUpdater() {
        assertTrue(ShareRecoveryBoot.shouldRecover("android.intent.action.BOOT_COMPLETED"));
        assertTrue(ShareRecoveryBoot.shouldRecover("android.intent.action.MY_PACKAGE_REPLACED"));
        assertFalse(ShareRecoveryBoot.shouldRecover(null));
        assertFalse(ShareRecoveryBoot.shouldRecover("ai.wizards.os.action.UPDATE"));
    }
}
