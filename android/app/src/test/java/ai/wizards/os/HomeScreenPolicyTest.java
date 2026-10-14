package ai.wizards.os;
import org.junit.Test;
import static org.junit.Assert.*;

public class HomeScreenPolicyTest {
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
