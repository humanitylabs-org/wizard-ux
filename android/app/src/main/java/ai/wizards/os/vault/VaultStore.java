package ai.wizards.os.vault;

import android.content.Context;
import android.content.SharedPreferences;
import java.security.KeyStore;

/** The vault's real storage: the v1 "wizard-vault" preferences and AndroidKeyStore. Device-tested by VaultSlotsDeviceTest. */
final class VaultStore implements VaultSlots.Store {
    private final Context context;
    VaultStore(Context context) { this.context = context.getApplicationContext(); }
    private SharedPreferences prefs() { return context.getSharedPreferences("wizard-vault", Context.MODE_PRIVATE); }
    @Override public String get(String key) { return prefs().getString(key, null); }
    @Override public boolean write(String[] keys, String[] values) {
        SharedPreferences.Editor edit = prefs().edit();
        for (int i = 0; i < keys.length; i++) { if (values[i] == null) edit.remove(keys[i]); else edit.putString(keys[i], values[i]); }
        return edit.commit();
    }
    @Override public void deleteKey(String alias) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(alias)) store.deleteEntry(alias);
    }
}
