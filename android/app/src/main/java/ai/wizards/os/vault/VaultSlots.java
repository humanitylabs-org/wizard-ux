package ai.wizards.os.vault;

import java.util.HashMap;
import java.util.Map;

/** Two key slots per app so a reseal never destroys the saved secret before the new one is committed.
 * Slot "a" is the v1 alias and preference layout, so secrets sealed by 0.10.8–0.10.17 stay readable.
 * Order: begin() frees the unused slot and names it; commit() writes the new ciphertext and slot in one
 * preferences commit, then drops the old key; abort() drops only the new key. Cancel, timeout, prompt
 * failure or navigation therefore leave the previous secret exactly as it was. Pure: unit-tested with fakes.
 * Each begin() returns a generation-stamped Op; a late abort/commit for an older Op is a no-op, so a stale
 * Android cancel callback can never delete the key a newer seal is using. Downgrading below 0.10.18 after a
 * slot-b reseal is unsupported (older builds only read slot a).
 */
final class VaultSlots {
    interface Store {
        String get(String key);
        /** Atomically sets every non-null value and removes every key mapped to null. */
        boolean write(String[] keys, String[] values);
        void deleteKey(String alias) throws Exception;
    }

    /** One in-flight replacement: the spare-slot alias and the generation that owns it. */
    static final class Op {
        final String app, alias; final long generation;
        Op(String app, String alias, long generation) { this.app = app; this.alias = alias; this.generation = generation; }
    }

    static final String KEY_PREFIX = "wos-vault-v1-";
    private final Store store;
    private final Map<String, Long> latest = new HashMap<>();
    private long generations;
    VaultSlots(Store store) { this.store = store; }

    /** '.' is outside the app id alphabet, so these cannot collide with another app's entries. */
    static String slotPref(String app) { return "slot." + app; }
    static String alias(String app, String slot) { return "b".equals(slot) ? KEY_PREFIX + app + ".b" : KEY_PREFIX + app; }

    String slot(String app) { return "b".equals(store.get(slotPref(app))) ? "b" : "a"; }
    String currentAlias(String app) { return alias(app, slot(app)); }

    private synchronized boolean isLatest(Op op) {
        Long g = latest.get(op.app); return g != null && g == op.generation;
    }

    /** Alias for the replacement key. Any stale key in that unused slot is removed first; the live one is untouched.
     * Supersedes every earlier Op for this app. */
    synchronized Op begin(String app) throws Exception {
        Op op = new Op(app, alias(app, "b".equals(slot(app)) ? "a" : "b"), ++generations);
        latest.put(app, op.generation);
        store.deleteKey(op.alias);
        return op;
    }

    /** Replacement is committed before the old key goes, so a crash in between leaves only an orphan key.
     * A superseded Op cannot commit: its key may already belong to a newer seal. */
    synchronized void commit(Op op, String packed) throws Exception {
        if (!isLatest(op)) throw new IllegalStateException("Superseded");
        String old = currentAlias(op.app);
        String nextSlot = op.alias.equals(alias(op.app, "b")) ? "b" : null; // slot a is the v1 default: no marker
        if (!store.write(new String[]{op.app, slotPref(op.app)}, new String[]{packed, nextSlot})) throw new IllegalStateException("Save failed");
        latest.remove(op.app);
        // The new secret is saved; failing to drop the old key only leaves an orphan the next begin() reclaims.
        if (!old.equals(op.alias)) { try { store.deleteKey(old); } catch (Exception ignored) { } }
    }

    /** Drops an uncommitted replacement key; never the committed one, and never a newer Op's key. */
    synchronized void abort(Op op) {
        if (!isLatest(op)) return;
        latest.remove(op.app);
        if (op.alias.equals(currentAlias(op.app)) && store.get(op.app) != null) return;
        try { store.deleteKey(op.alias); } catch (Exception ignored) { }
    }

    synchronized void forget(String app) throws Exception {
        latest.remove(app);
        store.deleteKey(alias(app, "a")); store.deleteKey(alias(app, "b"));
        if (!store.write(new String[]{app, slotPref(app)}, new String[]{null, null})) throw new IllegalStateException("Save failed");
    }
}
