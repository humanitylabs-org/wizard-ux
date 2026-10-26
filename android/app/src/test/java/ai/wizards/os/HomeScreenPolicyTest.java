package ai.wizards.os;
import org.junit.Test;
import static org.junit.Assert.*;

public class HomeScreenPolicyTest {
    @Test public void readdingPinnedAppUpdatesChangedIconOrNameButUnchangedRefreshIsNoop() {
        assertTrue(HomeScreenPolicy.needsUpdate(true,"Wisdom","old png","Wisdom","new png"));
        assertTrue(HomeScreenPolicy.needsUpdate(true,"Old name","png","New name","png"));
        assertFalse(HomeScreenPolicy.needsUpdate(true,"Wisdom","png","Wisdom","png"));
    }
    @Test public void refreshNeverUpdatesUnownedOrUnpinnedShortcutEvenWithChangedMetadata() {
        assertFalse(HomeScreenPolicy.needsUpdate(false,"old","old png","new","new png"));
        assertFalse(HomeScreenPolicy.needsUpdate(false,null,null,"Wisdom","png"));
    }
    @Test public void legacyPinnedShortcutWithMissingPreferencesGetsOneRefresh() {
        assertTrue(HomeScreenPolicy.needsUpdate(true,null,null,"Wisdom","png"));
        assertFalse(HomeScreenPolicy.needsUpdate(true,"Wisdom","png","Wisdom","png"));
    }
    @Test public void signalHomeNameDoesNotChangeRegistryIdentity() {
        assertEquals("Signal",HomeScreenPolicy.displayName("wizard-signal","Wizard Signal"));
        assertEquals("Wisdom",HomeScreenPolicy.displayName("wisdom","Wisdom"));
    }
    @Test public void pinNeedsFreshUncanceledTapAndSingleClaim() {
        HomeScreenPolicy.TapGate gate = new HomeScreenPolicy.TapGate(8);
        assertEquals(-1,gate.claim(10)); // boot is not a gesture
        gate.down(10,10); gate.up(100); long claim=gate.claim(101);
        assertTrue(gate.current(claim)); assertEquals(-1,gate.claim(102));
        gate.down(10,10); assertFalse(gate.current(claim)); gate.move(30,10); gate.up(200);
        assertEquals(-1,gate.claim(201));
        gate.down(10,10); gate.cancel(); gate.up(300); assertEquals(-1,gate.claim(301));
        gate.down(10,10); gate.up(400); assertEquals(-1,gate.claim(2000));
    }
    @Test public void stableIdentityIncludesBoxAndApp() {
        String wisdom = HomeScreenPolicy.identity("https://box.example","wisdom");
        assertEquals(wisdom,HomeScreenPolicy.identity("https://box.example","wisdom"));
        assertNotEquals(wisdom,HomeScreenPolicy.identity("https://box.example","wizard-signal"));
        assertNotEquals(wisdom,HomeScreenPolicy.identity("https://other.example","wisdom"));
        assertTrue(wisdom.matches("homeapp-[a-f0-9]{64}"));
    }
    @Test public void callerCannotSupplyUrlOrTraversalAsAppIdentity() {
        for (String id : new String[]{null,"","../wisdom","https://box.example/wisdom/","a/b","a.b","wisdom?open=chats","a".repeat(97)}) assertFalse(HomeScreenPolicy.validId(id));
        assertTrue(HomeScreenPolicy.validId("wizard-signal")); assertTrue(HomeScreenPolicy.validId("wisdom"));
    }
    @Test public void concurrentTasksDoNotClearEachOthersForegroundPresence() {
        Object main = new Object(), wisdom = new Object(), signal = new Object();
        ai.wizards.os.device.AppState.setFront(main,true);
        ai.wizards.os.device.AppState.setFront(wisdom,true);
        ai.wizards.os.device.AppState.setFront(main,false);
        assertTrue(ai.wizards.os.device.AppState.front());
        ai.wizards.os.device.AppState.setFront(signal,true);
        ai.wizards.os.device.AppState.setFront(wisdom,false);
        assertTrue(ai.wizards.os.device.AppState.front());
        ai.wizards.os.device.AppState.setFront(signal,false);
        assertFalse(ai.wizards.os.device.AppState.front());
    }
}
