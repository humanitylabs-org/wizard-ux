package ai.wizards.os.vault;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Log;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONException;
import org.json.JSONObject;
import ai.wizards.os.audio.AudioPolicy;
import ai.wizards.os.device.AppState;

/**
 * Fingerprint vault: an app keeps one small secret (Messenger: its passphrase) on this phone, sealed by an
 * Android Keystore key that only a strong biometric unlocks. The server never sees the sealed copy or the key.
 * Main-frame shell port only (origin-bound addWebMessageListener); the shell relays for registered app frames
 * and names the app itself, so one app can never read another app's secret.
 */
public final class VaultBridge {
    static final String TAG = "WizardVault";
    static final String NAME = "wizardVaultPort";
    private static final String KEY_PREFIX = "wos-vault-v1-";
    private final Activity activity;
    private final WebView web;
    private boolean detached, busy;

    private VaultBridge(Activity a, WebView w) { activity = a; web = w; }

    public static VaultBridge install(Activity a, WebView w) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return null;
        VaultBridge b = new VaultBridge(a, w);
        Set<String> origins = new HashSet<>(Collections.singleton(AppState.primaryOrigin(a)));
        if (ai.wizards.os.BuildConfig.DEBUG) origins.add(AppState.origin(a));
        try { WebViewCompat.addWebMessageListener(w, NAME, origins, b::message); }
        catch (RuntimeException e) { Log.w(TAG, "no vault bridge", e); return null; }
        return b;
    }

    public void detach() { detached = true; }

    private SharedPreferences prefs() { return activity.getSharedPreferences("wizard-vault", Context.MODE_PRIVATE); }

    private void message(WebView view, WebMessageCompat raw, Uri source, boolean main, JavaScriptReplyProxy reply) {
        String origin = AppState.origin(activity);
        if (detached || !main || source == null || !origin.equals(source.toString()) || !AudioPolicy.shell(web.getUrl(), origin)) return;
        String id = "";
        try {
            String value = raw.getData(); if (value == null || value.length() > 20000) return;
            JSONObject r = new JSONObject(value); id = r.optString("id");
            String method = r.optString("method"), app = r.optString("appId");
            if (r.optInt("v") != 1 || !VaultPolicy.appId(app)) { answer(reply, id, null, "bad_request"); return; }
            switch (method) {
                case "has": answer(reply, id, new JSONObject().put("available", available()).put("saved", prefs().contains(app)), null); return;
                case "forget": forget(app); answer(reply, id, new JSONObject().put("saved", false), null); return;
                case "seal": case "open": break;
                default: answer(reply, id, null, "bad_request"); return;
            }
            if (!available()) { answer(reply, id, null, "unavailable"); return; }
            if (busy) { answer(reply, id, null, "busy"); return; }
            String title = VaultPolicy.title(r.optString("title"));
            if ("seal".equals(method)) {
                String secret = r.optString("secret");
                if (!VaultPolicy.secret(secret)) { answer(reply, id, null, "bad_request"); return; }
                seal(app, secret, title, reply, id);
            } else {
                String sealed = prefs().getString(app, null);
                if (sealed == null) { answer(reply, id, null, "not_saved"); return; }
                open(app, sealed, title, reply, id);
            }
        } catch (JSONException | RuntimeException e) { Log.w(TAG, "vault request", e); answer(reply, id, null, "failed"); }
    }

    private boolean available() {
        if (Build.VERSION.SDK_INT >= 30) {
            BiometricManager m = activity.getSystemService(BiometricManager.class);
            return m != null && m.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS;
        }
        return activity.getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_FINGERPRINT);
    }

    private SecretKey key(String app, boolean create) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        String alias = KEY_PREFIX + app;
        if (ks.containsAlias(alias)) return (SecretKey) ks.getKey(alias, null);
        if (!create) return null;
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(spec.build()); return g.generateKey();
    }

    private void forget(String app) {
        prefs().edit().remove(app).apply();
        try { KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null); ks.deleteEntry(KEY_PREFIX + app); } catch (Exception ignored) { }
    }

    private void seal(String app, String secret, String title, JavaScriptReplyProxy reply, String id) {
        Cipher c;
        try {
            forget(app); // a fresh key per save: an old sealed copy can never be opened again
            c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key(app, true));
        } catch (Exception e) { Log.w(TAG, "seal init", e); answer(reply, id, null, "failed"); return; }
        prompt(c, title, "Use your fingerprint to save it on this phone", reply, id, done -> {
            byte[] ct = done.doFinal(secret.getBytes(StandardCharsets.UTF_8));
            prefs().edit().putString(app, VaultPolicy.pack(done.getIV(), ct)).apply();
            return new JSONObject().put("saved", true);
        });
    }

    private void open(String app, String sealed, String title, JavaScriptReplyProxy reply, String id) {
        Cipher c;
        try {
            byte[][] parts = VaultPolicy.unpack(sealed);
            SecretKey k = key(app, false); if (k == null || parts == null) { forget(app); answer(reply, id, null, "not_saved"); return; }
            c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, parts[0]));
            final byte[] ct = parts[1];
            prompt(c, title, "Use your fingerprint", reply, id, done ->
                    new JSONObject().put("secret", new String(done.doFinal(ct), StandardCharsets.UTF_8)));
        } catch (KeyPermanentlyInvalidatedException e) { forget(app); answer(reply, id, null, "invalidated"); }
        catch (Exception e) { Log.w(TAG, "open init", e); answer(reply, id, null, "failed"); }
    }

    interface Done { JSONObject run(Cipher c) throws Exception; }

    private void prompt(Cipher c, String title, String subtitle, JavaScriptReplyProxy reply, String id, Done done) {
        busy = true;
        BiometricPrompt.Builder b = new BiometricPrompt.Builder(activity).setTitle(title).setSubtitle(subtitle)
                .setNegativeButton("Use password", activity.getMainExecutor(), (d, w) -> { busy = false; answer(reply, id, null, "cancelled"); });
        if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        if (Build.VERSION.SDK_INT >= 29) b.setConfirmationRequired(false);
        b.build().authenticate(new BiometricPrompt.CryptoObject(c), new CancellationSignal(), activity.getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                busy = false;
                try { answer(reply, id, done.run(result.getCryptoObject().getCipher()), null); }
                catch (Exception e) { Log.w(TAG, "vault crypto", e); answer(reply, id, null, "failed"); }
            }
            @Override public void onAuthenticationError(int code, CharSequence msg) {
                busy = false;
                answer(reply, id, null, code == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED || code == BiometricPrompt.BIOMETRIC_ERROR_CANCELED ? "cancelled" : "failed");
            }
        });
    }

    private void answer(JavaScriptReplyProxy p, String id, JSONObject result, String error) {
        if (detached) return;
        try {
            JSONObject o = new JSONObject().put("id", id).put("ok", error == null);
            if (error == null) o.put("result", result); else o.put("error", error);
            p.postMessage(o.toString());
        } catch (JSONException | RuntimeException ignored) { }
    }
}
