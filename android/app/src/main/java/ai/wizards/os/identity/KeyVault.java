package ai.wizards.os.identity;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.util.Base64;

import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The owner's Wizard ID key on this phone. The 32-byte secp256k1 secret is stored only as AES-GCM ciphertext under an
 * Android Keystore key (StrongBox when present) that needs a fresh biometric or device PIN for every single use and
 * is invalidated when new fingerprints are enrolled. The secret is decrypted for one operation and wiped.
 *
 * Nothing here is reachable from the WebView: the bridge only sees {@link #publicKey()} and signed events.
 */
public final class KeyVault {
    private static final String ALIAS = "wizard-id-wrap-v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String PREFS = "wizard-id-v1";
    private static final String IV = "iv", CT = "ct", PUB = "pubkey", NAME = "name", PICTURE = "picture",
            BACKED_UP = "backed_up", ORIGIN = "origin", CREATED = "created_at", PUBLISHED = "profile_published_at";

    private final SharedPreferences prefs;

    public KeyVault(Context c) { prefs = c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public boolean exists() { return prefs.contains(CT) && prefs.contains(PUB); }
    public String publicKey() { return prefs.getString(PUB, null); }
    public String name() { return prefs.getString(NAME, ""); }
    public String picture() { return prefs.getString(PICTURE, ""); }
    public boolean backedUp() { return prefs.getBoolean(BACKED_UP, false); }
    /** "created" (made on this phone) or "imported". */
    public String origin() { return prefs.getString(ORIGIN, ""); }
    public long profilePublishedAt() { return prefs.getLong(PUBLISHED, 0); }

    public void setName(String n) { prefs.edit().putString(NAME, n == null ? "" : n.trim()).apply(); }
    public void setPicture(String p) { prefs.edit().putString(PICTURE, p == null ? "" : p.trim()).apply(); }
    public void markBackedUp() { prefs.edit().putBoolean(BACKED_UP, true).apply(); }
    public void markProfilePublished(long at) { prefs.edit().putLong(PUBLISHED, at).apply(); }

    /* ------------------------------------------------------------------ ciphers (each needs biometric/PIN) */

    /** For create/import: an encrypt cipher the biometric prompt unlocks. */
    public Cipher encryptCipher() throws GeneralSecurityException {
        Cipher c = Cipher.getInstance(TRANSFORMATION);
        try {
            c.init(Cipher.ENCRYPT_MODE, wrappingKey(true));
        } catch (KeyPermanentlyInvalidatedException e) {
            // Fingerprints changed since the wrap key was made and nothing is stored under it yet: start over.
            if (exists()) throw e;
            deleteWrappingKey();
            c.init(Cipher.ENCRYPT_MODE, wrappingKey(true));
        }
        return c;
    }

    /** For signing / revealing: a decrypt cipher the biometric prompt unlocks. */
    public Cipher decryptCipher() throws GeneralSecurityException {
        if (!exists()) throw new IllegalStateException("No Wizard ID on this phone.");
        byte[] iv = Base64.decode(prefs.getString(IV, ""), Base64.NO_WRAP);
        Cipher c = Cipher.getInstance(TRANSFORMATION);
        c.init(Cipher.DECRYPT_MODE, wrappingKey(false), new GCMParameterSpec(128, iv));
        return c;
    }

    /** Stores {@code secret} (wiped afterwards by the caller) under the unlocked cipher. Returns the pubkey. */
    public String store(Cipher unlocked, byte[] secret, String name, String origin, boolean backedUp) throws GeneralSecurityException {
        String pub = Schnorr.publicKey(secret);
        byte[] ct = unlocked.doFinal(secret);
        boolean ok = prefs.edit()
                .putString(IV, Base64.encodeToString(unlocked.getIV(), Base64.NO_WRAP))
                .putString(CT, Base64.encodeToString(ct, Base64.NO_WRAP))
                .putString(PUB, pub)
                .putString(NAME, name == null ? "" : name.trim())
                .putString(ORIGIN, origin)
                .putBoolean(BACKED_UP, backedUp)
                .putLong(CREATED, System.currentTimeMillis() / 1000)
                .remove(PUBLISHED)
                .commit();
        if (!ok) throw new GeneralSecurityException("Could not save the Wizard ID.");
        return pub;
    }

    /** Runs {@code use} with the decrypted secret, then wipes it. Checks it still matches the stored public key. */
    public <T> T withSecret(Cipher unlocked, SecretUse<T> use) throws GeneralSecurityException {
        byte[] sk = unlocked.doFinal(Base64.decode(prefs.getString(CT, ""), Base64.NO_WRAP));
        try {
            if (!Schnorr.publicKey(sk).equals(publicKey())) throw new GeneralSecurityException("The stored key doesn't match this Wizard ID.");
            return use.apply(sk);
        } finally {
            Arrays.fill(sk, (byte) 0);
        }
    }

    public interface SecretUse<T> { T apply(byte[] secret) throws GeneralSecurityException; }

    /** Forget the Wizard ID on this phone (the key in the password manager is untouched). */
    public void remove() {
        prefs.edit().clear().commit();
        deleteWrappingKey();
    }

    /* ------------------------------------------------------------------ Keystore */

    private SecretKey wrappingKey(boolean create) throws GeneralSecurityException {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        try { ks.load(null); } catch (java.io.IOException e) { throw new GeneralSecurityException(e); }
        java.security.Key k = ks.getKey(ALIAS, null);
        if (k instanceof SecretKey) return (SecretKey) k;
        if (!create) throw new GeneralSecurityException("The Wizard ID lock is missing on this phone.");
        try { return generate(true); }
        catch (StrongBoxUnavailableException e) { return generate(false); }
        catch (GeneralSecurityException e) {
            if (Build.VERSION.SDK_INT >= 28 && e.getCause() instanceof StrongBoxUnavailableException) return generate(false);
            throw e;
        }
    }

    private SecretKey generate(boolean strongBox) throws GeneralSecurityException {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) {
            b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
        } else {
            // API 28-29: per-use keys only unlock through a fingerprint/face prompt (no PIN-only path on these versions).
            b.setUserAuthenticationValidityDurationSeconds(-1);
        }
        if (Build.VERSION.SDK_INT >= 28) b.setIsStrongBoxBacked(strongBox);
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(b.build());
        return g.generateKey();
    }

    private void deleteWrappingKey() {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            ks.deleteEntry(ALIAS);
        } catch (Exception ignored) { }
    }

    /** True when this phone binds the key to every single use (API 30+). */
    public static boolean perUseAuth() { return Build.VERSION.SDK_INT >= 30; }
}
