package ai.wizards.os.identity;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.util.Base64;
import fr.acinq.secp256k1.Secp256k1;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.function.Consumer;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** September authority wrap/auth/sign/self-verify/wipe, retargeted to the active Java app. */
public final class KeyVault {
    public static final String ALIAS = "wizard-id-owner-wrap-v1";
    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private final SharedPreferences prefs;
    private final Context context;
    private static final String GUARD = ALIAS + "-biometric-enrollment";
    private final SecureRandom random = new SecureRandom();
    public KeyVault(Context c) { context = c; prefs = c.getSharedPreferences("wizard-id-v1", Context.MODE_PRIVATE); }
    public boolean enrolled() { return prefs.contains("owner_ciphertext") && prefs.contains("owner_xonly_public_key"); }
    public String publicKey() { return prefs.getString("owner_xonly_public_key", ""); }
    public String name() { return prefs.getString("name", ""); }
    public String picture() { return prefs.getString("picture", ""); }
    public boolean backedUp() { return prefs.getBoolean("backed_up", false); }
    public void markBackedUp() { if (!prefs.edit().putBoolean("backed_up", true).commit()) throw new IllegalStateException("Save failed"); }
    public Cipher newEnrollmentCipher() throws Exception {
        if (enrolled()) throw new IllegalStateException("Already enrolled");
        Cipher c = Cipher.getInstance(TRANSFORM); c.init(Cipher.ENCRYPT_MODE, wrappingKey()); return c;
    }
    public void finishEnrollment(Cipher cipher, String name, String picture, byte[] imported) throws Exception {
        if (enrolled()) throw new IllegalStateException("Already enrolled");
        byte[] secret = imported != null ? imported : newSecret();
        try {
            if (!Secp256k1.get().secKeyVerify(secret)) throw new IllegalArgumentException("Invalid secret");
            String pubkey = xOnlyPublic(secret);
            byte[] encrypted = cipher.doFinal(secret);
            boolean guarded = enrollBiometricGuard();
            if (!prefs.edit().putString("owner_iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                    .putString("owner_ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    .putString("owner_xonly_public_key", pubkey).putString("name", name).putString("picture", picture)
                    .putBoolean("backed_up", false).putBoolean("biometric_guard", guarded).commit()) throw new IllegalStateException("Save failed");
        } finally { Arrays.fill(secret, (byte)0); }
    }
    public Cipher newSigningCipher() throws Exception {
        if (!enrolled()) throw new IllegalStateException("No Wizard ID");
        checkBiometricGuard();
        Cipher c = Cipher.getInstance(TRANSFORM);
        c.init(Cipher.DECRYPT_MODE, wrappingKey(), new GCMParameterSpec(128, Base64.decode(prefs.getString("owner_iv", ""), Base64.NO_WRAP)));
        return c;
    }
    private byte[] unlock(Cipher cipher) throws Exception {
        checkBiometricGuard();
        byte[] secret = cipher.doFinal(Base64.decode(prefs.getString("owner_ciphertext", ""), Base64.NO_WRAP));
        try { if (!xOnlyPublic(secret).equals(publicKey())) throw new IllegalStateException("Wrong identity"); return secret; }
        catch (Exception e) { Arrays.fill(secret, (byte)0); throw e; }
    }
    public String sign(Cipher cipher, byte[] digest) throws Exception {
        if (digest.length != 32) throw new IllegalArgumentException("Invalid digest");
        byte[] secret = unlock(cipher), auxiliary = new byte[32]; random.nextBytes(auxiliary);
        try {
            byte[] sig = Secp256k1.get().signSchnorr(digest, secret, auxiliary);
            if (!Secp256k1.get().verifySchnorr(sig, digest, NostrEvent.bytes(publicKey()))) throw new IllegalStateException("Signature self-check failed");
            return NostrEvent.hex(sig);
        } finally { Arrays.fill(secret, (byte)0); Arrays.fill(auxiliary, (byte)0); }
    }
    public String nip44(Cipher cipher, String pubkey, String data, boolean encrypt) throws Exception {
        byte[] secret = unlock(cipher);
        try { return encrypt ? Nip44.encrypt(secret, pubkey, data) : Nip44.decrypt(secret, pubkey, data); }
        finally { Arrays.fill(secret, (byte)0); }
    }
    public void backup(Cipher cipher, Consumer<String> consume) throws Exception {
        byte[] secret = unlock(cipher);
        try { consume.accept(Nip19.encode("nsec", secret)); } finally { Arrays.fill(secret, (byte)0); }
    }
    public boolean matchesBackup(String value) {
        byte[] secret = Nip19.secret(value);
        try { return Secp256k1.get().secKeyVerify(secret) && xOnlyPublic(secret).equals(publicKey()); }
        finally { Arrays.fill(secret, (byte)0); }
    }
    private boolean strongEnrolled() {
        return androidx.biometric.BiometricManager.from(context).canAuthenticate(
                androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG) == androidx.biometric.BiometricManager.BIOMETRIC_SUCCESS;
    }
    /** AUTH_DEVICE_CREDENTIAL means Android ignores invalidatedByBiometricEnrollment on the wrapping key.
     * A separate biometric-only sentinel detects enrollment changes without decrypting or holding the secret. */
    @SuppressWarnings("deprecation")
    private boolean enrollBiometricGuard() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); store.deleteEntry(GUARD);
        if (!strongEnrolled()) return false;
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(GUARD,KeyProperties.PURPOSE_ENCRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(true).setUserAuthenticationValidityDurationSeconds(-1)
                .setInvalidatedByBiometricEnrollment(true).build();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(spec); generator.generateKey(); return true;
    }
    private void checkBiometricGuard() throws Exception {
        if (!prefs.getBoolean("biometric_guard",false)) {
            if (strongEnrolled()) throw new android.security.keystore.KeyPermanentlyInvalidatedException();
            return;
        }
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        SecretKey key = (SecretKey)store.getKey(GUARD,null);
        if (key == null) throw new android.security.keystore.KeyPermanentlyInvalidatedException();
        // Initializing a cipher detects invalidation. No sentinel plaintext or auth token is used.
        Cipher probe = Cipher.getInstance(TRANSFORM); probe.init(Cipher.ENCRYPT_MODE,key);
    }
    private SecretKey wrappingKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        SecretKey key = (SecretKey)store.getKey(ALIAS, null); if (key != null) return key;
        if (enrolled()) throw new IllegalStateException("Keystore unavailable; restore your backup");
        try { return generate(true); } catch (StrongBoxUnavailableException e) { return generate(false); }
    }
    @SuppressWarnings("deprecation")
    private SecretKey generate(boolean strongBox) throws Exception {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
        else b.setUserAuthenticationValidityDurationSeconds(-1);
        b.setIsStrongBoxBacked(strongBox);
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"); gen.init(b.build()); return gen.generateKey();
    }
    private byte[] newSecret() {
        for (int i = 0; i < 1024; i++) { byte[] b = new byte[32]; random.nextBytes(b); if (Secp256k1.get().secKeyVerify(b)) return b; Arrays.fill(b, (byte)0); }
        throw new IllegalStateException("Random key generation failed");
    }
    private static String xOnlyPublic(byte[] secret) {
        byte[] pubkey = Secp256k1.get().pubkeyCreate(secret);
        if (pubkey.length != 65 || pubkey[0] != 4) throw new IllegalStateException("Invalid public key");
        return NostrEvent.hex(Arrays.copyOfRange(pubkey, 1, 33));
    }
}
