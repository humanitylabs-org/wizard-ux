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
        String failDelete;
        @Override public void deleteKey(String alias) throws Exception {
            if (alias.equals(failDelete)) throw new Exception("keystore busy");
            keys.remove(alias);
        }
    }

    /** What VaultBridge.seal does around the prompt; `ok` is whether the prompt succeeded. */
    static void seal(VaultSlots slots, Fake f, String app, String packed, boolean ok) throws Exception {
        VaultSlots.Op next = slots.begin(app); f.keys.add(next.alias);
        if (ok) slots.commit(next, packed); else slots.abort(next);
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
        VaultSlots.Op next = s.begin("messenger"); f.keys.add(next.alias);
        f.failWrites = true;
        assertThrows(IllegalStateException.class, () -> s.commit(next, "new"));
        s.abort(next);
        assertEquals("old", f.prefs.get("messenger"));
        assertEquals(Set.of(oldAlias), f.keys);
    }

    @Test public void aLateAbortNeverDeletesTheCommittedKey() throws Exception {
        Fake f = new Fake(); VaultSlots s = new VaultSlots(f);
        VaultSlots.Op next = s.begin("messenger"); f.keys.add(next.alias);
        s.commit(next, "saved");
        s.abort(next);
        assertTrue(f.keys.contains(next.alias));
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

    /** Review on the vault fix: navigation cancels A, the new page seals B on the same spare alias, then A's late cancel arrives. */
    @Test public void aLateAbortFromAnEarlierSealNeverTouchesTheNewerSeal() throws Exception {
        Fake f = new Fake(); VaultSlots s = new VaultSlots(f);
        seal(s, f, "messenger", "old", true);
        String oldAlias = s.currentAlias("messenger");
        VaultSlots.Op a = s.begin("messenger"); f.keys.add(a.alias);
        VaultSlots.Op b = s.begin("messenger"); f.keys.add(b.alias);
        assertEquals(a.alias, b.alias);
        s.abort(a);
        assertTrue("B's key survives A's late abort", f.keys.contains(b.alias));
        s.commit(b, "new");
        assertEquals("new", f.prefs.get("messenger"));
        assertEquals(b.alias, s.currentAlias("messenger"));
        assertEquals(Set.of(b.alias), f.keys);
        assertFalse(f.keys.contains(oldAlias));
    }

    @Test public void aSupersededSealCannotCommit() throws Exception {
        Fake f = new Fake(); VaultSlots s = new VaultSlots(f);
        seal(s, f, "messenger", "old", true);
        VaultSlots.Op a = s.begin("messenger"); f.keys.add(a.alias);
        s.begin("messenger");
        assertThrows(IllegalStateException.class, () -> s.commit(a, "stale"));
        assertEquals("old", f.prefs.get("messenger"));
    }

    @Test public void failingToDropTheOldKeyAfterCommitStillReportsSaved() throws Exception {
        Fake f = new Fake(); VaultSlots s = new VaultSlots(f);
        seal(s, f, "messenger", "old", true);
        f.failDelete = s.currentAlias("messenger");
        VaultSlots.Op next = s.begin("messenger"); f.keys.add(next.alias);
        s.commit(next, "new"); // must not throw: the new secret is saved
        assertEquals("new", f.prefs.get("messenger"));
        assertEquals(next.alias, s.currentAlias("messenger"));
    }
}
