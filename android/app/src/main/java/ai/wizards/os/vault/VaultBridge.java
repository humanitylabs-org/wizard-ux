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
    // Key aliases ("wos-vault-v1-" + app, plus a ".b" slot) live in VaultSlots; distinct from Wizard ID's owner-wrap aliases.
    private final Activity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private CancellationSignal active;

    public VaultBridge(Activity activity) { this.activity = activity; }

    /** Runs the active prompt's failure path; set while a prompt is in flight. */
    private Runnable settleActive;

    /** Navigation/detach revokes the old document before cancelling Android's prompt. The op is settled
     * here, so its late ERROR_CANCELED callback is a no-op and cannot touch a newer seal's key. */
    public void cancel() {
        CancellationSignal previous = active; active = null;
        Runnable settle = settleActive; settleActive = null;
        if (settle != null) settle.run();
        if (previous != null) previous.cancel();
    }

    private SharedPreferences prefs() { return activity.getSharedPreferences("wizard-vault", Context.MODE_PRIVATE); }

    private final VaultSlots slots = new VaultSlots(new VaultSlots.Store() {
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
    });

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

    private SecretKey key(String alias, boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
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

    private void forget(String app) throws Exception { slots.forget(app); }

    private void seal(String app, String secret, String title, BiConsumer<JSONObject, String> reply, BooleanSupplier trusted) throws Exception {
        // Saving rotates the app's biometric-bound key into the spare slot. The saved secret and its key stay
        // until the new ciphertext is committed, so cancelling or failing the prompt never erases it.
        VaultSlots.Op next = slots.begin(app);
        Cipher cipher;
        try { cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(next.alias, true)); }
        catch (Exception e) { slots.abort(next); throw e; }
        prompt(cipher, title, "Use your fingerprint to save it on this phone", reply, trusted, done -> {
            byte[] clear = secret.getBytes(StandardCharsets.UTF_8);
            try {
                byte[] encrypted = done.doFinal(clear);
                slots.commit(next, VaultPolicy.pack(done.getIV(), encrypted));
                return new JSONObject().put("saved", true);
            } finally { Arrays.fill(clear, (byte) 0); }
        }, () -> slots.abort(next));
    }

    private void open(String app, String sealed, String title, BiConsumer<JSONObject, String> reply, BooleanSupplier trusted) throws Exception {
        try {
            byte[][] parts = VaultPolicy.unpack(sealed);
            SecretKey key = key(slots.currentAlias(app), false);
            if (key == null || parts == null) { forget(app); reply.accept(null, "not_saved"); return; }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, parts[0]));
            prompt(cipher, title, "Use your fingerprint", reply, trusted, done -> {
                byte[] clear = done.doFinal(parts[1]);
                try { return new JSONObject().put("secret", new String(clear, StandardCharsets.UTF_8)); }
                finally { Arrays.fill(clear, (byte) 0); }
            }, () -> { });
        } catch (KeyPermanentlyInvalidatedException e) { forget(app); reply.accept(null, "invalidated"); }
    }

    interface Done { JSONObject run(Cipher cipher) throws Exception; }

    /** onFail runs for every outcome except success, including revoked documents and timeouts. */
    private void prompt(Cipher cipher, String title, String subtitle, BiConsumer<JSONObject, String> reply, BooleanSupplier trusted, Done done, Runnable onFail) {
        CancellationSignal token = new CancellationSignal(); active = token;
        boolean[] settled = {false};
        settleActive = () -> { if (!settled[0]) { settled[0] = true; onFail.run(); } };
        Runnable timeout = () -> {
            if (active != token) return;
            cancel();
            if (!settled[0]) { settled[0] = true; onFail.run(); }
            if (trusted.getAsBoolean()) reply.accept(null, "timeout");
        };
        BiConsumer<JSONObject, String> finish = (result, error) -> {
            boolean mine = active == token;
            if ((error != null || !mine) && !settled[0]) { settled[0] = true; onFail.run(); }
            if (!mine) return;
            active = null; settleActive = null; main.removeCallbacks(timeout);
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
                    // A stale success must not cancel a newer prompt: only cancel when this op is still active.
                    if (active != token || !trusted.getAsBoolean()) { if (active == token) cancel(); finish.accept(null, "cancelled"); return; }
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
