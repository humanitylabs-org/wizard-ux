package ai.wizards.os.vault;

import static org.junit.Assert.*;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.junit.Test;

/** Owner ask: cancelling the fingerprint prompt while replacing a saved secret must keep the old secret. */
public class VaultSlotsTest {
    static final class Fake implements VaultSlots.Store {
        final Map<String, String> prefs = new HashMap<>();
        final Set<String> keys = new HashSet<>();
        boolean failWrites;
        @Override public String get(String key) { return prefs.get(key); }
        @Override public boolean write(String[] k, String[] v) {
            if (failWrites) return false;
            for (int i = 0; i < k.length; i++) { if (v[i] == null) prefs.remove(k[i]); else prefs.put(k[i], v[i]); }
            return true;
        }
        @Override public void deleteKey(String alias) { keys.remove(alias); }
    }

    /** What VaultBridge.seal does around the prompt; `ok` is whether the prompt succeeded. */
    static void seal(VaultSlots slots, Fake f, String app, String packed, boolean ok) throws Exception {
        String next = slots.begin(app); f.keys.add(next);
        if (ok) slots.commit(app, next, packed); else slots.abort(app, next);
    }

    @Test public void cancellingAResealKeepsTheSavedSecretAndItsKey() throws Exception {
        Fake f = new Fake(); VaultSlots s = new VaultSlots(f);
        seal(s, f, "messenger", "old", true);
        String oldAlias = s.currentAlias("messenger");
        seal(s, f, "messenger", "new", false);
        assertEquals("old", f.prefs.get("messenger"));
        assertEquals(oldAlias, s.currentAlias("messenger"));
        assertEquals(Set.of(oldAlias), f.keys);
    }

    @Test public void aSuccessfulResealSwitchesSlotAndDropsOnlyTheOldKey() throws Exception {
        Fake f = new Fake(); VaultSlots s = new VaultSlots(f);
        seal(s, f, "messenger", "one", true);
        seal(s, f, "messenger", "two", true);
        assertEquals("two", f.prefs.get("messenger"));
        assertEquals(Set.of(s.currentAlias("messenger")), f.keys);
        seal(s, f, "messenger", "three", true);
        assertEquals("three", f.prefs.get("messenger"));
        assertEquals(Set.of(s.currentAlias("messenger")), f.keys);
    }

    @Test public void v1SecretsSealedBefore0_10_18StayReadableAndReplaceable() throws Exception {
        Fake f = new Fake(); VaultSlots s = new VaultSlots(f);
        f.prefs.put("messenger", "v1"); f.keys.add("wos-vault-v1-messenger");
        assertEquals("wos-vault-v1-messenger", s.currentAlias("messenger"));
        seal(s, f, "messenger", "new", false);
        assertEquals("v1", f.prefs.get("messenger"));
        assertTrue(f.keys.contains("wos-vault-v1-messenger"));
        seal(s, f, "messenger", "new", true);
        assertEquals("wos-vault-v1-messenger.b", s.currentAlias("messenger"));
        assertFalse(f.keys.contains("wos-vault-v1-messenger"));
    }

    @Test public void aFailedCommitLeavesTheOldSecretInPlace() throws Exception {
        Fake f = new Fake(); VaultSlots s = new VaultSlots(f);
        seal(s, f, "messenger", "old", true);
        String oldAlias = s.currentAlias("messenger");
        String next = s.begin("messenger"); f.keys.add(next);
        f.failWrites = true;
        assertThrows(IllegalStateException.class, () -> s.commit("messenger", next, "new"));
        s.abort("messenger", next);
        assertEquals("old", f.prefs.get("messenger"));
        assertEquals(Set.of(oldAlias), f.keys);
    }

    @Test public void aLateAbortNeverDeletesTheCommittedKey() throws Exception {
        Fake f = new Fake(); VaultSlots s = new VaultSlots(f);
        String next = s.begin("messenger"); f.keys.add(next);
        s.commit("messenger", next, "saved");
        s.abort("messenger", next);
        assertTrue(f.keys.contains(next));
        assertEquals("saved", f.prefs.get("messenger"));
    }

    @Test public void forgetClearsBothSlotsAndOnlyThisApp() throws Exception {
        Fake f = new Fake(); VaultSlots s = new VaultSlots(f);
        seal(s, f, "messenger", "a", true); seal(s, f, "messenger", "b", true);
        seal(s, f, "music", "m", true);
        s.forget("messenger");
        assertNull(f.prefs.get("messenger")); assertNull(f.prefs.get("slot.messenger"));
        assertEquals("m", f.prefs.get("music"));
        assertEquals(Set.of(s.currentAlias("music")), f.keys);
    }
}
