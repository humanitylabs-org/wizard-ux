package ai.wizards.os.vault;

/** Two key slots per app so a reseal never destroys the saved secret before the new one is committed.
 * Slot "a" is the v1 alias and preference layout, so secrets sealed by 0.10.8–0.10.17 stay readable.
 * Order: begin() frees the unused slot and names it; commit() writes the new ciphertext and slot in one
 * preferences commit, then drops the old key; abort() drops only the new key. Cancel, timeout, prompt
 * failure or navigation therefore leave the previous secret exactly as it was. Pure: unit-tested with fakes.
 */
final class VaultSlots {
    interface Store {
        String get(String key);
        /** Atomically sets every non-null value and removes every key mapped to null. */
        boolean write(String[] keys, String[] values);
        void deleteKey(String alias) throws Exception;
    }

    static final String KEY_PREFIX = "wos-vault-v1-";
    private final Store store;
    VaultSlots(Store store) { this.store = store; }

    /** '.' is outside the app id alphabet, so these cannot collide with another app's entries. */
    static String slotPref(String app) { return "slot." + app; }
    static String alias(String app, String slot) { return "b".equals(slot) ? KEY_PREFIX + app + ".b" : KEY_PREFIX + app; }

    String slot(String app) { return "b".equals(store.get(slotPref(app))) ? "b" : "a"; }
    String currentAlias(String app) { return alias(app, slot(app)); }

    /** Alias for the replacement key. Any stale key in that unused slot is removed first; the live one is untouched. */
    String begin(String app) throws Exception {
        String next = alias(app, "b".equals(slot(app)) ? "a" : "b");
        store.deleteKey(next);
        return next;
    }

    /** Replacement is committed before the old key goes, so a crash in between leaves only an orphan key. */
    void commit(String app, String nextAlias, String packed) throws Exception {
        String old = currentAlias(app);
        String nextSlot = nextAlias.equals(alias(app, "b")) ? "b" : null; // slot a is the v1 default: no marker
        if (!store.write(new String[]{app, slotPref(app)}, new String[]{packed, nextSlot})) throw new IllegalStateException("Save failed");
        if (!old.equals(nextAlias)) store.deleteKey(old);
    }

    /** Drops an uncommitted replacement key; never the committed one, so a late failure cannot erase a saved secret. */
    void abort(String app, String nextAlias) {
        if (nextAlias.equals(currentAlias(app)) && store.get(app) != null) return;
        try { store.deleteKey(nextAlias); } catch (Exception ignored) { }
    }

    void forget(String app) throws Exception {
        store.deleteKey(alias(app, "a")); store.deleteKey(alias(app, "b"));
        if (!store.write(new String[]{app, slotPref(app)}, new String[]{null, null})) throw new IllegalStateException("Save failed");
    }
}
