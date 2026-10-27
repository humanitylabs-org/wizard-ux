package ai.wizards.os.vault;

import static org.junit.Assert.*;
import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.security.KeyStore;
import javax.crypto.KeyGenerator;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real AndroidKeyStore + real "wizard-vault" preferences on an isolated emulator.
 * Owner ask: cancelling the fingerprint prompt while replacing a saved secret keeps the old secret.
 * Keys here are plain AES so no fingerprint is needed; the prompt itself is outside this test. */
@RunWith(AndroidJUnit4.class)
public class VaultSlotsDeviceTest {
    private static final String APP = "qa-vault-device";
    private Context context;
    private VaultStore store;
    private VaultSlots slots;

    @Before public void clean() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        store = new VaultStore(context); slots = new VaultSlots(store); slots.forget(APP);
    }
    private static KeyStore ks() throws Exception { KeyStore k = KeyStore.getInstance("AndroidKeyStore"); k.load(null); return k; }
    private static void makeKey(String alias) throws Exception {
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        g.generateKey();
    }
    private void seal(String packed, boolean fingerprintOk) throws Exception {
        String next = slots.begin(APP); makeKey(next);
        if (fingerprintOk) slots.commit(APP, next, packed); else slots.abort(APP, next);
    }

    @Test public void cancelledReplacementKeepsSecretAndKeyOnDevice() throws Exception {
        seal("old", true);
        String saved = slots.currentAlias(APP);
        seal("new", false);
        assertEquals("old", store.get(APP));
        assertEquals(saved, slots.currentAlias(APP));
        assertTrue(ks().containsAlias(saved));
        assertFalse(ks().containsAlias(saved.endsWith(".b") ? VaultSlots.alias(APP, "a") : VaultSlots.alias(APP, "b")));
    }

    @Test public void v1SecretSurvivesCancelThenRotatesOnSuccess() throws Exception {
        String v1 = VaultSlots.KEY_PREFIX + APP; makeKey(v1); store.write(new String[]{APP}, new String[]{"v1"});
        assertEquals(v1, slots.currentAlias(APP));
        seal("x", false);
        assertEquals("v1", store.get(APP)); assertTrue(ks().containsAlias(v1));
        seal("x", true);
        assertEquals("x", store.get(APP)); assertFalse(ks().containsAlias(v1)); assertTrue(ks().containsAlias(v1 + ".b"));
        slots.forget(APP);
        assertNull(store.get(APP)); assertFalse(ks().containsAlias(v1 + ".b"));
    }
}
