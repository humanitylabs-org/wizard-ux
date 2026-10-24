package ai.wizards.os.vault;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.hardware.fingerprint.FingerprintManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.function.BiConsumer;
import java.util.function.BooleanSupplier;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONException;
import org.json.JSONObject;

/** Biometric-only adapter behind the existing origin/main-frame guarded wizardDevicePort.
 * No JS interface or new port. The shell supplies the registered frame's appId, never caller args.
 * Keep v1 aliases/preferences so the owner's installed 0.10.8 sealed secrets remain readable.
 */
public final class VaultBridge {
    private static final String KEY_PREFIX = "wos-vault-v1-"; // distinct from Wizard ID's owner-wrap aliases
    private final Activity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private CancellationSignal active;

    public VaultBridge(Activity activity) { this.activity = activity; }

    /** Navigation/detach revokes the old document before cancelling Android's prompt. */
    public void cancel() {
        CancellationSignal previous = active; active = null;
        if (previous != null) previous.cancel();
    }

    private SharedPreferences prefs() { return activity.getSharedPreferences("wizard-vault", Context.MODE_PRIVATE); }

    public void dispatch(String method, JSONObject params, BiConsumer<JSONObject, String> reply, BooleanSupplier trusted) {
        if (!trusted.getAsBoolean()) return;
        String app = params.optString("appId", "");
        try {
            if (!VaultPolicy.appId(app)) { reply.accept(null, "bad_request"); return; }
            if ("vault.has".equals(method)) {
                reply.accept(new JSONObject().put("available", available()).put("saved", prefs().contains(app)), null); return;
            }
            // Forget cannot race an authenticated save and have its secret resurrected by a late callback.
            if (active != null) { reply.accept(null, "busy"); return; }
            if ("vault.forget".equals(method)) { forget(app); reply.accept(new JSONObject().put("saved", false), null); return; }
            if (!"vault.seal".equals(method) && !"vault.open".equals(method)) { reply.accept(null, "bad_request"); return; }
            if (!available()) { reply.accept(null, "unavailable"); return; }
            String title = VaultPolicy.title(params.optString("title"));
            if ("vault.seal".equals(method)) {
                Object secret = params.opt("secret");
                if (!(secret instanceof String) || !VaultPolicy.secret((String) secret)) { reply.accept(null, "bad_request"); return; }
                seal(app, (String) secret, title, reply, trusted);
            } else {
                String sealed = prefs().getString(app, null);
                if (sealed == null) { reply.accept(null, "not_saved"); return; }
                open(app, sealed, title, reply, trusted);
            }
        } catch (Exception e) { reply.accept(null, "failed"); } // never log request/secret/exception payloads
    }

    @SuppressWarnings("deprecation")
    private boolean available() {
        if (Build.VERSION.SDK_INT >= 30) {
            BiometricManager manager = activity.getSystemService(BiometricManager.class);
            return manager != null && manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS;
        }
        // Older APIs cannot explicitly request BIOMETRIC_STRONG: conservatively offer enrolled fingerprints only.
        FingerprintManager manager = activity.getSystemService(FingerprintManager.class);
        return manager != null && manager.isHardwareDetected() && manager.hasEnrolledFingerprints();
    }

    private SecretKey key(String app, boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        String alias = KEY_PREFIX + app;
        if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias, null);
        if (!create) return null;
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        else spec.setUserAuthenticationValidityDurationSeconds(-1);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(spec.build()); return generator.generateKey();
    }

    private void forget(String app) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); store.deleteEntry(KEY_PREFIX + app);
        if (!prefs().edit().remove(app).commit()) throw new IllegalStateException("Save failed");
    }

    private void seal(String app, String secret, String title, BiConsumer<JSONObject, String> reply, BooleanSupplier trusted) throws Exception {
        // As in v1, saving rotates the app's biometric-bound key. No other app or identity key is touched.
        forget(app);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(app, true));
        prompt(cipher, title, "Use your fingerprint to save it on this phone", reply, trusted, done -> {
            byte[] clear = secret.getBytes(StandardCharsets.UTF_8);
            try {
                byte[] encrypted = done.doFinal(clear);
                if (!prefs().edit().putString(app, VaultPolicy.pack(done.getIV(), encrypted)).commit()) throw new IllegalStateException("Save failed");
                return new JSONObject().put("saved", true);
            } finally { Arrays.fill(clear, (byte) 0); }
        });
    }

    private void open(String app, String sealed, String title, BiConsumer<JSONObject, String> reply, BooleanSupplier trusted) throws Exception {
        try {
            byte[][] parts = VaultPolicy.unpack(sealed);
            SecretKey key = key(app, false);
            if (key == null || parts == null) { forget(app); reply.accept(null, "not_saved"); return; }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, parts[0]));
            prompt(cipher, title, "Use your fingerprint", reply, trusted, done -> {
                byte[] clear = done.doFinal(parts[1]);
                try { return new JSONObject().put("secret", new String(clear, StandardCharsets.UTF_8)); }
                finally { Arrays.fill(clear, (byte) 0); }
            });
        } catch (KeyPermanentlyInvalidatedException e) { forget(app); reply.accept(null, "invalidated"); }
    }

    interface Done { JSONObject run(Cipher cipher) throws Exception; }

    private void prompt(Cipher cipher, String title, String subtitle, BiConsumer<JSONObject, String> reply, BooleanSupplier trusted, Done done) {
        CancellationSignal token = new CancellationSignal(); active = token;
        Runnable timeout = () -> {
            if (active != token) return;
            cancel(); if (trusted.getAsBoolean()) reply.accept(null, "timeout");
        };
        BiConsumer<JSONObject, String> finish = (result, error) -> {
            if (active != token) return;
            active = null; main.removeCallbacks(timeout);
            if (trusted.getAsBoolean()) reply.accept(result, error);
        };
        BiometricPrompt.Builder builder = new BiometricPrompt.Builder(activity).setTitle(title).setSubtitle(subtitle)
                .setNegativeButton("Use password", activity.getMainExecutor(), (dialog, which) -> finish.accept(null, "cancelled"));
        if (Build.VERSION.SDK_INT >= 30) builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        if (Build.VERSION.SDK_INT >= 29) builder.setConfirmationRequired(false);
        main.postDelayed(timeout, 110000);
        try {
            builder.build().authenticate(new BiometricPrompt.CryptoObject(cipher), token, activity.getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    if (active != token || !trusted.getAsBoolean()) { cancel(); return; }
                    try { finish.accept(done.run(result.getCryptoObject().getCipher()), null); }
                    catch (Exception e) { finish.accept(null, "failed"); }
                }
                @Override public void onAuthenticationError(int code, CharSequence message) {
                    finish.accept(null, code == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED || code == BiometricPrompt.BIOMETRIC_ERROR_CANCELED ? "cancelled" : "failed");
                }
            });
        } catch (RuntimeException e) { finish.accept(null, "failed"); }
    }
}
